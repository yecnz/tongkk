// 구간별로 이어 붙인 요약을 저장 전에 정리한다(LLM 없음).
// - 닫히지 않은 코드 블록(```)을 닫는다.
// - 바로 앞 제목과 같은 수준·같은 제목이 다시 나오면(구간 경계 반복) 지운다.
// - 같은 섹션 안에서 공백·마크다운 기호를 빼고 같은 문단이 또 나오면 지운다.
// - 내용 없이 다음 제목(같은 수준 이상)이나 문서 끝으로 이어지는 빈 제목을 지운다.

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const MIN_DEDUPE_LENGTH = 15; // 너무 짧은 블록(구분선 등)은 중복이어도 둔다.

const normalize = (block: string) => block.toLowerCase().replace(/[\s*_#>`|:\-.,]/g, '');
const headingLevel = (block: string) => HEADING.exec(block)?.[1].length ?? 0;

const toBlocks = (markdown: string): string[] => {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };

  for (const line of markdown.split('\n')) {
    if (fence) {
      current.push(line);
      if (line.trim().startsWith(fence)) { fence = null; flush(); }
    } else if (FENCE.test(line)) {
      flush();
      fence = line.trim().slice(0, 3);
      current.push(line);
    } else if (HEADING.test(line)) {
      flush();
      blocks.push(line.trim());
    } else if (!line.trim()) {
      flush();
    } else {
      current.push(line);
    }
  }
  if (fence) current.push(fence);
  flush();
  return blocks;
};

export const cleanSummary = (markdown: string): string => {
  const seen = new Set<string>();
  let lastHeading = '';
  const kept: string[] = [];

  for (const block of toBlocks(markdown)) {
    const level = headingLevel(block);
    const key = normalize(block);
    if (level) {
      // 같은 수준의 같은 제목이 바로 이어 나올 때만 반복으로 본다.
      if (`${level}:${key}` === lastHeading) continue;
      lastHeading = `${level}:${key}`;
      // 중복 문단은 같은 섹션 안에서만 찾는다(다른 섹션에서 다시 쓴 수식·문장은 의도된 것).
      seen.clear();
    } else if (key.length >= MIN_DEDUPE_LENGTH && !/^\s/.test(block)) {
      // 들여쓴 하위 bullet은 지우면 위 라벨만 남으므로 건드리지 않는다.
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(block);
  }

  // 뒤에서부터 보며 내용 없는 제목을 지운다(지운 뒤의 앞 제목도 다시 판단되도록).
  const result: string[] = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    const level = headingLevel(kept[i]);
    const nextLevel = result.length ? headingLevel(result[0]) : 1;
    if (level && nextLevel && nextLevel <= level) continue;
    result.unshift(kept[i]);
  }
  return result.join('\n\n');
};
