import type { CSSProperties, ReactNode } from "react";
import type { Components } from "react-markdown";
import { CYAN, normalizeBoldSpacing, normalizeMathDelimiters, escapeStrayMultiplication } from "../../common";
import type { SummaryTemplate } from "../../services/gpt";

// 출처 배지 표시용 정리: '출처:' 라벨 제거, 섹션명의 작은따옴표 제거,
// 텍스트 붙여넣기 자료 이름 뒤의 .txt 확장자 숨김(파일을 올린 적 없는 자료라 어색하다).
const formatCitationLabel = (citation: string): string =>
  citation
    .slice(1, -1)
    .replace(/^출처:\s*/, "")
    .replace(/\.txt(?=\s*[,;]|\s*$)/gi, "")
    .replace(/'([^']+)'/g, "$1");

const renderHighlightSyntax = (children: ReactNode): ReactNode => {
  if (typeof children === "string") {
    return children.split(/(§EXAM§[\s\S]*?§\/EXAM§|==[^=]+==|\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)|\*\*[^*]+\*\*)/g).map((part, index) => {
      if (part.startsWith("§EXAM§") && part.endsWith("§/EXAM§")) {
        return (
          <mark key={index} style={{ padding: "1px 6px", borderRadius: 5, background: "var(--color-tint-yellow)", color: "var(--color-text-strong)" }}>
            <strong style={{ fontWeight: 800 }}>시험 포인트:</strong> {part.slice(6, -7)}
          </mark>
        );
      }
      if (part.startsWith("==") && part.endsWith("==")) {
        return <mark key={index} style={{ padding: "1px 5px", borderRadius: 5, background: "var(--color-tint-pink)", color: "var(--color-text-strong)", fontWeight: 800 }}>{part.slice(2, -2)}</mark>;
      }
      if (part.match(/^\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)$/)) {
        return <span key={index} style={{ display: "inline-flex", alignItems: "center", marginLeft: 4, padding: "2px 7px", borderRadius: 999, background: "var(--color-tint-cyan)", color: CYAN, fontSize: 11, fontWeight: 850, verticalAlign: "middle" }}>{formatCitationLabel(part)}</span>;
      }
      // CommonMark 경계 규칙(닫는 ** 앞이 ')' 등 문장부호 + 뒤가 한글)으로 굵게 처리에
      // 실패해 그대로 남은 **...**를 폴백으로 굵게 렌더링한다.
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={index} style={{ fontWeight: 800, color: "var(--color-text-strong)" }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => <span key={index}>{renderHighlightSyntax(child)}</span>);
  }

  return children;
};

const markdownStyles = {
  paragraph: { margin: "0 0 10px", lineHeight: 1.8, color: "var(--color-text)" } satisfies CSSProperties,
  // '근거로 본 자료: ...' 출처 줄 — 본문(15px)보다 확실히 작고 옅게. 눈에 띄지 않아도 되는 보조 정보다.
  sourceNote: { margin: "0 0 10px", fontSize: 12, lineHeight: 1.55, color: "color-mix(in srgb, var(--color-muted) 75%, transparent)" } satisfies CSSProperties,
  list: { margin: "6px 0 14px", paddingLeft: 24, lineHeight: 1.75 } satisfies CSSProperties,
  tableWrap: { overflowX: "auto", margin: "12px 0 16px" } satisfies CSSProperties,
};

// 튜터·요약 답변의 '근거로 본 자료: ...' 출처 안내 줄을 식별한다.
const isSourceNoteText = (text: string) => /^근거(?:로)?\s*본\s*자료/.test(text.trimStart());

