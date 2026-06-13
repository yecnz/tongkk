import { useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CARD_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, PINK } from "../common";
import { MindmapView } from "./MindmapView";
import {
  SAMPLE_TOPIC,
  SAMPLE_SOURCE_NAME,
  sampleOriginalMarkdown,
  sampleSummaries,
  sampleMindmap,
  sampleQuiz,
  type SampleSummaryKind,
  type SampleQuizQuestion,
} from "../sampleDemoContent";

// '예시로 둘러보기' — 우리가 지정한 샘플 자료(부록 A: 시간 복잡도·정렬)로 원본 → 4종 요약 → 퀴즈를
// 읽기 전용으로 보여주는 오버레이. 서버/AI 호출 없이 정적 콘텐츠만 렌더한다(게스트도 동작).
// 규칙: 흰 배경 + 사방 중립 테두리(왼쪽 색 띠 금지), 색은 var(--color-*) 토큰만.

// 마크다운 children에서 순수 텍스트만 뽑는다('답:' 라벨 판별·코드블록 판별용).
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

// 실제 요약 렌더러(Summary.tsx markdownComponents)와 동일한 양식 — 제목 박스, '>' 인용문 카드,
// 코드블록 구조도, 표를 토큰 색으로 렌더한다(왼쪽 색 띠 없이 사방 중립 테두리).
const md: Components = {
  h1: ({ children }) => <h1 style={{ margin: "0 0 14px", paddingBottom: 9, borderBottom: "2px solid var(--color-border-soft)", fontSize: 19, lineHeight: 1.35, fontWeight: 850, color: "var(--color-text-strong)" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: "22px 0 10px", padding: "8px 11px", borderRadius: 8, background: "var(--color-surface)", fontSize: 15.5, lineHeight: 1.45, fontWeight: 850, color: "var(--color-text-strong)" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ display: "inline-block", margin: "16px 0 7px", padding: "3px 8px", borderRadius: 6, background: "var(--color-surface)", fontSize: 13.5, lineHeight: 1.45, fontWeight: 800, color: "var(--color-text-strong)" }}>{children}</h3>,
  p: ({ children }) => <p style={{ margin: "0 0 10px", lineHeight: 1.7, color: "var(--color-text)" }}>{children}</p>,
  strong: ({ children }) => <strong style={{ fontWeight: 800, color: "var(--color-text-strong)" }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: "var(--color-text)" }}>{children}</em>,
  ul: ({ children }) => <ul style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.7, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.7, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => {
    const isAnswerLabel = nodeText(children).trimStart().startsWith("답:");
    return <li style={{ marginBottom: 4, ...(isAnswerLabel ? { listStyleType: "none", fontWeight: 700 } : {}) }}>{children}</li>;
  },
  blockquote: ({ children }) => <blockquote style={{ margin: "14px 0", padding: "12px 15px", border: "1px solid var(--color-border-soft)", borderRadius: 12, background: "var(--color-surface)", color: "var(--color-text)" }}>{children}</blockquote>,
  pre: ({ children }) => <pre style={{ margin: "12px 0", padding: 14, borderRadius: 12, background: "var(--color-surface)", border: "1px solid var(--color-border-soft)", overflowX: "auto", lineHeight: 1.55, fontSize: 13 }}>{children}</pre>,
  code: ({ className, children }) => {
    const block = Boolean(className) || nodeText(children).includes("\n");
    return block
      ? <code className={className} style={{ fontFamily: "ui-monospace, Menlo, Monaco, monospace", fontSize: 13, whiteSpace: "pre" }}>{children}</code>
      : <code style={{ padding: "2px 6px", borderRadius: 6, background: "var(--color-surface)", fontFamily: "ui-monospace, Menlo, Monaco, monospace", fontSize: "0.92em", fontWeight: 700 }}>{children}</code>;
  },
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "10px 0 14px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ padding: "8px 10px", background: "var(--color-tint-pink)", color: "var(--color-text-strong)", fontWeight: 800, border: "1px solid color-mix(in srgb, var(--color-pink) 30%, transparent)", textAlign: "left", whiteSpace: "nowrap" }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: "7px 10px", border: "1px solid var(--color-border-soft)", color: "var(--color-text)", lineHeight: 1.55 }}>{children}</td>,
};

