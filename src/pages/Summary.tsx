import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { summarizeWithTemplate, type SummaryTemplate } from "../services/gpt";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";
import { getPdfPageCount } from "../services/pdfPageCount";
import {
  deleteSummariesByMaterialId,
  loadSummariesFromServer,
  saveSummaryToServer,
  type SavedSummary,
} from "../services/summaries";
import { loadQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadQuizAttemptsFromServer, type SavedQuizAttempt } from "../services/quizAttempts";
import { MindmapView } from "../components/MindmapView";
import { parseMindmapJson } from "../components/mindmapData";
import {
  combineMaterialsMarkdown,
  createCourseMaterialFileUrl,
  getFileMaterialId,
  loadCourseMaterialsFromServer,
  saveCourseMaterials,
  uploadCourseMaterialFile,
  type CourseMaterial,
} from "../services/materials";
import { AITutorDrawer } from "../components/AITutorDrawer";

type FileKind = "pdf" | "ppt" | "img" | "file";
type SummaryView = "upload" | "templates" | "summaryResult" | "quizCreate" | "materialDetail";
type MaterialDetailTab = "original" | "summary" | "quiz";
type UploadedFile = { name: string; size: number; type: FileKind; pages: number | null; slides: number | null; rawFile: File };
type DuplicateFileNotice = { names: string[] };
type SummarySample = { title: string; content: string };
type LocationState = {
  selectedCourse?: string;
  fromDashboard?: boolean;
  materialId?: string;
  viewMaterial?: boolean;
  summaryId?: string;
  summaryTemplate?: SummaryTemplate;
  summaryContent?: string;
  summaryCreatedAt?: number;
  materialIds?: string[];
  openSummary?: boolean;
  tutorQuestion?: string;
  materialDetailTab?: MaterialDetailTab;
} | null;
type FileIconProps = { type: FileKind };
type TemplateSelectViewProps = { onSelect: (template: SummaryTemplate) => void; onBack: () => void };
type SummaryResultViewProps = { template: SummaryTemplate; onBack: () => void; contextTitle: string; realContent: string; isLoading: boolean; error: string; loadingStep: string; elapsedTime: string | null; threadId: string; summaryId: string | null; resetTutorHistory?: boolean; initialTutorQuestion?: string; onGoToQuiz?: () => void };
type MaterialDetailViewProps = {
  material: CourseMaterial;
  selectedCourse: string;
  onBack: () => void;
  onGoSummary: () => void;
  onGoQuiz: () => void;
  onOpenSummary: (summary: SavedSummary) => void;
  onOpenQuiz: (quizSet: SavedQuizSet) => void;
  initialTab?: MaterialDetailTab;
  initialTutorQuestion?: string;
  relatedMaterials?: CourseMaterial[];
  onSelectRelatedMaterial?: (material: CourseMaterial) => void;
};
type QuizCreateViewProps = { fileName?: string; onBack: () => void; onCreate: () => void };

const templateLabels: Record<SummaryTemplate, string> = {
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

const suggestedTutorQuestions: Record<SummaryTemplate, string[]> = {
  GENERAL: [
    "이 요약을 처음 듣는 사람 기준으로 쉽게 설명해줘",
    "시험에 나올 핵심 포인트만 5개로 정리해줘",
    "중요 용어를 예시와 함께 설명해줘",
    "헷갈리기 쉬운 개념을 비교해서 설명해줘",
  ],
  LECTURE_NOTE: [
    "이번 강의 흐름을 단계별로 다시 설명해줘",
    "교수님이 시험에 낼 만한 질문을 뽑아줘",
    "핵심 개념 사이의 관계를 설명해줘",
    "내가 복습할 수 있게 질문을 하나씩 내줘",
  ],
  MINDMAP: [
    "마인드맵의 큰 가지별 의미를 설명해줘",
    "가지 사이의 관계를 쉬운 예시로 설명해줘",
    "가장 먼저 외워야 할 개념부터 정리해줘",
    "이 구조로 시험 대비 순서를 짜줘",
  ],
  CHEAT_SHEET: [
    "이 치트시트에서 꼭 외워야 할 것만 골라줘",
    "비슷해서 헷갈리는 항목을 비교해줘",
    "빈칸 문제처럼 나한테 질문해줘",
    "시험 직전 5분 복습 순서를 만들어줘",
  ],
};

const FileIcon = ({ type }: FileIconProps) => {
  const colors: Record<FileKind, string> = { pdf: "#E74C3C", ppt: "#E67E22", img: "#27AE60", file: "#999" };
  const labels: Record<FileKind, string> = { pdf: "PDF", ppt: "PPT", img: "IMG", file: "FILE" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 40, height: 28, borderRadius: 6, fontSize: 11, fontWeight: 700,
      color: "#fff", background: colors[type] || "#999"
    }}>{labels[type] || "FILE"}</span>
  );
};

const getFileType = (name: string): FileKind => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"].includes(ext)) return "img";
  return "file";
};

const isSupportedDocumentFile = (file: File) =>
  ["pdf", "ppt", "pptx", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes((file.name.split(".").pop() || "").toLowerCase());

const extractMarkdownFromMaterialFile = (file: File) => extractMarkdownFromPDF(file);

const getFileNameKey = (name: string) => name.trim().toLowerCase();
const sameMaterialIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

const isPageReload = () => {
  if (typeof window === "undefined") return false;
  const navigationEntry = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigationEntry?.type === "reload") return true;
  const legacyNavigation = window.performance as Performance & { navigation?: { type: number; TYPE_RELOAD: number } };
  return legacyNavigation.navigation?.type === legacyNavigation.navigation?.TYPE_RELOAD;
};

const summaryData: Record<SummaryTemplate, SummarySample> = {
  GENERAL: {
    title: "일반 요약",
    content: "핵심 결론\n이 자료는 **동적 프로그래밍**의 개념, 적용 조건, 구현 방식을 설명합니다.\n\n주요 내용\n- **동적 프로그래밍**은 반복되는 하위 문제의 결과를 저장해 재사용합니다.\n- 적용 조건은 **최적 부분 구조**와 **중복 부분 문제**입니다.\n- 구현 방식은 **메모이제이션**과 **타뷸레이션**으로 나뉩니다.\n\n한 줄 요약\n동적 프로그래밍은 중복 계산을 줄여 복잡한 문제를 효율적으로 푸는 방법입니다.",
  },
  LECTURE_NOTE: {
    title: "강의 노트",
    content: "핵심 개념\n**동적 프로그래밍**은 큰 문제를 작은 하위 문제로 나누고, 이미 계산한 결과를 저장해 재사용하는 알고리즘 설계 기법입니다.\n\n주요 내용\n- **최적 부분 구조**: 전체 문제의 최적해가 부분 문제의 최적해로 구성됩니다.\n- **중복 부분 문제**: 같은 하위 문제가 반복해서 등장합니다.\n\n시험 포인트\n1. **메모이제이션**과 **타뷸레이션**의 차이를 구분합니다.\n2. DP가 적용되기 위한 조건을 설명할 수 있어야 합니다.",
  },
  MINDMAP: {
    title: "마인드맵",
    content: "중심 주제\n**동적 프로그래밍**\n\n주요 가지\n- **적용 조건**\n  - 최적 부분 구조\n  - 중복 부분 문제\n- **구현 방식**\n  - 메모이제이션\n  - 타뷸레이션\n- **대표 문제**\n  - 피보나치\n  - 배낭 문제\n  - LCS\n\n핵심 연결\n- 반복 계산을 줄이면 시간 복잡도를 개선할 수 있습니다.",
  },
  CHEAT_SHEET: {
    title: "치트시트",
    content: "빠른 암기표\n- **DP 적용 조건**: 최적 부분 구조, 중복 부분 문제\n- **Top-down**: 재귀 + 메모이제이션\n- **Bottom-up**: 반복문 + 테이블\n\n자주 나오는 비교\n- **메모이제이션**: 필요한 값만 계산, 재귀 호출 사용\n- **타뷸레이션**: 작은 문제부터 순서대로 계산, 반복문 사용\n\n시험 직전 체크\n- DP 조건 2가지를 말할 수 있는가?\n- 대표 문제와 구현 방식을 연결할 수 있는가?",
  },
};

