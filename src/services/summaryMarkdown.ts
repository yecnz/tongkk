// 요약 본문 마크다운 가공(순수 문자열 변환) 모음.
// LLM이 생성한 요약의 출처 표기 정리·시험 포인트 카드화·개행 정규화를 담당하며,
// 렌더(Summary.tsx의 ReactMarkdown components) 전에 적용된다. React에 의존하지 않는다.
import { normalizeBoldSpacing } from "../common";

const SOURCE_PATTERN = /\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/g;

// 출처 배지 표시용 정리: '출처:' 라벨 제거, 섹션명의 작은따옴표 제거,
// 텍스트 붙여넣기 자료 이름 뒤의 .txt 확장자 숨김(파일을 올린 적 없는 자료라 어색하다).
export const formatCitationLabel = (citation: string): string =>
  citation
    .slice(1, -1)
    .replace(/^출처:\s*/, "")
    .replace(/\.txt(?=\s*[,;]|\s*$)/gi, "")
    .replace(/'([^']+)'/g, "$1");

// 출처 표기 안의 '~'(페이지 범위 표기, 예: p.3~7)를 하이픈으로 바꾼다.
// remark-gfm가 '~...~'를 취소선(<del>)으로 해석하면 출처 문자열이 쪼개져
// 출처 배지가 깨지고 페이지 번호가 줄줄이 합쳐 보이는 문제를 막는다.
const sanitizeCitationTildes = (markdown: string): string =>
  markdown.replace(/\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/g, (m) => m.replace(/~/g, "-"));

// 자료명 없이 위치만 적은 출처(단일 자료 요약 형식)인지 판별한다.
// 페이지·슬라이드 번호이거나, 작은따옴표로 감싼 섹션명이면 위치로 본다.
// "3쪽 정리.txt"처럼 숫자로 시작하는 자료명을 오인하지 않게, 숫자형은 그 자체로 끝나는 경우만 위치로 본다.
const isCitationLocation = (part: string): boolean =>
  /^['"]/.test(part) ||
  /^pp?\.\s*\d/i.test(part) ||
  /^(?:slide|슬라이드|페이지)\s*\d/i.test(part) ||
  /^OCR\s*이미지/i.test(part) ||
  /^\d+(?:\s*[-–~]\s*\d+)?\s*(?:p|페이지|쪽)?$/i.test(part);

// 한 섹션에 흩어진 여러 (출처: ...)를 파일별로 묶어 하나로 합친다. (페이지/슬라이드 중복 제거)
const mergeSourceCitations = (sources: string[]): string => {
  const byFile = new Map<string, string[]>();
  for (const src of sources) {
    const inner = src.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "").trim();
    const commaIdx = inner.indexOf(",");
    let file = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
    let locText = commaIdx === -1 ? "" : inner.slice(commaIdx + 1);
    // 위치-only 출처는 파일명 없이 위치 묶음("")으로 모은다.
    if (isCitationLocation(file)) {
      locText = inner;
      file = "";
    }
    if (!byFile.has(file)) byFile.set(file, []);
    const locs = byFile.get(file)!;
    locText.split(",").map(s => s.trim()).filter(Boolean).forEach(loc => {
      if (!locs.includes(loc)) locs.push(loc);
    });
  }
  const parts = [...byFile.entries()]
    .map(([file, locs]) => (file ? (locs.length ? `${file}, ${locs.join(", ")}` : file) : locs.join(", ")))
    .filter(Boolean);
  return parts.length ? `(출처: ${parts.join("; ")})` : "";
};

// 출처 표기에서 파일명 부분만 떼어낸다. (예: "(출처: a.pdf, p.3)" -> "a.pdf")
// 위치-only 출처(예: "(출처: p.3)", "(출처: '동기화')")는 파일명이 없으므로 빈 문자열.
const citationFileName = (src: string): string => {
  const inner = src.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "").trim();
  const commaIdx = inner.indexOf(",");
  const head = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
  return isCitationLocation(head) ? "" : head;
};

// 요약 전체가 단일 자료(파일명이 한 종류)일 때는 출처에서 파일명을 떼고
// 위치(p.3 등)만 남긴다. 위치 단서 없이 파일명만 있는 출처는 통째로 제거한다.
// 여러 파일명이 섞여 있으면 어느 자료인지 구분이 필요하므로 그대로 두고,
// 파일명 없는 위치-only 출처도 그대로 둔다.
export const simplifySoleFileSources = (markdown: string): string => {
  const matches = markdown.match(SOURCE_PATTERN) || [];
  if (!matches.length) return markdown;
  const files = new Set(matches.map(citationFileName).filter(Boolean));
  if (files.size > 1) return markdown;

  return markdown.replace(SOURCE_PATTERN, (m) => {
    const inner = m.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "").trim();
    const commaIdx = inner.indexOf(",");
    const head = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
    if (isCitationLocation(head)) return m;
    const loc = commaIdx === -1 ? "" : inner.slice(commaIdx + 1).trim();
    return loc ? `(출처: ${loc})` : "";
  });
};

