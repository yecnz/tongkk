import { BACKEND_URL, fetchWithTunnelRetry, getJsonRequestHeaders, parseApiError } from './backend';
import type { SummaryTemplate } from './gpt';

// 서버 _PAGE_MARKER_RE와 동일: PDF는 `<!-- p.N -->`, PPT/PPTX는 `<!-- Slide number: N -->`.
const PAGE_MARKER_RE = /<!--\s*(?:p\.|Slide number:\s*)(\d+)\s*-->/g;

// 구간당 입력 글자 예산(목표치). 출력도 이에 비례해 짧아져 한 요청이 터널 제한(~100초) 안에 끝난다.
const CHUNK_TARGET_CHARS = 16_000;
// 섹션 하나는 이 상한까지 통째로 유지한다(목표치를 넘어도 안 쪼갬). 이 상한마저 넘는 초대형
// 섹션만 페이지 단위로 분할하고, 둘째 조각부터 '이어짐'으로 표시해 제목 재생성을 막는다.
const CHUNK_HARD_CHARS = 28_000;
// 직전 구간 요약 끝부분을 다음 구간에 넘겨 제목 수준·흐름을 잇는다(서버 previous_tail 한도 6000자).
const PREVIOUS_TAIL_CHARS = 1_500;
// 구간 하나의 스트림이 이 시간 안에 못 끝나면 중단한다.
const CHUNK_TIMEOUT_MS = 150_000;

export type SummaryStreamCallbacks = {
  /** 누적 전체 텍스트가 갱신될 때마다 호출 (타자기 렌더링용) */
  onDelta?: (fullText: string) => void;
  /** 구간 시작 시 호출 (1-base) */
  onProgress?: (chunkIndex: number, chunkTotal: number) => void;
};

export type SummaryStreamOptions = SummaryStreamCallbacks & {
  pages?: string;
  focusPrompt?: string;
  /** 요약에 포함된 자료 이름 목록. 2개 이상이면 서버가 출처에 자료명을 함께 적게 한다. */
  sourceNames?: string[];
  signal?: AbortSignal;
};

// combineMaterialsMarkdown이 합본에 넣는 자료 경계 표식. 구간 분할 시 자료명 문맥을 잇는 데 쓴다.
const MATERIAL_MARKER_RE = /<!--\s*자료:\s*([^>]+?)\s*-->/g;

/** start 위치 앞에서 마지막으로 등장한 자료 표식의 이름. 없으면 null. */
function lastMaterialNameBefore(markdown: string, start: number): string | null {
  let name: string | null = null;
  for (const match of markdown.matchAll(MATERIAL_MARKER_RE)) {
    if (match.index === undefined || match.index >= start) break;
    name = match[1].trim();
  }
  return name;
}

// 합본 분할 시 둘째 이후 구간은 `<!-- 자료: ... -->` 표식을 잃어 모델이 어느 자료의
// 구간인지 알 수 없다. 구간 시작 위치 앞의 마지막 표식을 찾아 머리에 이어 붙인다.
function prependMaterialContext(markdown: string, chunkText: string, chunkStart: number): string {
  if (chunkStart === 0 || /^<!--\s*자료:/.test(chunkText)) return chunkText;
  const name = lastMaterialNameBefore(markdown, chunkStart);
  return name ? `<!-- 자료: ${name} (이어짐) -->\n\n${chunkText}` : chunkText;
}

/** 서버 _parse_page_selection과 동일: "1-5, 8" → 페이지 번호 집합 */
function parsePageSelection(spec: string): Set<number> {
  const pages = new Set<number>();
  for (const part of spec.replace(/\s+/g, '').split(',')) {
    if (!part) continue;
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-', 2);
      let start = Number.parseInt(startStr, 10);
      let end = Number.parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (start > end) [start, end] = [end, start];
      for (let page = start; page <= end; page++) pages.add(page);
    } else {
      const page = Number.parseInt(part, 10);
      if (!Number.isNaN(page)) pages.add(page);
    }
  }
  return pages;
}