const renderInlineText = (text: string): ReactNode[] => {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} style={{ fontWeight: 700, color: "#222" }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const markdownStyles = {
  paragraph: { margin: "0 0 10px", lineHeight: 1.8, color: "#444" } satisfies CSSProperties,
  list: { margin: "6px 0 14px", paddingLeft: 24, lineHeight: 1.75 } satisfies CSSProperties,
  tableWrap: { overflowX: "auto", margin: "12px 0 16px" } satisfies CSSProperties,
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 style={{ margin: "0 0 18px", paddingBottom: 12, borderBottom: "2px solid #f0f0f0", fontSize: 24, lineHeight: 1.35, fontWeight: 850, color: "#222" }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ margin: "26px 0 12px", paddingTop: 18, borderTop: "1px solid #f0f0f0", fontSize: 20, lineHeight: 1.45, fontWeight: 850, color: "#222" }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 style={{ margin: "20px 0 10px", fontSize: 17, lineHeight: 1.45, fontWeight: 800, color: "#222" }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ margin: "16px 0 8px", fontSize: 15, lineHeight: 1.45, fontWeight: 800, color: "#333" }}>{children}</h4>,
  h5: ({ children }) => <h5 style={{ margin: "14px 0 8px", fontSize: 14, lineHeight: 1.45, fontWeight: 800, color: "#444" }}>{children}</h5>,
  h6: ({ children }) => <h6 style={{ margin: "12px 0 8px", fontSize: 13, lineHeight: 1.45, fontWeight: 800, color: "#555" }}>{children}</h6>,
  p: ({ children }) => <p style={markdownStyles.paragraph}>{children}</p>,
  ul: ({ children }) => <ul style={{ ...markdownStyles.list, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ ...markdownStyles.list, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 6, paddingLeft: 4 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 800, color: "#222" }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: "#555" }}>{children}</em>,
  blockquote: ({ children }) => (
    <blockquote style={{ margin: "14px 0", padding: "10px 14px", borderLeft: `4px solid ${PINK}`, borderRadius: 8, background: "#FFF7FB", color: "#555" }}>
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    if (className) {
      return <code className={className} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 13 }}>{children}</code>;
    }
    return (
      <code style={{ padding: "2px 6px", borderRadius: 6, background: "#f3f4f6", color: "#d6336c", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.92em" }}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre style={{ margin: "14px 0", padding: 16, borderRadius: 12, background: "#f6f7f9", border: "1px solid #eceff3", overflowX: "auto", lineHeight: 1.6 }}>
      {children}
    </pre>
  ),
  hr: () => <hr style={{ margin: "22px 0", border: "none", borderTop: "1px solid #ededed" }} />,
  table: ({ children }) => (
    <div style={markdownStyles.tableWrap}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480, fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ padding: "9px 12px", background: "#FFF0F6", color: "#333", fontWeight: 800, border: "1px solid #f0c0d0", textAlign: "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td style={{ padding: "8px 12px", border: "1px solid #f0e0e8", color: "#444", lineHeight: 1.6 }}>{children}</td>,
};

const normalizeMarkdownContent = (content: string) => content.replace(/\r\n/g, "\n").trim();

const splitCheatSheetSections = (content: string) => {
  const lines = normalizeMarkdownContent(content).split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  lines.forEach((line, index) => {
    const isSectionStart = /^(#{1,3}\s+|\*\*[^*]+\*\*\s*$)/.test(line.trim());
    if (isSectionStart && current.some(item => item.trim())) {
      sections.push(current.join("\n").trim());
      current = [];
    }
    current.push(line);
    if (index === lines.length - 1 && current.some(item => item.trim())) {
      sections.push(current.join("\n").trim());
    }
  });

  return sections.length > 1 ? sections : [normalizeMarkdownContent(content)];
};

const FormattedAiText = ({ content, template }: { content: string; template?: SummaryTemplate }) => {
  const cleaned = normalizeMarkdownContent(content);
  if (!cleaned) return null;

  if (template === "CHEAT_SHEET") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {splitCheatSheetSections(cleaned).map((section, index) => (
          <div key={index} style={{ padding: 18, borderRadius: 12, border: "1px solid #eeeeee", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {section}
            </ReactMarkdown>
          </div>
        ))}
      </div>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {cleaned}
    </ReactMarkdown>
  );
};

const PdfFormattedAiText = ({ content }: { content: string }) => {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");

  return (
    <div>
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={index} style={{ height: 10 }} />;

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <div key={index} style={{
              display: "block",
              margin: `${index === 0 ? 0 : 16}px 0 8px`,
              fontSize: level <= 2 ? 20 : 17,
              fontWeight: 800,
              lineHeight: "28px",
              color: "#222",
            }}>
              {renderInlineText(heading[2])}
            </div>
          );
        }

        const boldHeading = line.match(/^\*\*(.+)\*\*$/);
        if (boldHeading) {
          return (
            <div key={index} style={{
              display: "block",
              margin: `${index === 0 ? 0 : 14}px 0 8px`,
              fontSize: 17,
              fontWeight: 800,
              lineHeight: "26px",
              color: "#222",
            }}>
              {renderInlineText(boldHeading[1])}
            </div>
          );
        }

        const bullet = line.match(/^[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={index} style={{
              display: "block",
              margin: "0 0 8px 0",
              paddingLeft: 18,
              position: "relative",
              lineHeight: "25px",
            }}>
              <span style={{
                position: "absolute",
                left: 2,
                top: 10,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: PINK,
              }} />
              {renderInlineText(bullet[1])}
            </div>
          );
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          return (
            <div key={index} style={{
              display: "block",
              margin: "0 0 8px 0",
              paddingLeft: 28,
              position: "relative",
              lineHeight: "25px",
            }}>
              <strong style={{
                position: "absolute",
                left: 0,
                top: 0,
                color: PINK,
                fontWeight: 800,
              }}>{numbered[1]}.</strong>
              {renderInlineText(numbered[2])}
            </div>
          );
        }

        return (
          <div key={index} style={{
            display: "block",
            margin: "0 0 8px 0",
            lineHeight: "25px",
          }}>
            {renderInlineText(line)}
          </div>
        );
      })}
    </div>
  );
};

const TemplateSelectView = ({ onSelect, onBack }: TemplateSelectViewProps) => {
  const templates: Array<{ key: SummaryTemplate; name: string; desc: string; accent: string }> = [
    { key: "GENERAL", name: "일반 요약", desc: "핵심 내용과 결론을 빠르게 정리", accent: "#555" },
    { key: "LECTURE_NOTE", name: "강의 노트", desc: "개념, 흐름, 시험 포인트를 구조화", accent: PINK },
    { key: "MINDMAP", name: "마인드맵", desc: "중심 주제와 하위 개념의 관계를 구조화", accent: CYAN },
    { key: "CHEAT_SHEET", name: "치트시트", desc: "시험 직전 빠르게 보는 암기표", accent: "#7C3AED" },
  ];

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#222" }}>출력 템플릿 선택</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#999" }}>요약 결과를 어떤 형식으로 만들지 선택하세요</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {templates.map(t => (
          <Card key={t.key} style={{ padding: 0, overflow: "hidden" }}>
            <button onClick={() => onSelect(t.key)} style={{
              width: "100%",
              minHeight: 190,
              padding: 24,
              border: "none",
              background: "#fff",
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}>
              <div>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: t.accent, marginBottom: 18 }} />
                <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: "#222" }}>{t.name}</h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#666" }}>{t.desc}</p>
              </div>
              <span style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: t.accent }}>선택하기</span>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
};