export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 style={{ margin: "0 0 18px", paddingBottom: 12, borderBottom: "2px solid var(--color-border-soft)", fontSize: 24, lineHeight: 1.35, fontWeight: 850, color: "var(--color-text-strong)" }}>
      {renderHighlightSyntax(children)}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ margin: "26px 0 12px", padding: "9px 12px", borderRadius: 8, background: "var(--color-surface)", fontSize: 20, lineHeight: 1.45, fontWeight: 850, color: "var(--color-text-strong)" }}>
      {renderHighlightSyntax(children)}
    </h2>
  ),
  h3: ({ children }) => <h3 style={{ display: "inline-block", margin: "20px 0 10px", padding: "4px 8px", borderRadius: 6, background: "var(--color-surface)", fontSize: 17, lineHeight: 1.45, fontWeight: 800, color: "var(--color-text-strong)" }}>{renderHighlightSyntax(children)}</h3>,
  h4: ({ children }) => <h4 style={{ margin: "16px 0 8px", fontSize: 15, lineHeight: 1.45, fontWeight: 800, color: "var(--color-text-strong)" }}>{renderHighlightSyntax(children)}</h4>,
  h5: ({ children }) => <h5 style={{ margin: "14px 0 8px", fontSize: 14, lineHeight: 1.45, fontWeight: 800, color: "var(--color-text)" }}>{renderHighlightSyntax(children)}</h5>,
  h6: ({ children }) => <h6 style={{ margin: "12px 0 8px", fontSize: 13, lineHeight: 1.45, fontWeight: 800, color: "var(--color-text)" }}>{renderHighlightSyntax(children)}</h6>,
  p: ({ children }) => {
    const text = getNodeText(children);
    // 출처 줄은 내부 굵게·하이라이트 스타일이 흐린 톤을 깨지 않도록 순수 텍스트로만 렌더한다.
    if (isSourceNoteText(text)) return <p style={markdownStyles.sourceNote}>{children}</p>;
    return <p style={markdownStyles.paragraph}>{renderHighlightSyntax(children)}</p>;
  },
  ul: ({ children }) => <ul style={{ ...markdownStyles.list, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ ...markdownStyles.list, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => {
    const isAnswerLabel = getNodeText(children).trimStart().startsWith("답:");
    return <li style={{ marginBottom: 6, paddingLeft: 4, ...(isAnswerLabel ? { listStyleType: "none" } : {}) }}>{renderHighlightSyntax(children)}</li>;
  },
  strong: ({ children }) => <strong style={{ fontWeight: 800, color: "var(--color-text-strong)" }}>{renderHighlightSyntax(children)}</strong>,
  em: ({ children }) => <em style={{ color: "var(--color-text)" }}>{children}</em>,
  blockquote: ({ children }) => (
    <blockquote style={{ margin: "14px 0", padding: "13px 15px", border: "1px solid var(--color-border-soft)", borderRadius: 12, background: "var(--color-surface)", color: "var(--color-text)", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    if (className) {
      return <code className={className} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 13 }}>{children}</code>;
    }
    return (
      <code style={{ padding: "2px 6px", borderRadius: 6, background: "var(--color-surface)", color: "var(--color-text)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.92em", fontWeight: 700 }}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre style={{ margin: "14px 0", padding: 16, borderRadius: 12, background: "var(--color-surface)", border: "1px solid var(--color-border-soft)", overflowX: "auto", lineHeight: 1.6 }}>
      {children}
    </pre>
  ),
  hr: () => <hr style={{ margin: "22px 0", border: "none", borderTop: "1px solid var(--color-border-soft)" }} />,
  table: ({ children }) => (
    <div style={markdownStyles.tableWrap}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480, fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ padding: "9px 12px", background: "var(--color-tint-pink)", color: "var(--color-text-strong)", fontWeight: 800, border: "1px solid color-mix(in srgb, var(--color-pink) 30%, transparent)", textAlign: "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td style={{ padding: "8px 12px", border: "1px solid var(--color-border-soft)", color: "var(--color-text)", lineHeight: 1.6 }}>{children}</td>,
};

export const cheatSheetMarkdownComponents: Components = {
  ...markdownComponents,
  h1: ({ children }) => (
    <h1 style={{ margin: "0 0 14px", paddingBottom: 10, borderBottom: "2px solid var(--color-border-soft)", fontSize: 24, lineHeight: 1.35, fontWeight: 850, color: "var(--color-text-strong)", breakInside: "avoid" }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ margin: "20px 0 10px", padding: "8px 10px", borderRadius: 8, background: "var(--color-surface)", fontSize: 18, lineHeight: 1.4, fontWeight: 850, color: "var(--color-text-strong)", breakInside: "avoid" }}>
      {children}
    </h2>
  ),
  p: ({ children }) => {
    const text = getNodeText(children);
    // 출처 줄은 본문보다 확실히 작고 옅게, 내부 마크업 무시하고 순수 텍스트로 렌더한다.
    if (isSourceNoteText(text)) {
      return <p style={{ margin: "0 0 8px", fontSize: 11.5, lineHeight: 1.5, color: "color-mix(in srgb, var(--color-muted) 75%, transparent)" }}>{children}</p>;
    }
    return <p style={{ margin: "0 0 8px", lineHeight: 1.65, color: "var(--color-text)" }}>{renderHighlightSyntax(children)}</p>;
  },
  ul: ({ children }) => <ul style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.65, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.65, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 4, paddingLeft: 3 }}>{renderHighlightSyntax(children)}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "10px 0 14px", breakInside: "avoid" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 0, fontSize: 12 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ padding: "8px 9px", background: "var(--color-tint-pink)", color: "var(--color-text-strong)", fontWeight: 800, border: "1px solid color-mix(in srgb, var(--color-pink) 30%, transparent)", textAlign: "left" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td style={{ padding: "7px 9px", border: "1px solid var(--color-border-soft)", color: "var(--color-text)", lineHeight: 1.55, verticalAlign: "top" }}>{children}</td>,
};