// 슬라이드 머리글·절 제목 줄("6.2 주기억장치", "6.2.1 …"). 페이지 블록 앞부분에서만 찾는다.
const SECTION_LABEL_RE = /^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(\S.{0,38})$/;

export type SummaryChunk = { markdown: string; isContinuation: boolean };

/** 페이지 블록 앞부분(마커·페이지번호 줄은 건너뜀)에서 '6.2 주기억장치' 같은 절 제목을 찾는다. */
function detectSectionLabel(blockText: string): string | null {
  const lines = blockText.split('\n').map(line => line.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    const match = SECTION_LABEL_RE.exec(line);
    if (match) return `${match[1]} ${match[2].trim()}`;
  }
  return null;
}

/**
 * 페이지 마커로 블록을 만든 뒤, 절 제목이 바뀌는 지점(섹션)으로 묶어 구간을 만든다.
 * - 섹션 경계에서만 잘라 한 섹션이 두 구간에 걸쳐 제목이 중복되는 것을 막는다.
 * - 한 섹션이 CHUNK_HARD_CHARS를 넘으면 그 섹션만 페이지 단위로 쪼개고 둘째 조각부터 isContinuation.
 * - 절 제목이 안 잡히는 자료는 섹션이 하나로 묶여, 페이지를 목표 글자수로 채우는 기존 동작과 같아진다.
 * - 마커가 없으면 문단 기준 폴백.
 */
export function splitMarkdownIntoChunks(markdown: string, pagesSpec?: string): SummaryChunk[] {
  const matches = [...markdown.matchAll(PAGE_MARKER_RE)];

  if (matches.length === 0) {
    return splitByParagraphs(markdown).map(text => ({ markdown: text, isContinuation: false }));
  }

  // 페이지 블록 추출 (마커 앞 서문은 첫 구간에 붙인다)
  const preamble = markdown.slice(0, matches[0].index).trim();
  const selected = pagesSpec?.trim() ? parsePageSelection(pagesSpec) : null;

  type Block = { text: string; start: number; pageNo: number };
  const collectBlocks = (filterPages: boolean): Block[] => {
    const result: Block[] = [];
    for (let i = 0; i < matches.length; i++) {
      const pageNo = Number.parseInt(matches[i][1], 10);
      if (filterPages && selected && selected.size > 0 && !selected.has(pageNo)) continue;
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
      const text = markdown.slice(start, end).trim();
      if (text) result.push({ text, start, pageNo });
    }
    return result;
  };

  let blocks = collectBlocks(true);
  // 서버 필터와 동일: 선택한 페이지가 자료에 하나도 없으면 전체를 쓴다.
  if (blocks.length === 0) blocks = collectBlocks(false);
  if (blocks.length === 0) return [{ markdown, isContinuation: false }];

  // 절 제목이 명시된 페이지 = 섹션 시작점(페이지 번호 오름차순). 반복되는 머리글은 한 번만 등록.
  const sectionStarts: { pageNo: number; label: string }[] = [];
  for (const block of blocks) {
    const label = detectSectionLabel(block.text);
    if (label && (sectionStarts.length === 0 || sectionStarts[sectionStarts.length - 1].label !== label)) {
      sectionStarts.push({ pageNo: block.pageNo, label });
    }
  }
  // 페이지 번호로 섹션을 찾는다. 시각 분석 레이어('## PDF N페이지' 블록)도 같은 페이지 번호라 자동 귀속.
  const sectionFor = (pageNo: number): string | null => {
    let label: string | null = null;
    for (const start of sectionStarts) {
      if (start.pageNo <= pageNo) label = start.label;
      else break;
    }
    return label;
  };

  // 연속된 같은 섹션 블록을 한 그룹으로 묶는다.
  type Group = { blocks: Block[]; length: number; label: string | null };
  const groups: Group[] = [];
  for (const block of blocks) {
    const label = sectionFor(block.pageNo);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.blocks.push(block);
      last.length += block.text.length;
    } else {
      groups.push({ blocks: [block], length: block.text.length, label });
    }
  }

  const assemble = (parts: Block[]): string =>
    prependMaterialContext(markdown, parts.map(part => part.text).join('\n\n'), parts[0].start);

  const chunks: SummaryChunk[] = [];
  let current: Block[] = [];
  let currentLength = 0;
  const flush = () => {
    if (current.length > 0) {
      chunks.push({ markdown: assemble(current), isContinuation: false });
      current = [];
      currentLength = 0;
    }
  };

  for (const group of groups) {
    // 섹션 하나가 상한을 넘으면 통째로 못 넣는다 → 페이지 단위로 쪼개고 둘째 조각부터 '이어짐'.
    if (group.length > CHUNK_HARD_CHARS) {
      flush();
      let piece: Block[] = [];
      let pieceLength = 0;
      let firstPiece = true;
      const flushPiece = () => {
        if (piece.length > 0) {
          chunks.push({ markdown: assemble(piece), isContinuation: !firstPiece });
          firstPiece = false;
          piece = [];
          pieceLength = 0;
        }
      };
      for (const block of group.blocks) {
        if (pieceLength > 0 && pieceLength + block.text.length > CHUNK_HARD_CHARS) flushPiece();
        piece.push(block);
        pieceLength += block.text.length;
      }
      flushPiece();
      continue;
    }
    // 목표치를 넘으면 새 구간에서 시작한다(자르는 지점은 항상 섹션 경계).
    if (currentLength > 0 && currentLength + group.length > CHUNK_TARGET_CHARS) flush();
    current.push(...group.blocks);
    currentLength += group.length;
  }
  flush();

  if (chunks.length === 0) return [{ markdown, isContinuation: false }];
  // 마커 앞 서문은 첫 구간 머리에 붙인다.
  if (preamble) chunks[0] = { ...chunks[0], markdown: `${preamble}\n\n${chunks[0].markdown}` };
  return chunks;
}