const SummaryResultView = ({ template, onBack, contextTitle, realContent, isLoading, error, loadingStep, elapsedTime, threadId, summaryId, resetTutorHistory = false, initialTutorQuestion, onGoToQuiz }: SummaryResultViewProps) => {
  const data = summaryData[template];
  const displayContent = realContent || data.content;
  const mindmapData = template === "MINDMAP" && displayContent ? parseMindmapJson(displayContent) : null;
  const [actionMessage, setActionMessage] = useState("");
  const [pdfSaving, setPdfSaving] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement | null>(null);
  const questions = suggestedTutorQuestions[template];

  const exportText = `${templateLabels[template]} 요약\n\n${displayContent}`;

  const handleDownload = async () => {
    if (!pdfExportRef.current || pdfSaving) return;

    setActionMessage("PDF를 생성 중입니다...");
    setPdfSaving(true);

    try {
      await document.fonts.ready;
      const exportNode = pdfExportRef.current;
      if (!exportNode) return;

      // 캡처 전 전체 뷰포트를 흰 막으로 덮어 다른 콘텐츠 유입 차단
      const backdrop = document.createElement("div");
      backdrop.setAttribute("data-pdf-backdrop", "");
      backdrop.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99998;";
      document.body.appendChild(backdrop);

      exportNode.style.left = "0px";
      exportNode.style.top = "0px";
      exportNode.style.zIndex = "99999";
      exportNode.style.letterSpacing = "0.01px";
      void exportNode.getBoundingClientRect();

      const canvas = await html2canvas(exportNode, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
      });

      document.body.removeChild(backdrop);
      exportNode.style.left = "-10000px";
      exportNode.style.top = "0px";
      exportNode.style.zIndex = "-1";
      exportNode.style.letterSpacing = "";
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;
      let heightLeft = imgHeight;
      let y = margin;

      pdf.addImage(imgData, "PNG", margin, y, contentWidth, imgHeight);
      heightLeft -= contentHeight;

      while (heightLeft > 0) {
        pdf.addPage();
        y -= contentHeight;
        pdf.addImage(imgData, "PNG", margin, y, contentWidth, imgHeight);
        heightLeft -= contentHeight;
      }

      pdf.save(`tongkk-${template.toLowerCase()}-summary.pdf`);
      setActionMessage("PDF를 다운로드했습니다.");
    } catch {
      document.querySelectorAll<HTMLElement>('[data-pdf-backdrop]').forEach(el => el.remove());
      if (pdfExportRef.current) {
        pdfExportRef.current.style.left = "-10000px";
        pdfExportRef.current.style.zIndex = "-1";
        pdfExportRef.current.style.letterSpacing = "";
      }
      setActionMessage("PDF 다운로드에 실패했습니다.");
    } finally {
      setPdfSaving(false);
    }
  };

  const copySummaryToClipboard = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(exportText);
      return;
    }

    const textArea = document.createElement("textarea");
    textArea.value = exportText;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();

    const copied = document.execCommand("copy");
    textArea.remove();
    if (!copied) throw new Error("Clipboard copy failed");
  };

  const handleCopyAll = async () => {
    setActionMessage("");
    try {
      await copySummaryToClipboard();
      setActionMessage("요약본 전체를 클립보드에 복사했습니다.");
    } catch {
      setActionMessage("전체 복사에 실패했습니다.");
    }
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 템플릿 선택으로</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{
              padding: "9px 18px", borderRadius: 999, border: "2px solid #eeeeee",
              background: "#fff", fontSize: 17, fontWeight: 600, flex: "0 0 auto",
              color: template === "GENERAL" ? "#555" : template === "LECTURE_NOTE" ? PINK : template === "MINDMAP" ? CYAN : "#7C3AED"
            }}>{templateLabels[template]}</span>
            {isLoading && (
              <span style={{ fontSize: 13, color: "#aaa", fontWeight: 700 }}>
                AI가 요약 중...
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
            {isLoading && (
              <span style={{
                padding: "6px 10px", borderRadius: 999, background: "#FFF7FB",
                color: PINK, fontSize: 12, fontWeight: 800
              }}>요약 중</span>
            )}
            {!isLoading && elapsedTime && (
              <span style={{
                padding: "6px 10px", borderRadius: 999, background: "#fafafa",
                color: "#999", fontSize: 12, fontWeight: 700
              }}>{elapsedTime}초</span>
            )}
            {!isLoading && (
              <>
                <button onClick={handleCopyAll} style={{
                  height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid #e0e0e0",
                  background: "#fff", color: "#555", fontSize: 13, fontWeight: 700, cursor: "pointer"
                }}>전체 복사</button>
                <button onClick={handleDownload} disabled={pdfSaving} style={{
                  height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid #e0e0e0",
                  background: pdfSaving ? "#d9f5f9" : "#70dff0",
                  color: "#555", fontSize: 13, fontWeight: 600,
                  cursor: pdfSaving ? "default" : "pointer",
                  opacity: pdfSaving ? 0.75 : 1,
                }}>{pdfSaving ? "PDF 생성 중" : "PDF 다운로드"}</button>
                {realContent && !error && onGoToQuiz && (
                  <button onClick={onGoToQuiz} style={{
                    height: 34, padding: "0 14px", borderRadius: 10, border: "none",
                    background: PINK, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer"
                  }}>퀴즈 생성하기</button>
                )}
              </>
            )}
          </div>
        </div>
        {actionMessage && !isLoading && (
          <div style={{ margin: "-6px 0 16px", fontSize: 12, color: "#888", textAlign: "right" }}>
            {actionMessage}
          </div>
        )}
        {!isLoading && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, borderBottom: "1px solid #f0f0f0" }}>
            <button type="button" style={{
              padding: "10px 4px 12px",
              border: "none",
              borderBottom: `2px solid ${PINK}`,
              background: "transparent",
              color: "#222",
              fontSize: 14,
              fontWeight: 800,
              cursor: "default",
            }}>요약 결과</button>
            {onGoToQuiz && (
              <button type="button" onClick={onGoToQuiz} style={{
                padding: "10px 4px 12px",
                border: "none",
                borderBottom: "2px solid transparent",
                background: "transparent",
                color: "#888",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}>퀴즈 풀기</button>
            )}
          </div>
        )}

        {!isLoading && !error && (
          <div
            ref={pdfExportRef}
            aria-hidden="true"
            style={{
              position: "fixed",
              left: "-10000px",
              top: 0,
              zIndex: -1,
              width: 794,
              padding: 48,
              background: "#fff",
              color: "#222",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
              fontSize: 14,
              lineHeight: "25px",
              pointerEvents: "none",
            }}
          >
            <h1 style={{
              margin: "0 0 22px",
              paddingBottom: 14,
              borderBottom: "2px solid #f0f0f0",
              fontSize: 24,
              lineHeight: 1.35,
              color: "#222",
            }}>
              Tongkk {templateLabels[template]} 요약
            </h1>
            {mindmapData ? (
              <MindmapView key={`pdf-${displayContent}`} data={mindmapData} />
            ) : (
              <PdfFormattedAiText content={displayContent} />
            )}
          </div>
        )}

        {isLoading ? (
          <div style={{
            background: "#fafafa", borderRadius: 12, padding: 48,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16
          }}>
            <div style={{
              width: 36, height: 36,
              border: `3px solid ${PINK}`, borderTop: "3px solid transparent",
              borderRadius: "50%", animation: "spin 0.8s linear infinite"
            }}/>
            <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
            <p style={{ margin: 0, fontSize: 14, color: "#888" }}>
              {loadingStep || "처리 중..."}
            </p>
          </div>
        ) : error ? (
          <div style={{
            background: "#FFF5F5", borderRadius: 12, padding: 24,
            fontSize: 14, color: "#E53E3E", lineHeight: 1.6
          }}>
            <strong>요약 실패:</strong> {error}
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <div style={{
              background: "#fff", borderRadius: 12, padding: 28,
              border: "1px solid #f0f0f0",
              fontSize: 15, color: "#444", lineHeight: 1.85,
              overflowX: "auto",
            }}>
              {mindmapData ? (
                <MindmapView key={displayContent} data={mindmapData} />
              ) : (
                <FormattedAiText content={displayContent} template={template} />
              )}
            </div>

            <AITutorDrawer
              contextTitle={contextTitle}
              contextMarkdown={realContent}
              summaryId={summaryId}
              threadId={threadId}
              suggestedQuestions={questions}
              initialQuestion={!isLoading ? initialTutorQuestion : undefined}
              disabledReason="요약 생성 후 AI 튜터를 사용할 수 있습니다"
              resetHistory={resetTutorHistory}
            />
          </div>
        )}
      </Card>
    </div>
  );
};