// 본문 속 인라인 시험 포인트 "(**시험 포인트:** ...)"를 렌더 토큰으로 변환한다.
// 마크다운 파싱(특히 **굵게**) 전에 적용해야 표시 단계에서 형광펜으로 묶어 렌더할 수 있다.
export const markInlineExamPoints = (markdown: string): string =>
  markdown
    .replace(/\(\s*\*\*\s*시험\s*포인트\s*:?\s*\*\*\s*([^)]*?)\s*\)/g, (_m, c) => `§EXAM§${c}§/EXAM§`)
    .replace(/\(\s*시험\s*포인트\s*:\s*([^)]*?)\s*\)/g, (_m, c) => `§EXAM§${c}§/EXAM§`);

// 시험 포인트 섹션을 항목별로 재구성한다.
// - 질문과 답을 같은 '>' 인용문 박스 안에 넣어 한 카드로 묶는다(출처는 질문 줄 끝으로 모음).
// - '답:'과 답 내용도 박스 안에서 리스트로 들여쓴다. ('답:'은 렌더 시 글머리 숨김)
const formatExamCards = (sectionLines: string[]): string[] => {
  const SRC = /\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/;
  type Item = { question: string; answer: string[] };
  const items: Item[] = [];
  let cur: Item | null = null;
  // '답:'은 **답:**(굵게)·전각 콜론(：) 변형도 답으로 인식해, 답이 새 질문으로 잘못 쪼개져
  // 별도 박스로 분리되는 것을 막는다.
  const ANSWER_LABEL = /^\*{0,2}\s*답\s*[:：]\s*\*{0,2}\s*/;
  for (const raw of sectionLines) {
    let content = raw.replace(/^>\s*/, "").trim();
    if (content === "") continue;
    // LLM이 가끔 질문 앞에 붙이는 '시험 포인트:' 라벨(굵게 포함)을 떼어낸다.
    content = content.replace(/^\*{0,2}\s*시험\s*포인트\s*[:：]\s*\*{0,2}\s*/, "");
    if (content === "") continue;
    const deBullet = content.replace(/^-\s*/, "");
    const isAnswer = ANSWER_LABEL.test(deBullet);
    const isBullet = /^-\s*/.test(content);
    if (!isAnswer && !isBullet) {
      cur = { question: content, answer: [] };
      items.push(cur);
    } else if (cur) {
      cur.answer.push(deBullet);
    }
  }
  if (!items.length) return sectionLines;
  const out: string[] = [];
  items.forEach((it, idx) => {
    let question = it.question;
    const answerLines = it.answer.filter(a => a.trim() !== "");
    if (!SRC.test(question)) {
      for (let a = 0; a < answerLines.length; a++) {
        const m = answerLines[a].match(SRC);
        if (m) {
          question = `${question} ${m[0]}`;
          answerLines[a] = answerLines[a].replace(SRC, "").replace(/\s+$/, "");
          break;
        }
      }
    }
    if (idx > 0) out.push("");
    out.push(`> ${question}`);
    if (answerLines.length) {
      out.push(">");
      const labelIdx = answerLines.findIndex(a => ANSWER_LABEL.test(a));
      const label = labelIdx >= 0 ? answerLines[labelIdx] : "답:";
      const points = answerLines.filter((_, k) => k !== labelIdx);
      // '답:' 라벨 줄에 답 내용이 같은 줄에 붙어 있으면(예: '답: RWM이다') 분리해서
      // '답:'은 라벨로만 두고 내용은 하위 bullet로 내린다. (단답·목록답 모두 같은 카드 형태로 통일)
      const inlineAnswer = label.replace(ANSWER_LABEL, "").trim();
      if (inlineAnswer) points.unshift(inlineAnswer);
      out.push("> - 답:");               // '답:' (박스 안, 렌더 시 글머리 숨김)
      for (const p of points) out.push(`>   - ${p}`);  // 답 내용도 박스 안 중첩 리스트
    }
  });
  return out;
};

export const hoistSourceToHeadings = (markdown: string): string => {
  const lines = sanitizeCitationTildes(markdown).split("\n");
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      const sectionLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) {
        sectionLines.push(lines[j]);
        j++;
      }
      // '한눈에 보는 흐름', '주요 용어', '핵심 암기 사항', '참고/주의 사항'은 출처를 달지 않는다.
      const isNoSourceSection = /흐름|주요\s*용어|핵심\s*암기|참고\s*\/?\s*주의/.test(line);
      // '시험 포인트'는 헤딩에 모으지 않고 각 문제 옆 인라인 출처를 그대로 둔다.
      const isInlineSourceSection = /시험\s*포인트/.test(line);
      if (isInlineSourceSection) {
        result.push(line);
        formatExamCards(sectionLines).forEach(l => result.push(l));
      } else {
        const sources = isNoSourceSection ? [] : (sectionLines.join("\n").match(SOURCE_PATTERN) || []);
        const mergedSource = sources.length ? mergeSourceCitations(sources) : "";
        result.push(mergedSource ? `${line} ${mergedSource}` : line);
        sectionLines.forEach(l => result.push(l.replace(SOURCE_PATTERN, "").trimEnd()));
      }
      i = j;
    } else {
      result.push(line);
      i++;
    }
  }
  return result.join("\n");
};

export const normalizeMarkdownContent = (content: string) => normalizeBoldSpacing(content.replace(/\r\n/g, "\n").trim());