const SOURCE_PATTERN = /\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/g;

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

// 위치 목록을 페이지 번호 순으로 정렬하고, 연속된 페이지는 범위(p.90-93)로 압축한다.
// 페이지가 아닌 위치(slide N 등)는 정렬·압축하지 않고 뒤에 그대로 붙인다.
// (범위 기호는 '-' — '~'는 마크다운 취소선으로 깨질 수 있어 sanitizeCitationTildes와 통일.)
const compressLocations = (locs: string[]): string[] => {
  // 단일(p.13)뿐 아니라 이미 범위로 적힌 출처(p.13-14, p.13-p.14, p.13~14)도 풀어서 페이지로 모은다.
  // 이렇게 해야 같은 범위가 다른 표기로 중복 나열되지 않는다.
  const pageSet = new Set<number>();
  const others: string[] = [];
  for (const loc of locs) {
    const range = loc.match(/^p\.(\d+)\s*[-~]\s*(?:p\.)?(\d+)$/);
    const single = loc.match(/^p\.(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) pageSet.add(i);
    } else if (single) {
      pageSet.add(parseInt(single[1], 10));
    } else {
      others.push(loc);
    }
  }
  const pages = [...pageSet].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = -1;
  let prev = -1;
  for (const p of pages) {
    if (start === -1) {
      start = prev = p;
    } else if (p === prev + 1) {
      prev = p;
    } else {
      ranges.push(start === prev ? `p.${start}` : `p.${start}-${prev}`);
      start = prev = p;
    }
  }
  if (start !== -1) ranges.push(start === prev ? `p.${start}` : `p.${start}-${prev}`);
  return [...ranges, ...others];
};

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
    .map(([file, locs]) => {
      // 페이지 번호 순 정렬 + 연속 구간을 범위(p.90-93)로 압축.
      const compressed = compressLocations(locs);
      return file ? (compressed.length ? `${file}, ${compressed.join(", ")}` : file) : compressed.join(", ");
    })
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
// 단일 출처 문자열 '(출처: ...)' 안의 페이지를 정렬·범위 압축한다(시험 포인트 질문 옆 출처용).
const normalizeCitation = (citation: string): string => {
  const inner = citation.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "");
  const compressed = compressLocations(inner.split(",").map(part => part.trim()).filter(Boolean));
  return compressed.length ? `(출처: ${compressed.join(", ")})` : "";
};

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
    const qm = question.match(SRC);
    if (qm) {
      // 질문에 이미 있는 출처도 페이지 정렬·범위 압축한다.
      question = question.replace(SRC, normalizeCitation(qm[0]));
    } else {
      for (let a = 0; a < answerLines.length; a++) {
        const m = answerLines[a].match(SRC);
        if (m) {
          question = `${question} ${normalizeCitation(m[0])}`;
          answerLines[a] = answerLines[a].replace(SRC, "").replace(/\s+$/, "");
          break;
        }
      }
    }
    if (idx > 0) out.push("");
    // 번호는 LLM에 맡기지 않고 여기서 매긴다. 박스마다 '1.'로 시작하면 각 박스가 새 목록이 돼
    // 전부 '1.'로 찍히거나(번호를 안 쓰면) 아예 없어서, LLM 번호를 떼고 '1\.'(목록 아님)로 통일한다.
    question = question.replace(/^(?:\*\*(?:Q\s*)?\d+\s*[.)]\*\*|(?:Q\s*)?\d+\s*[.)])\s*/i, "");
    out.push(`> ${idx + 1}\\. ${question}`);
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