function splitByParagraphs(markdown: string): string[] {
  if (markdown.length <= CHUNK_TARGET_CHARS) return [markdown];
  const chunks: string[] = [];
  let current = '';
  // 직전까지 본 자료 표식 이름. 새 구간이 표식 없이 시작하면 머리에 이어 붙인다.
  let lastName: string | null = null;
  for (const paragraph of markdown.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length > CHUNK_TARGET_CHARS) {
      chunks.push(current);
      current = lastName && !/^<!--\s*자료:/.test(paragraph)
        ? `<!-- 자료: ${lastName} (이어짐) -->\n\n${paragraph}`
        : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    for (const match of paragraph.matchAll(MATERIAL_MARKER_RE)) lastName = match[1].trim();
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [markdown];
}

type StreamEvent = {
  delta?: string;
  done?: boolean;
  finish_reason?: string;
  error?: string;
};

type ChunkRequestBody = {
  markdown: string;
  template: SummaryTemplate;
  pages?: string;
  focus_prompt?: string;
  source_names?: string[];
  chunk_index?: number;
  chunk_total?: number;
  previous_tail?: string;
  is_continuation?: boolean;
};

type ChunkResult = { text: string; finishReason: string };

async function streamSummaryChunk(
  body: ChunkRequestBody,
  signal: AbortSignal,
  onToken: (chunkText: string) => void,
): Promise<ChunkResult> {
  const response = await fetchWithTunnelRetry(`${BACKEND_URL}/summarize/stream`, {
    method: 'POST',
    headers: await getJsonRequestHeaders(),
    body: JSON.stringify(body),
    signal,
  }, [3_000, 10_000]);

  if (!response.ok || !response.body) {
    throw new Error(await parseApiError(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  let done = false;

  try {
    while (true) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });

      let eventEnd: number;
      while ((eventEnd = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(5).trim()) as StreamEvent;
          } catch {
            continue;
          }
          if (event.error) throw new Error(event.error);
          if (event.delta) {
            text += event.delta;
            onToken(text);
          }
          if (event.done) {
            done = true;
            finishReason = event.finish_reason || '';
          }
        }
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (!done) {
    throw new Error('요약 스트림이 중간에 끊겼습니다. 다시 시도해주세요.');
  }
  return { text, finishReason };
}

function isTruncatedFinishReason(finishReason: string): boolean {
  const reason = finishReason.toLowerCase();
  return reason === 'length' || reason === 'max_tokens';
}

/**
 * 자료를 페이지 구간으로 나눠 구간마다 SSE 스트리밍으로 요약을 생성한다.
 * - 각 요청이 짧아 Cloudflare 터널 제한·모델 출력 한도·입력 컨텍스트 한도를 모두 피한다.
 * - onDelta로 누적 텍스트를 계속 전달해 타자기 렌더링을 지원한다.
 * - CHEAT_SHEET는 전역 압축이 필요해 구간을 나누지 않고 한 번에 스트리밍한다.
 * - MINDMAP(JSON 출력)은 부분 렌더링이 불가능하므로 이 함수를 쓰지 않는다.
 */
export async function summarizeWithTemplateStream(
  markdown: string,
  template: SummaryTemplate,
  options: SummaryStreamOptions = {},
): Promise<string> {
  const chunks: (SummaryChunk | null)[] = template === 'CHEAT_SHEET'
    ? [null] // 서버가 pages로 필터링한 전체 입력을 한 번에 처리
    : splitMarkdownIntoChunks(markdown, options.pages);

  let completed = '';
  for (let i = 0; i < chunks.length; i++) {
    options.onProgress?.(i + 1, chunks.length);

    const chunk = chunks[i];
    const sourceNames = options.sourceNames?.length ? options.sourceNames : undefined;
    const body: ChunkRequestBody = chunk === null
      ? {
        markdown,
        template,
        pages: options.pages?.trim() || undefined,
        focus_prompt: options.focusPrompt?.trim() || undefined,
        source_names: sourceNames,
      }
      : {
        markdown: chunk.markdown,
        template,
        focus_prompt: options.focusPrompt?.trim() || undefined,
        source_names: sourceNames,
        ...(chunks.length > 1 ? {
          chunk_index: i + 1,
          chunk_total: chunks.length,
          previous_tail: completed ? completed.slice(-PREVIOUS_TAIL_CHARS) : undefined,
          ...(chunk.isContinuation ? { is_continuation: true } : {}),
        } : {}),
      };

    const base = completed;
    const onToken = (chunkText: string) => {
      options.onDelta?.(base ? `${base}\n\n${chunkText}` : chunkText);
    };

    const runChunk = async (): Promise<ChunkResult> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);
      const onExternalAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onExternalAbort);
      try {
        return await streamSummaryChunk(body, controller.signal, onToken);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (options.signal?.aborted) throw new Error('요약 생성이 취소되었습니다.');
          throw new Error('요약 구간 생성 시간이 초과되었습니다. 다시 시도해주세요.');
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }
    };

    let result: ChunkResult;
    try {
      result = await runChunk();
    } catch (err) {
      // 스트림이 중간에 끊긴 경우(터널 재연결 등) 이 구간만 한 번 더 시도한다.
      if (options.signal?.aborted || (err instanceof Error && err.message.includes('취소'))) throw err;
      await new Promise(resolve => setTimeout(resolve, 2_000));
      result = await runChunk();
    }

    if (isTruncatedFinishReason(result.finishReason)) {
      throw new Error('요약 출력이 모델 한도에서 잘렸습니다. 페이지 범위를 줄여 다시 시도해주세요.');
    }
    const text = result.text.trim();
    if (text) {
      completed = completed ? `${completed}\n\n${text}` : text;
      options.onDelta?.(completed);
    }
  }

  if (!completed.trim()) {
    throw new Error('요약 결과를 받지 못했습니다. 다시 시도해주세요.');
  }
  return completed;
}