const formatHubDate = (timestamp?: number) => {
  if (!timestamp) return "업데이트 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

const LOW_QUIZ_SCORE_THRESHOLD = 70;

const MaterialDetailView = ({
  material,
  selectedCourse,
  onBack,
  onGoSummary,
  onGoQuiz,
  onOpenSummary,
  onOpenQuiz,
  initialTab = "original",
  initialTutorQuestion = "",
  relatedMaterials = [],
  onSelectRelatedMaterial,
}: MaterialDetailViewProps) => {
  const [activeTab, setActiveTab] = useState<MaterialDetailTab>(initialTab);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState("");
  const [activeSummaryId, setActiveSummaryId] = useState<string>("");
  const [tutorPrompt, setTutorPrompt] = useState(initialTutorQuestion);
  const isPdf = material.type === "pdf" || material.mimeType === "application/pdf" || material.name.toLowerCase().endsWith(".pdf");
  const fileTypeLabel = material.type === "pdf" ? "PDF" : material.type === "ppt" ? "PPT" : material.type === "img" ? "이미지" : "자료";
  const pageInfo = material.pages ? `${material.pages}페이지` : material.slides ? `${material.slides}슬라이드` : "페이지 정보 없음";

  useEffect(() => {
    let ignore = false;
    const loadFileUrl = async () => {
      setFileUrl(null);
      setFileError("");

      if (!material.filePath) {
        setFileLoading(false);
        return;
      }

      setFileLoading(true);
      try {
        const url = await createCourseMaterialFileUrl(material);
        if (!ignore) setFileUrl(url);
      } catch (err) {
        if (!ignore) setFileError(err instanceof Error ? err.message : "원본 파일을 불러오지 못했습니다.");
      } finally {
        if (!ignore) setFileLoading(false);
      }
    };

    void loadFileUrl();

    return () => {
      ignore = true;
    };
  }, [material]);

  useEffect(() => {
    setActiveTab(initialTab);
    setTutorPrompt(initialTutorQuestion);
  }, [material.id, initialTab, initialTutorQuestion]);

  useEffect(() => {
    let ignore = false;
    setHubLoading(true);
    setHubError("");
    setSummaries([]);
    setQuizSets([]);
    setQuizAttempts([]);
    setActiveSummaryId("");

    Promise.all([
      loadSummariesFromServer(selectedCourse),
      loadQuizSetsFromServer(selectedCourse),
      loadQuizAttemptsFromServer(selectedCourse),
    ])
      .then(([nextSummaries, nextQuizSets, nextQuizAttempts]) => {
        if (ignore) return;
        const materialSummaries = nextSummaries
          .filter(summary => (summary.materialIds || []).includes(material.id))
          .sort((a, b) => b.createdAt - a.createdAt);
        const materialQuizSets = nextQuizSets
          .filter(quizSet => (quizSet.materialIds || []).includes(material.id))
          .sort((a, b) => b.createdAt - a.createdAt);
        const materialQuizSetIds = new Set(materialQuizSets.map(quizSet => quizSet.id));
        const materialQuizAttempts = nextQuizAttempts
          .filter(attempt =>
            (attempt.materialIds || []).includes(material.id) ||
            (attempt.quizSetId ? materialQuizSetIds.has(attempt.quizSetId) : false)
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        const defaultSummary = materialSummaries.find(summary => summary.template === "GENERAL") || materialSummaries[0];

        setSummaries(materialSummaries);
        setQuizSets(materialQuizSets);
        setQuizAttempts(materialQuizAttempts);
        setActiveSummaryId(defaultSummary?.id || "");
      })
      .catch(err => {
        if (!ignore) setHubError(err instanceof Error ? err.message : "학습 기록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setHubLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedCourse, material.id]);

  const activeSummary = summaries.find(summary => summary.id === activeSummaryId) || summaries[0];
  const recentQuizAttempt = quizAttempts[0];
  const hasSummaries = summaries.length > 0;
  const hasQuizSets = quizSets.length > 0;
  const hasLowRecentScore = Boolean(recentQuizAttempt && recentQuizAttempt.scorePercent < LOW_QUIZ_SCORE_THRESHOLD);

  const openSummaryTab = () => {
    if (activeSummary) setActiveSummaryId(activeSummary.id || "");
    setActiveTab("summary");
  };

  const openTutor = (question: string) => {
    if (activeSummary) setActiveSummaryId(activeSummary.id || "");
    setActiveTab("summary");
    setTutorPrompt(question);
  };

  const learningCta = (() => {
    if (!hasSummaries) {
      return {
        message: "먼저 이 자료를 요약해 학습 흐름을 잡아보세요.",
        actions: [
          { label: "요약 생성하기", onClick: onGoSummary, tone: "primary" as const },
        ],
      };
    }

    if (hasLowRecentScore) {
      return {
        message: "점수가 낮았던 부분을 요약과 함께 다시 볼까요?",
        actions: [
          { label: "약점 요약 보기", onClick: openSummaryTab, tone: "primary" as const },
          {
            label: "AI 튜터로 복습",
            onClick: () => openTutor("최근 퀴즈에서 틀린 부분과 약점을 요약 기준으로 다시 설명해줘"),
            tone: "secondary" as const,
          },
        ],
      };
    }

    if (hasQuizSets) {
      return {
        message: "최근 요약을 이어서 보고, 퀴즈 결과를 복습하세요.",
        actions: [
          { label: "요약 보기", onClick: openSummaryTab, tone: "primary" as const },
          { label: "퀴즈 다시 풀기", onClick: () => onOpenQuiz(quizSets[0]), tone: "secondary" as const },
          {
            label: "AI 튜터",
            onClick: () => openTutor("이 요약에서 시험에 다시 나올 만한 부분을 짚어줘"),
            tone: "quiet" as const,
          },
        ],
      };
    }

    return {
      message: "요약은 완료됐어요. 이제 이해도를 확인해볼 차례입니다.",
      actions: [
        { label: "퀴즈 만들기", onClick: onGoQuiz, tone: "primary" as const },
        {
          label: "AI 튜터에게 질문",
          onClick: () => openTutor("이 요약을 바탕으로 내가 이해했는지 확인 질문을 해줘"),
          tone: "secondary" as const,
        },
      ],
    };
  })();

  const ctaButtonStyle = (tone: "primary" | "secondary" | "quiet"): CSSProperties => {
    if (tone === "primary") {
      return {
        height: 36,
        padding: "0 14px",
        borderRadius: 9,
        border: "none",
        background: PINK,
        color: "#fff",
        fontSize: 13,
        fontWeight: 850,
        cursor: "pointer",
        whiteSpace: "nowrap",
      };
    }

    if (tone === "secondary") {
      return {
        height: 36,
        padding: "0 14px",
        borderRadius: 9,
        border: `1px solid ${CYAN}33`,
        background: "#E8FAFE",
        color: CYAN,
        fontSize: 13,
        fontWeight: 850,
        cursor: "pointer",
        whiteSpace: "nowrap",
      };
    }

    return {
      height: 36,
      padding: "0 12px",
      borderRadius: 9,
      border: `1px solid ${BORDER_COLOR}`,
      background: "#fff",
      color: "#777",
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
      whiteSpace: "nowrap",
    };
  };

  const tabButtonStyle = (tab: MaterialDetailTab): CSSProperties => ({
    height: 42,
    borderRadius: 10,
    border: activeTab === tab ? `1px solid ${PINK}55` : `1px solid ${BORDER_COLOR}`,
    background: activeTab === tab ? "#FFF0F6" : "#fff",
    color: activeTab === tab ? PINK : "#777",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  });
  const multiSourceBadge = (materialIds: string[] = []) => materialIds.length > 1 && (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 8px",
      borderRadius: 999,
      background: "#F3FBFD",
      color: CYAN,
      fontSize: 11,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}>
      여러 자료를 함께 사용함
    </span>
  );

  const renderOriginalTab = () => {
    if (fileLoading) {
      return (
        <div style={{ minHeight: 520, display: "grid", placeItems: "center", background: "#2b2b2b", color: "#ddd", fontSize: 14 }}>
          원본 PDF를 불러오는 중입니다.
        </div>
      );
    }

    if (fileUrl && isPdf) {
      return (
        <iframe
          title={material.name}
          src={`${fileUrl}#toolbar=1&navpanes=0`}
          style={{
            width: "100%",
            height: "calc(100vh - 292px)",
            minHeight: 620,
            border: "none",
            background: "#2b2b2b",
            display: "block",
          }}
        />
      );
    }

    return (
      <div style={{
        background: "#fafafa",
        padding: 24,
        fontSize: 14,
        color: "#444",
        lineHeight: 1.8,
        minHeight: 520,
        maxHeight: "calc(100vh - 320px)",
        overflowY: "auto",
      }}>
        <div style={{
          marginBottom: 18,
          padding: "12px 14px",
          borderRadius: 10,
          background: fileError ? "#FFF5F5" : "#FFF8E8",
          color: fileError ? "#E53E3E" : "#9A6B00",
          fontSize: 13,
          fontWeight: 700,
        }}>
          {fileError || "이 자료는 원본 PDF 저장 기능 추가 전에 업로드되어 원본 파일이 없습니다. 같은 PDF를 다시 업로드하면 다음부터 PDF 뷰어로 열립니다."}
        </div>
        <FormattedAiText content={material.markdown || "표시할 변환 내용이 없습니다."} />
      </div>
    );
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 과목 자료로</button>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid #f0f0f0",
          background: "#202020",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#fff", wordBreak: "break-word" }}>
              {material.name}
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: "#b7b7b7" }}>
              <span>{fileTypeLabel}</span>
              <span>{pageInfo}</span>
              <span>업데이트 {formatHubDate(material.updatedAt)}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {fileUrl && (
              <a href={fileUrl} target="_blank" rel="noreferrer" style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                background: "#333",
                color: CYAN,
                fontSize: 13,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
              }}>새 창</a>
            )}
          </div>
        </div>
        <div style={{ padding: 18, borderBottom: "1px solid #f0f0f0", background: "#fff" }}>
          {relatedMaterials.length > 1 && (
            <div style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px solid ${BORDER_COLOR}`,
              background: "#fff",
            }}>
              <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 850, color: "#999" }}>
                이 퀴즈에 연결된 자료
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {relatedMaterials.map(related => {
                  const isActive = related.id === material.id;
                  return (
                    <button
                      key={related.id}
                      type="button"
                      onClick={() => onSelectRelatedMaterial?.(related)}
                      style={{
                        maxWidth: 280,
                        padding: "7px 10px",
                        borderRadius: 999,
                        border: isActive ? `1px solid ${PINK}55` : `1px solid ${BORDER_COLOR}`,
                        background: isActive ? "#FFF0F6" : "#fafafa",
                        color: isActive ? PINK : "#666",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: isActive ? "default" : "pointer",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {related.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            padding: 16,
            borderRadius: 12,
            border: `1px solid ${BORDER_COLOR}`,
            background: "#fafafa",
          }}>
            <div style={{ minWidth: 260, flex: "1 1 360px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 9 }}>
                <span style={{ padding: "5px 9px", borderRadius: 999, background: "#FFF0F6", color: PINK, fontSize: 12, fontWeight: 850 }}>
                  요약 {summaries.length}개
                </span>
                <span style={{ padding: "5px 9px", borderRadius: 999, background: "#E8FAFE", color: CYAN, fontSize: 12, fontWeight: 850 }}>
                  퀴즈 {quizSets.length}개
                </span>
                {recentQuizAttempt && (
                  <span style={{
                    padding: "5px 9px",
                    borderRadius: 999,
                    background: hasLowRecentScore ? "#FFF5F5" : "#F1FFF5",
                    color: hasLowRecentScore ? "#E53E3E" : "#2F9E44",
                    fontSize: 12,
                    fontWeight: 850,
                  }}>
                    최근 점수 {recentQuizAttempt.scorePercent}%
                  </span>
                )}
              </div>
              <p style={{ margin: 0, color: "#444", fontSize: 14, fontWeight: 750, lineHeight: 1.5 }}>
                {hubLoading ? "학습 상태를 불러오는 중입니다." : learningCta.message}
              </p>
            </div>
            {!hubLoading && (
              <div style={{ display: "flex", flex: "0 1 auto", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
                {learningCta.actions.map(action => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    style={ctaButtonStyle(action.tone)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <button type="button" onClick={() => setActiveTab("original")} style={tabButtonStyle("original")}>원본</button>
            <button type="button" onClick={() => setActiveTab("summary")} style={tabButtonStyle("summary")}>요약 {summaries.length > 0 ? summaries.length : ""}</button>
            <button type="button" onClick={() => setActiveTab("quiz")} style={tabButtonStyle("quiz")}>퀴즈 {quizSets.length > 0 ? quizSets.length : ""}</button>
          </div>
          {hubError && <p style={{ margin: "12px 0 0", fontSize: 12, color: "#E53E3E", fontWeight: 700 }}>{hubError}</p>}
        </div>

        {activeTab === "original" && renderOriginalTab()}

        {activeTab === "summary" && (
          <div style={{ padding: 24, background: "#fafafa", minHeight: 520 }}>
            {hubLoading ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", color: "#888", fontSize: 14 }}>연결된 요약을 불러오는 중입니다.</div>
            ) : summaries.length === 0 ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#222" }}>아직 요약이 없습니다</h3>
                  <p style={{ margin: "0 0 18px", fontSize: 13, color: "#888" }}>이 자료를 기준으로 바로 학습용 요약을 만들 수 있습니다.</p>
                  <button onClick={onGoSummary} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    요약 생성하기
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 18, alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {summaries.map(summary => (
                    <button
                      key={summary.id || `${summary.template}-${summary.createdAt}`}
                      type="button"
                      onClick={() => setActiveSummaryId(summary.id || "")}
                      style={{
                        padding: "12px 13px",
                        borderRadius: 10,
                        border: activeSummary?.id === summary.id ? `1px solid ${PINK}55` : `1px solid ${BORDER_COLOR}`,
                        background: activeSummary?.id === summary.id ? "#FFF0F6" : "#fff",
                        color: activeSummary?.id === summary.id ? PINK : "#555",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <strong style={{ display: "block", fontSize: 13, marginBottom: 4 }}>{templateLabels[summary.template]}</strong>
                      <span style={{ display: "block", fontSize: 11, color: "#999" }}>{formatHubDate(summary.createdAt)}</span>
                    </button>
                  ))}
                </div>
                {activeSummary && (
                  <div style={{ padding: 22, borderRadius: 12, background: "#fff", border: `1px solid ${BORDER_COLOR}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
                      <div>
                        <h3 style={{ margin: "0 0 6px", fontSize: 18, color: "#222" }}>{templateLabels[activeSummary.template]}</h3>
                        <p style={{ margin: 0, fontSize: 12, color: "#999" }}>{formatHubDate(activeSummary.createdAt)}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {multiSourceBadge(activeSummary.materialIds)}
                        <button onClick={() => onOpenSummary(activeSummary)} style={{ padding: "9px 12px", borderRadius: 8, border: "none", background: PINK, color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                          자세히 보기
                        </button>
                      </div>
                    </div>
                    <FormattedAiText content={activeSummary.content} template={activeSummary.template} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "quiz" && (
          <div style={{ padding: 24, background: "#fafafa", minHeight: 520 }}>
            {hubLoading ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", color: "#888", fontSize: 14 }}>연결된 퀴즈를 불러오는 중입니다.</div>
            ) : quizSets.length === 0 ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#222" }}>아직 퀴즈가 없습니다</h3>
                  <p style={{ margin: "0 0 18px", fontSize: 13, color: "#888" }}>이 자료와 연결된 문제 세트를 새로 만들 수 있습니다.</p>
                  <button onClick={onGoQuiz} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: CYAN, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    퀴즈 생성하기
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {quizSets.map(quizSet => (
                  <div key={quizSet.id} style={{ padding: 18, borderRadius: 12, background: "#fff", border: `1px solid ${BORDER_COLOR}`, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <h3 style={{ margin: 0, fontSize: 16, color: "#222", wordBreak: "break-word" }}>{quizSet.title}</h3>
                        {multiSourceBadge(quizSet.materialIds)}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: "#888", fontWeight: 700 }}>
                        <span>난이도 {quizSet.difficulty}</span>
                        <span>{quizSet.questionType}</span>
                        <span>{quizSet.count || quizSet.questions.length}문항</span>
                        <span>{formatHubDate(quizSet.createdAt)}</span>
                      </div>
                    </div>
                    <button onClick={() => onOpenQuiz(quizSet)} style={{ flexShrink: 0, padding: "10px 14px", borderRadius: 9, border: "none", background: CYAN, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                      퀴즈 풀기
                    </button>
                  </div>
                ))}
                <button onClick={onGoQuiz} style={{ justifySelf: "start", padding: "11px 16px", borderRadius: 10, border: `1px solid ${CYAN}33`, background: "#E8FAFE", color: CYAN, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                  새 퀴즈 만들기
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
      {activeTab === "summary" && (
        <AITutorDrawer
          contextTitle={activeSummary ? `${material.name} · ${templateLabels[activeSummary.template]}` : `${material.name} · 요약`}
          contextMarkdown={activeSummary?.content || ""}
          summaryId={activeSummary?.id || null}
          materialId={material.id}
          suggestedQuestions={activeSummary ? suggestedTutorQuestions[activeSummary.template] : suggestedTutorQuestions.GENERAL}
          initialQuestion={tutorPrompt}
          disabledReason="요약 생성 후 AI 튜터를 사용할 수 있습니다"
        />
      )}
    </div>
  );
};

const QuizCreateView = ({ fileName, onBack, onCreate }: QuizCreateViewProps) => {
  const [difficulty, setDifficulty] = useState("보통");
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState<string[]>(["객관식"]);

  const toggleType = (t: string) => {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "#222" }}>퀴즈 생성</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0f0" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#888" }}>요약된 파일 미리보기</span>
          </div>
          <div style={{
            padding: 24, minHeight: 360, background: "#fafafa",
            fontSize: 13, color: "#555", lineHeight: 1.8
          }}>
            <p style={{ fontWeight: 600, color: "#333", marginTop: 0 }}>{fileName || "업로드된 파일"} - 요약본</p>
            <p>이번 강의에서는 동적 프로그래밍(DP)의 핵심 개념을 다루었습니다. DP는 큰 문제를 작은 하위 문제로 나누어 해결하는 알고리즘 설계 기법입니다.</p>
            <p>메모이제이션과 타뷸레이션 두 가지 접근 방식이 있으며, 최적 부분 구조와 중복 부분 문제라는 두 가지 조건이 필요합니다.</p>
            <p>피보나치 수열, 배낭 문제, 최장 공통 부분 수열(LCS) 등의 대표적인 예제를 통해 DP의 적용 방법을 학습했습니다.</p>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#222" }}>난이도</h3>
            <div style={{ display: "flex", gap: 10 }}>
              {["낮음", "보통", "높음"].map(d => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  padding: "10px 24px", borderRadius: 10,
                  border: difficulty === d ? "none" : "1px solid #e0e0e0",
                  background: difficulty === d ? PINK : "#fff",
                  color: difficulty === d ? "#fff" : "#555",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#222" }}>문항수</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: 80, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
                  fontSize: 14, textAlign: "center", outline: "none"
                }}
              />
              <span style={{ fontSize: 14, color: "#888" }}>개</span>
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#222" }}>문제 유형</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["O/X", "객관식", "단답형", "주관식"].map(t => (
                <button key={t} onClick={() => toggleType(t)} style={{
                  padding: "10px 20px", borderRadius: 10,
                  border: types.includes(t) ? "none" : "1px solid #e0e0e0",
                  background: types.includes(t) ? CYAN : "#fff",
                  color: types.includes(t) ? "#fff" : "#555",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{t}</button>
              ))}
            </div>
          </div>

          <button onClick={onCreate} style={{
            padding: "16px 0", borderRadius: 14, border: "none",
            background: PINK, color: "#fff", fontSize: 16, fontWeight: 700,
            cursor: "pointer", marginTop: 8
          }}>퀴즈 생성하기</button>
        </div>
      </div>
    </div>
  );
};

export default function Summary() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState) || null;
  const isReloadNavigationRef = useRef(isPageReload());
  const shouldRestoreLocationView = !isReloadNavigationRef.current;
  const initialCourse = (locationState?.selectedCourse || "").trim();
  const fromDashboardRef = useRef(Boolean(initialCourse && locationState?.fromDashboard));
  const pendingMaterialIdRef = useRef(shouldRestoreLocationView && locationState?.viewMaterial
    ? locationState.materialId || locationState.materialIds?.[0] || ""
    : "");
  const pendingMaterialDetailTabRef = useRef<MaterialDetailTab>(
    shouldRestoreLocationView && locationState?.viewMaterial ? locationState.materialDetailTab || "original" : "original"
  );
  const pendingMaterialTutorQuestionRef = useRef(
    shouldRestoreLocationView && locationState?.viewMaterial ? locationState.tutorQuestion || "" : "",
  );
  const pendingMaterialIdsRef = useRef<string[]>(
    shouldRestoreLocationView && locationState?.viewMaterial ? locationState.materialIds || [] : [],
  );
  const pendingSummaryRef = useRef(shouldRestoreLocationView && locationState?.openSummary ? {
    id: locationState.summaryId || "",
    template: locationState.summaryTemplate,
    content: locationState.summaryContent || "",
    createdAt: locationState.summaryCreatedAt || Date.now(),
    materialIds: locationState.materialIds || [],
  } : null);
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searched, setSearched] = useState(Boolean(initialCourse));
  const [selectedCourse, setSelectedCourse] = useState(initialCourse);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [textMaterialTitle, setTextMaterialTitle] = useState("");
  const [textMaterialContent, setTextMaterialContent] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<UploadedFile[]>([]);

  const [view, setView] = useState<SummaryView>("upload");
  const [selectedTemplate, setSelectedTemplate] = useState<SummaryTemplate | null>(null);
  const [activeSummaryId, setActiveSummaryId] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [activeMaterial, setActiveMaterial] = useState<CourseMaterial | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [materialDetailInitialTab, setMaterialDetailInitialTab] = useState<MaterialDetailTab>("original");
  const [materialDetailTutorQuestion, setMaterialDetailTutorQuestion] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<DuplicateFileNotice | null>(null);
  const [agentThreadId, setAgentThreadId] = useState("");
  const [resultBackView, setResultBackView] = useState<"templates" | "upload">("templates");
  const [pendingTutorQuestion] = useState(
    shouldRestoreLocationView ? locationState?.tutorQuestion || "" : "",
  );
  const selectedMaterials = materials.filter(material => selectedMaterialIds.includes(material.id));
  const selectedMarkdown = combineMaterialsMarkdown(selectedMaterials);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!locationState?.openSummary && !locationState?.viewMaterial) return;
    navigate(pageRoutes["자료 요약"], {
      replace: true,
      state: initialCourse ? { selectedCourse: initialCourse, fromDashboard: locationState.fromDashboard } : null,
    });
    // The location handoff should be consumed once on mount so refreshes do not reopen nested views.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCourse) return;
    let ignore = false;

    Promise.all([
      loadCourseMaterialsFromServer(selectedCourse),
      loadSummariesFromServer(selectedCourse),
    ])
      .then(([nextMaterials, summaries]) => {
        if (ignore) return;
        setMaterials(nextMaterials);
        const pendingMaterialId = pendingMaterialIdRef.current;
        if (pendingMaterialId) {
          pendingMaterialIdRef.current = "";
          const material = nextMaterials.find(item => item.id === pendingMaterialId);
          if (material) {
            const validMaterialIds = pendingMaterialIdsRef.current.filter(id => nextMaterials.some(item => item.id === id));
            pendingMaterialIdsRef.current = [];
            setActiveMaterial(material);
            setSelectedMaterialIds(validMaterialIds.length > 0 ? validMaterialIds : [material.id]);
            setMaterialDetailInitialTab(pendingMaterialDetailTabRef.current);
            setMaterialDetailTutorQuestion(pendingMaterialTutorQuestionRef.current);
            pendingMaterialDetailTabRef.current = "original";
            pendingMaterialTutorQuestionRef.current = "";
            setSearched(true);
            setView("materialDetail");
            return;
          }
        }

        const pendingSummary = pendingSummaryRef.current;
        if (pendingSummary) {
          pendingSummaryRef.current = null;
          const matchingSummaries = summaries
            .filter(item =>
              (pendingSummary.id && item.id === pendingSummary.id) ||
              (
                pendingSummary.template
                  ? item.template === pendingSummary.template && sameMaterialIds(item.materialIds, pendingSummary.materialIds)
                  : sameMaterialIds(item.materialIds, pendingSummary.materialIds)
              )
            )
            .sort((a, b) => b.createdAt - a.createdAt);
          const summary = matchingSummaries[0] || (
            pendingSummary.template && pendingSummary.content
              ? {
                  id: pendingSummary.id,
                  template: pendingSummary.template,
                  content: pendingSummary.content,
                  createdAt: pendingSummary.createdAt,
                  materialIds: pendingSummary.materialIds,
                }
              : null
          );
          if (summary) {
            const validMaterialIds = (summary.materialIds || []).filter(id =>
              nextMaterials.some(material => material.id === id)
            );
            setSelectedMaterialIds(validMaterialIds.length > 0 ? validMaterialIds : nextMaterials.map(material => material.id));
            setSelectedTemplate(summary.template);
            setActiveSummaryId(summary.id || null);
            setSummaryText(summary.content);
            setIsSummarizing(false);
            setSummaryError("");
            setElapsedTime(null);
            setLoadingStep("");
            setAgentThreadId("");
            setResultBackView("upload");
            setSearched(true);
            setView("summaryResult");
            return;
          }
        }

        setSelectedMaterialIds(prev => {
          const validPreviousIds = prev.filter(id => nextMaterials.some(material => material.id === id));
          return validPreviousIds.length > 0
            ? validPreviousIds
            : nextMaterials.map(material => material.id);
        });
      })
      .catch(error => {
        setExtractError(error instanceof Error ? error.message : "강의자료 불러오기 실패");
      });

    return () => {
      ignore = true;
    };
  }, [selectedCourse]);

  useEffect(() => {
    if (!duplicateNotice) return;
    const timer = window.setTimeout(() => setDuplicateNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [duplicateNotice]);

  const resetCourseSelection = () => {
    setSelectedCourse("");
    setFiles([]);
    filesRef.current = [];
    setDragOver(false);
    setUploading(false);
    setSearched(false);
    setMaterials([]);
    setActiveMaterial(null);
    setSelectedMaterialIds([]);
    setIsExtracting(false);
    setExtractError("");
    setDuplicateNotice(null);
    setActiveSummaryId(null);
    navigate(pageRoutes["자료 요약"], { replace: true, state: null });
  };

  const handleCourseBack = () => {
    if (fromDashboardRef.current) {
      navigate(pageRoutes["대시보드"]);
      return;
    }
    resetCourseSelection();
  };

  const handleCourseSelect = (course: string) => {
    setSelectedCourse(course);
    setFiles([]);
    filesRef.current = [];
    setDragOver(false);
    setUploading(false);
    setSearched(true);
    setMaterials([]);
    setActiveMaterial(null);
    setSelectedMaterialIds([]);
    setIsExtracting(false);
    setExtractError("");
    setDuplicateNotice(null);
    setActiveSummaryId(null);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const arr = Array.from(fileList).filter(isSupportedDocumentFile);
    if (arr.length === 0) return;
    if (!selectedCourse) return;

    const existingIds = new Set([
      ...materials.map(material => material.id),
      ...filesRef.current.map(file => getFileMaterialId(file)),
    ]);
    const existingNames = new Set([
      ...materials.map(material => getFileNameKey(material.name)),
      ...filesRef.current.map(file => getFileNameKey(file.name)),
    ]);
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const duplicateNames: string[] = [];
    const duplicateFiles: File[] = [];
    const newFiles = arr.filter(file => {
      const id = getFileMaterialId(file);
      const nameKey = getFileNameKey(file.name);
      const isDuplicate = existingIds.has(id) || existingNames.has(nameKey) || seenIds.has(id) || seenNames.has(nameKey);
      seenIds.add(id);
      seenNames.add(nameKey);
      if (isDuplicate) {
        duplicateNames.push(file.name);
        duplicateFiles.push(file);
      }
      return !isDuplicate;
    });

    setDuplicateNotice(duplicateNames.length > 0
      ? { names: Array.from(new Set(duplicateNames)) }
      : null);
    if (duplicateFiles.length > 0) {
      const duplicatePageCounts = await Promise.all(duplicateFiles.map(async file => ({
        id: getFileMaterialId(file),
        nameKey: getFileNameKey(file.name),
        file,
        pages: await getPdfPageCount(file),
      })));
      let didUpdatePages = false;
      let didAttachFiles = false;
      const nextMaterials: CourseMaterial[] = [];
      for (const material of materials) {
        const match = duplicatePageCounts.find(item =>
          item.id === material.id || item.nameKey === getFileNameKey(material.name)
        );
        let nextMaterial = material;
        if (match && match.pages !== null && match.pages !== material.pages) {
          didUpdatePages = true;
          nextMaterial = { ...nextMaterial, pages: match.pages };
        }
        if (match && !nextMaterial.filePath) {
          try {
            nextMaterial = await uploadCourseMaterialFile(selectedCourse, nextMaterial, match.file);
            didAttachFiles = true;
          } catch (err) {
            setExtractError(err instanceof Error ? `원본 파일 저장 실패: ${err.message}` : "원본 파일 저장 실패");
          }
        }
        nextMaterials.push(nextMaterial);
      }

      if (didUpdatePages || didAttachFiles) {
        await saveCourseMaterials(selectedCourse, nextMaterials);
        setMaterials(nextMaterials);
      }
    }
    if (newFiles.length === 0) return;

    setUploading(true);

    const nf = await Promise.all(newFiles.map(async f => ({
      name: f.name, size: f.size, type: getFileType(f.name),
      pages: getFileType(f.name) === "pdf" ? await getPdfPageCount(f) : null,
      slides: null,
      rawFile: f,
    })));
    filesRef.current = [...filesRef.current, ...nf];
    setFiles(filesRef.current);
    setUploading(false);
    setSearched(true);

    setIsExtracting(true);
    setExtractError("");
    const uploadedMaterials: CourseMaterial[] = [];
    try {
      for (const documentFile of newFiles) {
        try {
          const markdown = await extractMarkdownFromMaterialFile(documentFile);
          const uploadedMaterial = nf.find(f => f.rawFile === documentFile) || nf.find(f => f.name === documentFile.name);
          if (uploadedMaterial) {
            const baseMaterial: CourseMaterial = {
              id: getFileMaterialId(documentFile),
              name: uploadedMaterial.name,
              size: uploadedMaterial.size,
              type: uploadedMaterial.type,
              pages: uploadedMaterial.pages,
              slides: uploadedMaterial.slides,
              markdown,
              updatedAt: Date.now(),
            };
            try {
              uploadedMaterials.push(await uploadCourseMaterialFile(selectedCourse, baseMaterial, documentFile));
            } catch (err) {
              setExtractError(err instanceof Error ? `원본 파일 저장 실패: ${err.message}` : "원본 파일 저장 실패");
              uploadedMaterials.push(baseMaterial);
            }
          }
        } catch (err) {
          setExtractError(err instanceof Error ? err.message : "파일 분석 실패");
        }
      }

      if (uploadedMaterials.length > 0) {
        const nextMaterials = [...materials, ...uploadedMaterials];
        await saveCourseMaterials(selectedCourse, nextMaterials);
        setMaterials(nextMaterials);
        setSelectedMaterialIds(prev => Array.from(new Set([...prev, ...uploadedMaterials.map(material => material.id)])));
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAddTextMaterial = async () => {
    const title = textMaterialTitle.trim();
    const markdown = textMaterialContent.trim();
    if (!selectedCourse || !title || !markdown) return;

    const name = title.toLowerCase().endsWith(".txt") ? title : `${title}.txt`;
    const nameKey = getFileNameKey(name);
    if (materials.some(material => getFileNameKey(material.name) === nameKey)) {
      setDuplicateNotice({ names: [name] });
      return;
    }

    const material: CourseMaterial = {
      id: `text:${name}:${Date.now()}`,
      name,
      size: markdown.length,
      type: "file",
      pages: null,
      slides: null,
      markdown,
      mimeType: "text/plain",
      updatedAt: Date.now(),
    };

    try {
      const nextMaterials = [material, ...materials];
      await saveCourseMaterials(selectedCourse, nextMaterials);
      setMaterials(nextMaterials);
      setSelectedMaterialIds(prev => Array.from(new Set([...prev, material.id])));
      setTextMaterialTitle("");
      setTextMaterialContent("");
      setSearched(true);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "텍스트 자료 추가 실패");
    }
  };

  const handleDeleteMaterial = async (material: CourseMaterial) => {
    if (!selectedCourse) return;

    const nextMaterials = materials.filter(item => item.id !== material.id);
    try {
      await Promise.all([
        saveCourseMaterials(selectedCourse, nextMaterials),
        deleteSummariesByMaterialId(selectedCourse, material.id),
      ]);
      setMaterials(nextMaterials);
      setSelectedMaterialIds(prev => prev.filter(id => id !== material.id));
      setFiles(prev => {
        const nextFiles = prev.filter(file =>
          getFileMaterialId(file) !== material.id &&
          getFileNameKey(file.name) !== getFileNameKey(material.name)
        );
        filesRef.current = nextFiles;
        return nextFiles;
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "강의자료 삭제 실패");
    }
  };

  const handleTemplateSelect = async (template: SummaryTemplate) => {
    setSelectedTemplate(template);
    setSummaryError("");

    if (selectedMarkdown) {
      setIsSummarizing(true);
      setView("summaryResult");
      setSummaryText("");
      setActiveSummaryId(null);
      setSummaryError("");
      setElapsedTime(null);
      setAgentThreadId("");
      setResultBackView("templates");
      const startTime = Date.now();
      try {
        setLoadingStep(`${templateLabels[template]} 형식으로 요약 중...`);
        const response = await summarizeWithTemplate(selectedMarkdown, template);
        setSummaryText(response.result);
        setAgentThreadId(response.threadId);
        if (selectedCourse) {
          const selectedMaterialNames = selectedMaterials.map(material => material.name);
          const savedSummary = {
            template,
            content: response.result,
            createdAt: Date.now(),
            materialIds: selectedMaterialIds,
            materialNames: selectedMaterialNames,
          };
          const persistedSummary = await saveSummaryToServer(selectedCourse, savedSummary);
          setActiveSummaryId(persistedSummary.id || null);
        }
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(1));
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : "요약 실패");
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(1));
      } finally {
        setIsSummarizing(false);
        setLoadingStep("");
      }
    } else {
      setSummaryText("");
      setActiveSummaryId(null);
      setView("summaryResult");
    }
  };

  const handleGoToQuiz = () => {
    navigate(pageRoutes["퀴즈 생성"], {
      state: selectedTemplate
        ? { course: selectedCourse, template: selectedTemplate, materialIds: selectedMaterialIds, fromDashboard: fromDashboardRef.current }
        : { course: selectedCourse, materialIds: selectedMaterialIds, fromDashboard: fromDashboardRef.current },
    });
  };

  const handleCreateSummaryForMaterial = (material: CourseMaterial) => {
    setSelectedMaterialIds([material.id]);
    setSelectedTemplate(null);
    setMaterialDetailInitialTab("original");
    setMaterialDetailTutorQuestion("");
    setResultBackView("materialDetail");
    setView("templates");
  };

  const handleCreateQuizForMaterial = (material: CourseMaterial) => {
    setSelectedMaterialIds([material.id]);
    navigate(pageRoutes["퀴즈 생성"], {
      state: { course: selectedCourse, materialIds: [material.id], fromDashboard: fromDashboardRef.current },
    });
  };

  const handleOpenMaterialSummary = (summary: SavedSummary) => {
    const validMaterialIds = (summary.materialIds || []).filter(id => materials.some(material => material.id === id));
    setSelectedMaterialIds(validMaterialIds.length > 0 ? validMaterialIds : activeMaterial ? [activeMaterial.id] : []);
    setSelectedTemplate(summary.template);
    setActiveSummaryId(summary.id || null);
    setSummaryText(summary.content);
    setIsSummarizing(false);
    setSummaryError("");
    setElapsedTime(null);
    setLoadingStep("");
    setAgentThreadId("");
    setResultBackView("materialDetail");
    setView("summaryResult");
  };

  const handleOpenMaterialQuiz = (quizSet: SavedQuizSet) => {
    navigate(pageRoutes["퀴즈 생성"], {
      state: { course: selectedCourse, quizSetId: quizSet.id, openQuiz: true, fromDashboard: fromDashboardRef.current },
    });
  };

  const handleSelectRelatedMaterial = (material: CourseMaterial) => {
    setActiveMaterial(material);
    setMaterialDetailInitialTab("summary");
    setMaterialDetailTutorQuestion("");
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="자료 요약" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {duplicateNotice && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="이미 등록된 파일 안내"
          style={{
            position: "fixed",
            top: 86,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(360px, calc(100vw - 32px))",
            zIndex: 140,
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid #f6c8df",
            background: "#fff",
            boxShadow: "0 14px 36px rgba(0,0,0,0.14)",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: PINK,
              marginTop: 7,
              flexShrink: 0,
            }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#222", marginBottom: 4 }}>
                이미 등록된 파일입니다
              </div>
              <div style={{
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.5,
                color: PINK,
                wordBreak: "break-word",
              }}>
                {duplicateNotice.names.join(", ")}
              </div>
            </div>
            <button
              onClick={() => setDuplicateNotice(null)}
              aria-label="중복 파일 안내 닫기"
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                border: "none",
                background: "#fafafa",
                color: "#aaa",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: "24px",
                padding: 0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 자료 요약</span>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        {courses.length > 0 && view === "upload" && !selectedCourse && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#222" }}>과목 선택</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#999" }}>자료를 정리할 과목을 선택하세요</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {courses.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => handleCourseSelect(c)}
                    style={{
                      minHeight: 170,
                      padding: 22,
                      borderRadius: 14,
                      border: "1px solid #eeeeee",
                      background: CARD_BACKGROUND,
                      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                      color: "#222",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      transition: "border 0.15s, box-shadow 0.15s, background 0.15s",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{c}</span>
                    </div>
                    <span style={{
                      marginTop: 14,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#aaa",
                    }}>
                      선택하기
                    </span>
                  </button>
              ))}
            </div>
          </div>
        )}

        {view === "templates" && (
          <TemplateSelectView onSelect={handleTemplateSelect} onBack={() => setView("upload")} />
        )}

        {view === "summaryResult" && selectedTemplate && (
          <SummaryResultView
            template={selectedTemplate}
            onBack={() => setView(resultBackView)}
            contextTitle={`${selectedMaterials.map(material => material.name).join(", ") || "현재 자료"} · ${templateLabels[selectedTemplate]}`}
            realContent={summaryText}
            isLoading={isSummarizing}
            error={summaryError}
            loadingStep={loadingStep}
            elapsedTime={elapsedTime}
            threadId={agentThreadId}
            summaryId={activeSummaryId}
            resetTutorHistory={isReloadNavigationRef.current}
            initialTutorQuestion={pendingTutorQuestion}
            onGoToQuiz={selectedCourse ? handleGoToQuiz : undefined}
          />
        )}

        {view === "materialDetail" && activeMaterial && (
          <MaterialDetailView
            material={activeMaterial}
            selectedCourse={selectedCourse}
            onBack={() => setView("upload")}
            onGoSummary={() => handleCreateSummaryForMaterial(activeMaterial)}
            onGoQuiz={() => handleCreateQuizForMaterial(activeMaterial)}
            onOpenSummary={handleOpenMaterialSummary}
            onOpenQuiz={handleOpenMaterialQuiz}
            initialTab={materialDetailInitialTab}
            initialTutorQuestion={materialDetailTutorQuestion}
            relatedMaterials={materials.filter(material => selectedMaterialIds.includes(material.id))}
            onSelectRelatedMaterial={handleSelectRelatedMaterial}
          />
        )}

        {view === "quizCreate" && (
          <QuizCreateView fileName={selectedMaterials.map(material => material.name).join(", ")} onBack={() => setView("upload")} onCreate={handleGoToQuiz} />
        )}

        {view === "upload" && selectedCourse && (
          <div>
            <button onClick={handleCourseBack} style={{
              background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
            }}>← 돌아가기</button>
            <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 28 }}>
            <div>
              <Card style={{ padding: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {(["file", "text"] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setInputMode(mode)}
                      style={{
                        padding: "10px 0",
                        borderRadius: 10,
                        border: inputMode === mode ? `1px solid ${PINK}55` : `1px solid ${BORDER_COLOR}`,
                        background: inputMode === mode ? "#FFF0F6" : "#fff",
                        color: inputMode === mode ? PINK : "#777",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {mode === "file" ? "파일 업로드" : "텍스트 붙여넣기"}
                    </button>
                  ))}
                </div>
                {inputMode === "file" ? (
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragOver ? "#cfd8e6" : BORDER_COLOR}`,
                      borderRadius: 14, padding: "40px 20px", textAlign: "center",
                      cursor: "pointer", background: dragOver ? "#f8fbff" : MUTED_SURFACE,
                      transition: "all 0.2s", marginBottom: 20
                    }}
                  >
                    <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff"
                      onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                    <p style={{ margin: "0 0 8px", fontSize: 14, color: "#888" }}>강의자료 파일을 드래그하거나</p>
                    <button style={{
                      marginTop: 12, padding: "8px 20px", borderRadius: 10, border: "1px solid #ddd",
                      background: "#fff", fontSize: 13, cursor: "pointer", color: "#555"
                    }}>파일 선택</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    <input
                      value={textMaterialTitle}
                      onChange={e => setTextMaterialTitle(e.target.value)}
                      placeholder="자료 이름 (예: 3주차 강의 노트)"
                      style={{ padding: "12px 13px", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`, fontSize: 13, outline: "none" }}
                    />
                    <textarea
                      value={textMaterialContent}
                      onChange={e => setTextMaterialContent(e.target.value)}
                      placeholder="강의 스크립트나 노트를 붙여넣으세요..."
                      rows={8}
                      style={{ padding: 13, borderRadius: 10, border: `1px solid ${BORDER_COLOR}`, fontSize: 13, lineHeight: 1.6, resize: "vertical", outline: "none", fontFamily: "inherit" }}
                    />
                    <button
                      type="button"
                      onClick={handleAddTextMaterial}
                      disabled={!textMaterialTitle.trim() || !textMaterialContent.trim()}
                      style={{
                        padding: "11px 0",
                        borderRadius: 10,
                        border: "none",
                        background: textMaterialTitle.trim() && textMaterialContent.trim() ? PINK : "#e5e5e5",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: textMaterialTitle.trim() && textMaterialContent.trim() ? "pointer" : "default",
                      }}
                    >
                      자료로 추가
                    </button>
                  </div>
                )}

                <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
                {uploading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
                    <div style={{
                      width: 18, height: 18, border: `2px solid ${CYAN}`, borderTop: "2px solid transparent",
                      borderRadius: "50%", animation: "spin 0.8s linear infinite"
                    }}/>
                    <span style={{ fontSize: 13, color: CYAN, fontWeight: 500 }}>업로드 중...</span>
                  </div>
                )}
                {isExtracting && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
                    <div style={{
                      width: 18, height: 18, border: `2px solid ${PINK}`, borderTop: "2px solid transparent",
                      borderRadius: "50%", animation: "spin 0.8s linear infinite"
                    }}/>
                    <span style={{ fontSize: 13, color: PINK, fontWeight: 500 }}>파일 분석 중...</span>
                  </div>
                )}
                {!isExtracting && selectedMarkdown && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <span style={{ fontSize: 13, color: "#4CAF50", fontWeight: 700 }}>선택됨: {selectedMaterials.length}개</span>
                  </div>
                )}
                {extractError && (
                  <div style={{ padding: "8px 0", fontSize: 12, color: "#E53E3E" }}>
                    분석 실패: {extractError}
                  </div>
                )}

                {materials.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#555" }}>
                        강의자료 선택
                      </h4>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => setSelectedMaterialIds(materials.map(material => material.id))} style={{ border: `1px solid ${BORDER_COLOR}`, background: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "#777", cursor: "pointer" }}>전체 선택</button>
                        <button type="button" onClick={() => setSelectedMaterialIds([])} style={{ border: `1px solid ${BORDER_COLOR}`, background: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "#777", cursor: "pointer" }}>전체 해제</button>
                      </div>
                    </div>
                    {materials.map(material => {
                      const isSelected = selectedMaterialIds.includes(material.id);
                      return (
                      <div
                        key={material.id}
                        onClick={() => setSelectedMaterialIds(prev =>
                          prev.includes(material.id)
                            ? prev.filter(id => id !== material.id)
                            : [...prev, material.id]
                        )}
                        style={{
                          display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 14px",
                          background: isSelected ? "#fff7fa" : MUTED_SURFACE,
                          border: isSelected ? `1.5px solid ${PINK}44` : `1px solid ${BORDER_COLOR}`,
                          borderRadius: 10, marginBottom: 8, cursor: "pointer",
                        }}>
                        <div style={{
                          width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                          background: isSelected ? PINK : "transparent",
                          border: isSelected ? `2px solid ${PINK}` : "2px solid #ccc",
                          transition: "all 0.15s",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {isSelected && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                        </div>
                        <FileIcon type={material.type} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#333" }}>{material.name}</span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>
                          {material.pages ? `${material.pages}p` : material.slides ? `${material.slides}s` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setActiveMaterial(material);
                            setSelectedMaterialIds([material.id]);
                            setMaterialDetailInitialTab("original");
                            setMaterialDetailTutorQuestion("");
                            setView("materialDetail");
                          }}
                          style={{
                            height: 26,
                            padding: "0 8px",
                            borderRadius: 8,
                            border: `1px solid ${CYAN}33`,
                            background: "#E8FAFE",
                            color: CYAN,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          학습
                        </button>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleDeleteMaterial(material); }}
                          aria-label={`${material.name} 삭제`}
                          title="삭제"
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 8,
                            border: `1px solid ${BORDER_COLOR}`,
                            background: CARD_BACKGROUND,
                            color: "#bbb",
                            cursor: "pointer",
                            fontSize: 16,
                            lineHeight: "24px",
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {searched && (
              <div>
                <Card style={{ padding: 24 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: "#222" }}>
                    선택한 자료로 만들기
                  </h3>
                  <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "#888" }}>
                    체크한 강의자료를 기준으로 요약을 만들거나 바로 퀴즈를 생성할 수 있습니다.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <button onClick={() => setView("templates")} disabled={!selectedMarkdown || isExtracting} style={{
                      padding: "18px 14px", borderRadius: 12, border: "none",
                      background: selectedMarkdown && !isExtracting ? "#FFF0F6" : "#f0f0f0",
                      color: selectedMarkdown && !isExtracting ? PINK : "#aaa",
                      fontSize: 14, fontWeight: 800,
                      cursor: selectedMarkdown && !isExtracting ? "pointer" : "default",
                      textAlign: "center", lineHeight: 1.4,
                    }}>요약<br/>새로 생성</button>
                    <button onClick={handleGoToQuiz} disabled={!selectedMarkdown || isExtracting} style={{
                      padding: "18px 14px", borderRadius: 12, border: "none",
                      background: selectedMarkdown && !isExtracting ? "#E8FAFE" : "#f0f0f0",
                      color: selectedMarkdown && !isExtracting ? CYAN : "#aaa",
                      fontSize: 14, fontWeight: 800,
                      cursor: selectedMarkdown && !isExtracting ? "pointer" : "default",
                      textAlign: "center", lineHeight: 1.4,
                    }}>퀴즈<br/>새로 생성</button>
                  </div>
                </Card>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