// 마크다운 자식 노드에서 순수 텍스트만 추출한다. (li가 '답:'으로 시작하는지 판별용)
const getNodeText = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return getNodeText((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
};

// '방법/절차' 항목 정리 — 각 번호 항목(1. 2. ...) 내부(하위 bullet)에 흩어진 출처를 그 항목의
// 제목 줄(번호 줄) 끝으로 끌어올려, bullet이 아니라 항목 제목 옆에 출처가 붙게 한다. 한 항목에
// 여러 페이지가 섞여 있으면 위치를 모아 하나의 출처로 합친다(중복 제거).
const formatMethodSection = (sectionLines: string[]): string[] => {
  const SRC_G = /\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/g;
  const items: { head: string; body: string[] }[] = [];
  let cur: { head: string; body: string[] } | null = null;
  const preamble: string[] = [];
  for (const raw of sectionLines) {
    if (/^\s*\d+\.\s/.test(raw)) {
      cur = { head: raw, body: [] };
      items.push(cur);
    } else if (cur) {
      cur.body.push(raw);
    } else {
      preamble.push(raw);
    }
  }
  if (!items.length) return sectionLines;
  const out: string[] = [...preamble];
  for (const { head, body } of items) {
    const locs: string[] = [];
    for (const src of ([head, ...body].join("\n").match(SRC_G) || [])) {
      src.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "")
        .split(",").map(part => part.trim()).filter(Boolean)
        .forEach(part => { if (!locs.includes(part)) locs.push(part); });
    }
    // 페이지 번호 순 정렬 + 연속 구간을 범위(p.90-93)로 압축.
    const compressed = compressLocations(locs);
    const headClean = head.replace(SRC_G, "").trimEnd();
    out.push(compressed.length ? `${headClean} (출처: ${compressed.join(", ")})` : headClean);
    body.forEach(l => out.push(l.replace(SRC_G, "").trimEnd()));
  }
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
      // '방법/절차'는 항목(번호 목록)마다 출처가 많아 헤딩에 모으면 p.X가 잔뜩 붙는다.
      // 시험 포인트처럼 각 항목 옆 인라인 출처를 그대로 둔다(헤딩에 모으지 않음).
      const isKeepInlineSection = /방법\s*\/?\s*절차/.test(line);
      if (isInlineSourceSection) {
        result.push(line);
        formatExamCards(sectionLines).forEach(l => result.push(l));
      } else if (isKeepInlineSection) {
        result.push(line);
        formatMethodSection(sectionLines).forEach(l => result.push(l));
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

// '핵심 개념'에서 '- **라벨**' 글머리 아래 내용이 딱 하나뿐이면(자식 bullet 1개·손자 없음)
// '- **라벨**: 내용' 한 줄로 합친다. 라벨과 단일 자식이 글머리 두 개로 갈려 어지러워 보이는 걸 막는다.
// 자식이 2개 이상이거나 더 깊은 하위가 있으면 그대로 둔다. 코드블록·인용문(>)·번호목록은 매칭되지 않아 안 건드린다.
const collapseSingleChildBullets = (markdown: string): string => {
  const LABEL = /^(\s*)([-*])\s+\*\*\s*([^*\n]+?)\s*\*\*\s*[:：]?\s*$/;
  const CHILD = /^(\s*)([-*])\s+(\S.*)$/;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; out.push(line); i += 1; continue; }
    const label = inFence ? null : line.match(LABEL);
    const child = label ? lines[i + 1]?.match(CHILD) : null;
    if (label && child && child[1].length > label[1].length) {
      const after = lines[i + 2];
      const afterIndent = after ? (after.match(/^\s*/)?.[0].length ?? 0) : 0;
      // 자식 다음 줄이 형제(같은 깊이)·손자(더 깊은 깊이)면 단일 leaf가 아니라 합치지 않는다.
      const hasMore = !!after && after.trim() !== "" && afterIndent >= child[1].length;
      if (!hasMore) {
        const labelText = label[3].replace(/[:：]\s*$/, "").trim();
        out.push(`${label[1]}${label[2]} **${labelText}**: ${child[3].trim()}`);
        i += 2;
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
};

// 강의 노트에서만 단일 자식 글머리를 병합한다(화면 렌더·전체 복사·PDF에 동일 적용).
export const collapseForLectureNote = (template: SummaryTemplate | undefined, markdown: string): string =>
  template === "LECTURE_NOTE" ? collapseSingleChildBullets(markdown) : markdown;

// LLM이 출처를 '(출처: ...)' 대신, 입력에 박힌 페이지/슬라이드 마커(<!-- p.N -->, <!-- Slide number: N -->)를
// 그대로 베껴 출력하는 경우가 있다(본문에 마커가 노출됨). 이를 (출처: p.N)로 정규화해 기존 출처 배지
// 시스템(SOURCE_PATTERN·hoistSourceToHeadings)에 태운다. 코드블록의 일반 HTML 주석은 패턴이 달라 보존된다.
const PAGE_MARKER_PATTERN = /<!--\s*(?:p\.\s*(\d+)|Slide number:\s*(\d+))\s*-->/gi;

const normalizePageMarkers = (markdown: string): string =>
  markdown.replace(PAGE_MARKER_PATTERN, (_m, page, slide) => `(출처: p.${page ?? slide})`);

export const normalizeMarkdownContent = (content: string) =>
  // 수식 구분자 정규화를 가장 먼저 돌려, 이후 처리가 이미 $-구분된 텍스트 위에서 동작하게 한다.
  // 곱셈 별표 이스케이프는 그 직후(이제 수식이 $로 보호됨)에 돌려, 산문 속 `5*5*3`만 \*로 바꾼다.
  normalizePageMarkers(
    normalizeBoldSpacing(escapeStrayMultiplication(normalizeMathDelimiters(content.replace(/\r\n/g, "\n").trim()))),
  );
