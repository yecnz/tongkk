import { BACKEND_URL, fetchWithTunnelRetry, getJsonRequestHeaders, parseApiError } from './backend';
import type { SummaryTemplate } from './gpt';

// 서버 _PAGE_MARKER_RE와 동일: PDF는 `<!-- p.N -->`, PPT/PPTX는 `<!-- Slide number: N -->`.
const PAGE_MARKER_RE = /<!--\s*(?:p\.|Slide number:\s*)(\d+)\s*-->/g;

// 구간당 입력 글자 예산. 출력도 이에 비례해 짧아져 한 요청이 터널 제한(~100초) 안에 끝난다.
const CHUNK_TARGET_CHARS = 16_000;
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

/** 페이지 마커 기준으로 자료를 구간 입력 목록으로 나눈다. 마커가 없으면 문단 기준 폴백. */
export function splitMarkdownIntoChunks(markdown: string, pagesSpec?: string): string[] {
  const matches = [...markdown.matchAll(PAGE_MARKER_RE)];

  if (matches.length === 0) {
    return splitByParagraphs(markdown);
  }

  // 페이지 블록 추출 (마커 앞 서문은 첫 구간에 붙인다)
  const preamble = markdown.slice(0, matches[0].index).trim();
  const selected = pagesSpec?.trim() ? parsePageSelection(pagesSpec) : null;

  type Block = { text: string; start: number };
  const collectBlocks = (filterPages: boolean): Block[] => {
    const result: Block[] = [];
    for (let i = 0; i < matches.length; i++) {
      if (filterPages && selected && selected.size > 0) {
        const pageNo = Number.parseInt(matches[i][1], 10);
        if (!selected.has(pageNo)) continue;
      }
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
      const text = markdown.slice(start, end).trim();
      if (text) result.push({ text, start });
    }
    return result;
  };

  let blocks = collectBlocks(true);
  // 서버 필터와 동일: 선택한 페이지가 자료에 하나도 없으면 전체를 쓴다.
  if (blocks.length === 0) blocks = collectBlocks(false);

  const chunks: Block[] = [];
  let current = preamble;
  let currentStart = 0;
  for (const block of blocks) {
    if (current && current.length + block.text.length > CHUNK_TARGET_CHARS) {
      chunks.push({ text: current, start: currentStart });
      current = block.text;
      currentStart = block.start;
    } else {
      if (!current) currentStart = block.start;
      current = current ? `${current}\n\n${block.text}` : block.text;
    }
  }
  if (current) chunks.push({ text: current, start: currentStart });
  if (chunks.length === 0) return [markdown];
  return chunks.map(chunk => prependMaterialContext(markdown, chunk.text, chunk.start));
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
  const chunks = template === 'CHEAT_SHEET'
    ? [null] // 서버가 pages로 필터링한 전체 입력을 한 번에 처리
    : splitMarkdownIntoChunks(markdown, options.pages);

  let completed = '';
  for (let i = 0; i < chunks.length; i++) {
    options.onProgress?.(i + 1, chunks.length);

    const chunkMarkdown = chunks[i];
    const sourceNames = options.sourceNames?.length ? options.sourceNames : undefined;
    const body: ChunkRequestBody = chunkMarkdown === null
      ? {
        markdown,
        template,
        pages: options.pages?.trim() || undefined,
        focus_prompt: options.focusPrompt?.trim() || undefined,
        source_names: sourceNames,
      }
      : {
        markdown: chunkMarkdown,
        template,
        focus_prompt: options.focusPrompt?.trim() || undefined,
        source_names: sourceNames,
        ...(chunks.length > 1 ? {
          chunk_index: i + 1,
          chunk_total: chunks.length,
          previous_tail: completed ? completed.slice(-PREVIOUS_TAIL_CHARS) : undefined,
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
