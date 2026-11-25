import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeBoldSpacing, normalizeMathDelimiters, escapeStrayMultiplication } from '../../common';
import { useSourceCitationScope } from '../../features/sources/citationContext';
import { remarkSourceCitations } from '../../features/sources/sourceNavigation';
import { SourceCitationAnchor } from '../../features/sources/SourceCitationAnchor';

// LLM이 만든 문제·보기·해설에는 수식($...$ / $$...$$)·굵게·곱셈 별표가 섞여 있어, 평문으로
// 그대로 출력하면 KaTeX가 깨지거나 별표가 강조로 먹혀 사라진다(이슈 #62). 요약·AI 튜터와
// 똑같은 정규화 체인 + remark-math/rehype-katex로 렌더한다. 제목·보기·해설 한 줄 안에
// 인라인으로 들어가야 하므로 p를 블록이 아닌 흐름(fragment)으로 펼친다.
// (사용자가 직접 입력한 답안에는 적용하지 않는다 — LLM이 생성한 텍스트에만 쓴다.)
const quizMarkdownComponents: Components = {
  p: ({ children }) => <>{children}</>,
  code: ({ children, className }) => (
    <code className={className} style={{ padding: className ? 0 : "1px 5px", borderRadius: 5, background: className ? "transparent" : "var(--color-surface)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.92em" }}>
      {children}
    </code>
  ),
};

export default function QuizText({ children, sources = false }: { children?: string | null; sources?: boolean }) {
  const sourceScope = useSourceCitationScope();
  const text = (children ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  // 단일 '~'(예: 'p.8~p.9')를 취소선으로 오인하지 않도록 singleTilde:false.
  const cleaned = normalizeBoldSpacing(escapeStrayMultiplication(normalizeMathDelimiters(text)));
  return (
    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, ...(sources ? [[remarkSourceCitations, sourceScope] as [typeof remarkSourceCitations, typeof sourceScope]] : [])]} rehypePlugins={[rehypeKatex]} components={{ ...quizMarkdownComponents, a: SourceCitationAnchor }}>
      {cleaned}
    </ReactMarkdown>
  );
};
