import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { SummaryTemplate } from "../../services/gpt";
import { MindmapView } from "../../components/MindmapView";
import { parseMindmapJson } from "../../components/mindmapData";
import { cheatSheetMarkdownComponents, collapseForLectureNote, hoistSourceToHeadings, markInlineExamPoints, markdownComponents, normalizeMarkdownContent, simplifySoleFileSources } from "./markdown";

export const FormattedAiText = ({ content, template }: { content: string; template?: SummaryTemplate }) => {
  const normalized = markInlineExamPoints(normalizeMarkdownContent(content));
  const hoisted = template && template !== "MINDMAP" ? hoistSourceToHeadings(normalized) : normalized;
  // 강의 노트의 '핵심 개념'에서 라벨+단일 자식 글머리를 한 줄로 합쳐 글머리 중첩을 줄인다.
  const collapsed = collapseForLectureNote(template, hoisted);
  const cleaned = simplifySoleFileSources(collapsed);
  if (!cleaned) return null;

  if (template === "CHEAT_SHEET") {
    return (
      <div style={{
        columnCount: 2,
        columnWidth: 420,
        columnGap: 34,
        columnRule: "1px solid var(--color-border-soft)",
      }}>
        <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]} rehypePlugins={[rehypeKatex]} components={cheatSheetMarkdownComponents}>
          {cleaned}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
      {cleaned}
    </ReactMarkdown>
  );
};

export const SummaryContentView = ({ content, template, onNodeFocus, persistKey }: { content: string; template?: SummaryTemplate; onNodeFocus?: (label: string, pathLabels: string[]) => void; persistKey?: string }) => {
  const mindmap = template === "MINDMAP" ? parseMindmapJson(content) : null;
  return mindmap
    ? <MindmapView data={mindmap} onNodeFocus={onNodeFocus} persistKey={persistKey} />
    : <FormattedAiText content={content} template={template} />;
};