const Markdown = ({ children }: { children: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={md}>
    {children}
  </ReactMarkdown>
);

// 인라인 문맥(퀴즈 문항·보기·정답·해설)용 — 문단을 <span>으로 렌더해 <p> 안의 <p>/<span> 안의 <p>
// 같은 잘못된 중첩을 막는다(수식·굵게만 필요하므로 블록 요소는 등장하지 않는다).
const inlineMd: Components = { ...md, p: ({ children }) => <span>{children}</span> };
const InlineMarkdown = ({ children }: { children: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={inlineMd}>
    {children}
  </ReactMarkdown>
);

type Tab = "original" | "summary" | "quiz";

const TABS: { id: Tab; label: string }[] = [
  { id: "original", label: "원본" },
  { id: "summary", label: "요약" },
  { id: "quiz", label: "퀴즈" },
];

const TYPE_COLORS: Record<SampleQuizQuestion["type"], string> = {
  객관식: "var(--color-tint-pink)",
  OX: "var(--color-tint-cyan)",
  단답형: "var(--color-tint-cyan)",
  주관식: "var(--color-tint-pink)",
};

function QuizCard({ q, index }: { q: SampleQuizQuestion; index: number }) {
  return (
    <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 12, background: CARD_BACKGROUND, border: `1px solid ${BORDER_COLOR}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-muted)" }}>Q{index + 1}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", padding: "2px 8px", borderRadius: 999, background: TYPE_COLORS[q.type] }}>{q.type}</span>
      </div>
      <div style={{ fontWeight: 700, color: "var(--color-text-strong)", marginBottom: 10 }}>
        <InlineMarkdown>{q.question}</InlineMarkdown>
      </div>

      {q.options && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {q.options.map((opt, i) => {
            const correct = i === q.answerIndex;
            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10,
                  border: `1px solid ${correct ? "color-mix(in srgb, var(--color-cyan) 45%, transparent)" : BORDER_COLOR}`,
                  background: correct ? "var(--color-tint-cyan)" : "transparent",
                  fontWeight: correct ? 700 : 400,
                  color: correct ? "var(--color-cyan-deep)" : "var(--color-text)",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--color-muted)", minWidth: 14 }}>{i + 1}</span>
                <span style={{ flex: 1 }}><InlineMarkdown>{opt}</InlineMarkdown></span>
                {correct && <span style={{ fontSize: 13, fontWeight: 800 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}

      {!q.options && q.answer && (
        <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 10, background: "var(--color-tint-cyan)", border: "1px solid color-mix(in srgb, var(--color-cyan) 45%, transparent)", color: "var(--color-cyan-deep)", fontWeight: 700 }}>
          <span style={{ fontSize: 12, fontWeight: 800, marginRight: 6 }}>{q.type === "주관식" ? "모범답안" : "정답"}</span>
          <span style={{ display: "inline-block" }}><InlineMarkdown>{q.answer}</InlineMarkdown></span>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--color-muted)" }}>
        <span style={{ fontWeight: 700 }}>해설 </span>
        <span style={{ display: "inline" }}><InlineMarkdown>{q.explanation}</InlineMarkdown></span>
      </p>
    </div>
  );
}

export function SampleDemo({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const [tab, setTab] = useState<Tab>("original");
  const [summaryKind, setSummaryKind] = useState<SampleSummaryKind>("GENERAL");
  const summary = sampleSummaries.find(s => s.kind === summaryKind) ?? sampleSummaries[0];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 360, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15, 23, 42, 0.28)", backdropFilter: "blur(6px)", padding: 24, boxSizing: "border-box",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(920px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          background: CARD_BACKGROUND, border: `1px solid ${BORDER_COLOR}`, borderRadius: 18,
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)", overflow: "hidden", boxSizing: "border-box",
        }}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "18px 22px 14px", borderBottom: `1px solid ${BORDER_COLOR}` }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: PINK, padding: "2px 8px", borderRadius: 999, background: "var(--color-tint-pink)" }}>예시</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 850, color: "var(--color-text-strong)" }}>{SAMPLE_TOPIC}</h2>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--color-muted)" }}>
              샘플 자료 <strong style={{ fontWeight: 700, color: "var(--color-text-secondary)" }}>{SAMPLE_SOURCE_NAME}</strong>로 만든 예시예요. 실제로는 내 강의 자료를 올려 만들어요.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="예시 닫기" style={{ background: "none", border: "none", fontSize: 18, color: "var(--color-muted)", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
        </div>

        {/* 탭 */}
        <div style={{ display: "flex", gap: 6, padding: "12px 22px 0" }}>
          {TABS.map(t => {
            const activeTab = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  padding: "7px 16px", borderRadius: 999, border: `1px solid ${activeTab ? "transparent" : BORDER_COLOR}`,
                  background: activeTab ? PINK : "transparent", color: activeTab ? "var(--color-on-brand)" : "var(--color-text-secondary)",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 8px", fontSize: 13 }}>
          {tab === "original" && <Markdown>{sampleOriginalMarkdown}</Markdown>}

          {tab === "summary" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {sampleSummaries.map(s => {
                  const activeKind = s.kind === summaryKind;
                  return (
                    <button
                      key={s.kind}
                      type="button"
                      onClick={() => setSummaryKind(s.kind)}
                      style={{
                        padding: "6px 14px", borderRadius: 999, border: `1px solid ${activeKind ? "transparent" : BORDER_COLOR}`,
                        background: activeKind ? "var(--color-tint-pink)" : "transparent", color: activeKind ? PINK : "var(--color-text-secondary)",
                        fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {summaryKind === "MINDMAP"
                ? <MindmapView data={sampleMindmap} initialExpanded />
                : <Markdown>{summary.markdown}</Markdown>}
            </>
          )}

          {tab === "quiz" && (
            <>
              <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--color-muted)" }}>
                자료로 만든 샘플 퀴즈예요. 객관식·OX·단답형·주관식이 섞여 있고, 주관식은 AI가 채점해요.
              </p>
              {sampleQuiz.map((q, i) => <QuizCard key={i} q={q} index={i} />)}
            </>
          )}
        </div>

        {/* 푸터 CTA */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 22px", borderTop: `1px solid ${BORDER_COLOR}`, background: MUTED_SURFACE }}>
          <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>마음에 드세요? 내 강의 자료로 직접 만들어 보세요.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 16px", borderRadius: 12, border: `1px solid ${BORDER_COLOR}`, background: CARD_BACKGROUND, color: "var(--color-text-secondary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>닫기</button>
            <button type="button" onClick={onStart} style={{ padding: "10px 18px", borderRadius: 12, border: "none", background: PINK, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>내 자료로 시작하기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
