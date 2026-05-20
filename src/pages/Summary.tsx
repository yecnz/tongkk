import { useState, useRef, useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { summarizeWithTemplate, type SummaryTemplate } from "../services/gpt";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";
import { getPdfPageCount } from "../services/pdfPageCount";
import { sendAgentMessage, type AgentMessage } from "../services/agent";
import {
  loadSummaryChatMessages,
  saveSummaryChatMessage,
} from "../services/summaryChats";
import {
  deleteSummariesByMaterialId,
  loadSummariesFromServer,
  saveSummaryToServer,
} from "../services/summaries";
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

type FileKind = "pdf" | "ppt" | "img" | "file";
type SummaryView = "upload" | "templates" | "summaryResult" | "quizCreate" | "materialDetail";
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
  materialIds?: string[];
  openSummary?: boolean;
} | null;
type FileIconProps = { type: FileKind };
type TemplateSelectViewProps = { onSelect: (template: SummaryTemplate) => void; onBack: () => void };
type SummaryResultViewProps = { template: SummaryTemplate; onBack: () => void; realContent: string; isLoading: boolean; error: string; loadingStep: string; elapsedTime: string | null; threadId: string; summaryId: string | null; agentContext: string; onGoToQuiz?: () => void };
type MaterialDetailViewProps = { material: CourseMaterial; onBack: () => void; onGoSummary: () => void; onGoQuiz: () => void };
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
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "img";
  return "file";
};

const isSupportedDocumentFile = (file: File) =>
  ["pdf", "ppt", "pptx"].includes((file.name.split(".").pop() || "").toLowerCase());

const getFileNameKey = (name: string) => name.trim().toLowerCase();
const sameMaterialIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
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

const isTableRow = (line: string) => /^\|.+\|$/.test(line.trim());
const isSeparatorRow = (line: string) => /^\|[\s|:-]+\|$/.test(line.trim());

const renderTableBlock = (tableLines: string[], key: number) => {
  const rows = tableLines.filter(l => !isSeparatorRow(l));
  if (rows.length < 1) return null;
  const parseRow = (line: string) =>
    line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  const [headerRow, ...bodyRows] = rows;
  const headers = parseRow(headerRow);
  return (
    <div key={key} style={{ overflowX: "auto", margin: "4px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: "7px 12px", background: "#FFF0F6", color: "#444", fontWeight: 700, border: "1px solid #f0c0d0", textAlign: "left", whiteSpace: "nowrap" }}>
                {renderInlineText(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#fafafa" }}>
              {parseRow(row).map((cell, ci) => (
                <td key={ci} style={{ padding: "6px 12px", border: "1px solid #f0e0e8", color: "#444", lineHeight: 1.6 }}>
                  {renderInlineText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const FormattedAiText = ({ content }: { content: string }) => {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");

  // Group consecutive table lines into blocks
  type Block = { type: "table"; lines: string[] } | { type: "line"; raw: string; index: number };
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      const tableLines: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isSeparatorRow(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", lines: tableLines });
    } else {
      blocks.push({ type: "line", raw: lines[i], index: i });
      i++;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {blocks.map((block, blockIdx) => {
        if (block.type === "table") return renderTableBlock(block.lines, blockIdx);

        const { raw: rawLine, index } = block;
        const line = rawLine.trim();
        if (!line) return <div key={blockIdx} style={{ height: 8 }} />;

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <div key={blockIdx} style={{
              fontSize: level <= 2 ? 18 : 16,
              fontWeight: 800,
              color: "#222",
              marginTop: index === 0 ? 0 : 10,
              lineHeight: 1.45,
            }}>
              {renderInlineText(heading[2])}
            </div>
          );
        }

        const boldHeading = line.match(/^\*\*(.+)\*\*$/);
        if (boldHeading) {
          return (
            <div key={blockIdx} style={{
              fontSize: 15,
              fontWeight: 800,
              color: "#222",
              marginTop: index === 0 ? 0 : 8,
              lineHeight: 1.45,
            }}>
              {renderInlineText(boldHeading[1])}
            </div>
          );
        }

        const bullet = line.match(/^[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={blockIdx} style={{ display: "flex", gap: 9, alignItems: "flex-start", lineHeight: 1.7 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: PINK, marginTop: 10, flexShrink: 0 }} />
              <span>{renderInlineText(bullet[1])}</span>
            </div>
          );
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          return (
            <div key={blockIdx} style={{ display: "flex", gap: 9, alignItems: "flex-start", lineHeight: 1.7 }}>
              <span style={{ color: PINK, fontWeight: 800, minWidth: 18 }}>{numbered[1]}.</span>
              <span>{renderInlineText(numbered[2])}</span>
            </div>
          );
        }

        return (
          <div key={blockIdx} style={{ lineHeight: 1.75 }}>
            {renderInlineText(line)}
          </div>
        );
      })}
    </div>
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

const SUGGESTION_TRIGGER = /원하시면|다음으로는|해드릴게요|알려드릴게요|다음 단계로|중 하나로|바꿔드릴게요|골라주세요|선택해주세요/;

const parseAiSuggestions = (content: string): { mainContent: string; suggestions: string[] } => {
  const lines = content.split("\n");

  // Step 1: collect trailing bullet block (skip blank lines at the end)
  let tail = lines.length - 1;
  while (tail >= 0 && !lines[tail].trim()) tail--;

  const bulletItems: string[] = [];
  let bulletStart = tail + 1;
  let i = tail;
  while (i >= 0) {
    const line = lines[i].trim();
    if (!line) { i--; continue; }
    const m = line.match(/^[-•*]\s+(.{4,80})$/);
    if (m) { bulletItems.unshift(m[1].replace(/\*\*/g, "")); bulletStart = i; i--; }
    else break;
  }

  // Also collect quoted suggestions from the last few lines if no bullets found
  if (bulletItems.length === 0) {
    let cutIndex = lines.length;
    let inSection = false;
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j].trim();
      if (!line) continue;
      const quotedMatches = [...line.matchAll(/[“”“”]([^””“”]{4,60})[“”“”]/g)].map(m => m[1]);
      if (quotedMatches.length > 0) {
        bulletItems.unshift(...quotedMatches);
        cutIndex = j;
        inSection = true;
      } else if (SUGGESTION_TRIGGER.test(line)) {
        cutIndex = j;
        inSection = true;
      } else if (inSection) {
        break;
      } else {
        break;
      }
    }
    if (bulletItems.length > 0) {
      return { mainContent: lines.slice(0, cutIndex).join("\n").trim(), suggestions: bulletItems };
    }
    return { mainContent: content, suggestions: [] };
  }

  // Step 2: require at least 2 bullets to treat as suggestions
  if (bulletItems.length < 2) return { mainContent: content, suggestions: [] };

  // Step 3: look for a trigger phrase before the bullet block (within 6 lines)
  let cutIdx = bulletStart;
  let j = bulletStart - 1;
  while (j >= 0 && bulletStart - j <= 6) {
    const line = lines[j].trim();
    if (!line) { j--; continue; }
    if (SUGGESTION_TRIGGER.test(line)) { cutIdx = j; }
    j--;
  }

  return {
    mainContent: lines.slice(0, cutIdx).join("\n").trim(),
    suggestions: bulletItems,
  };
};

const SummaryResultView = ({ template, onBack, realContent, isLoading, error, loadingStep, elapsedTime, threadId, summaryId, agentContext, onGoToQuiz }: SummaryResultViewProps) => {
  const data = summaryData[template];
  const displayContent = realContent || data.content;
  const mindmapData = template === "MINDMAP" && displayContent ? parseMindmapJson(displayContent) : null;
  const [localThreadId, setLocalThreadId] = useState(threadId);
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [pdfSaving, setPdfSaving] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const skipNextScrollRef = useRef(false);
  const canUseAgent = Boolean(displayContent.trim());

  const scrollToBottom = () => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 60);
  };
  const questions = suggestedTutorQuestions[template];

  const exportText = `${templateLabels[template]} 요약\n\n${displayContent}`;

  useEffect(() => {
    let ignore = false;
    setLocalThreadId(threadId);
    setAgentInput("");
    setAgentError("");
    setChatLoading(false);

    if (!summaryId) {
      setAgentMessages([]);
      return () => {
        ignore = true;
      };
    }

    setChatLoading(true);
    loadSummaryChatMessages(summaryId)
      .then(messages => {
        if (!ignore) setAgentMessages(messages);
      })
      .catch(err => {
        if (!ignore) {
          setAgentMessages([]);
          setAgentError(err instanceof Error ? err.message : "AI 튜터 대화 불러오기 실패");
        }
      })
      .finally(() => {
        if (!ignore) setChatLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [summaryId, threadId, displayContent]);

  useEffect(() => {
    if (skipNextScrollRef.current) { skipNextScrollRef.current = false; return; }
    const lastMsg = agentMessages[agentMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "user") return;
    const el = chatContainerRef.current;
    if (!el) return;
    const userDivs = el.querySelectorAll<HTMLElement>("[data-msg-role='user']");
    const last = userDivs[userDivs.length - 1];
    if (last) last.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [agentMessages]);

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

  const sendAgentQuestion = async (question: string) => {
    const content = question.trim();
    if (!content || !canUseAgent || chatLoading || agentLoading) return;

    const userMessage: AgentMessage = { role: "user", content };
    const nextMessages = [...agentMessages, userMessage];
    setAgentMessages(nextMessages);
    setAgentInput("");
    setAgentError("");
    setAgentLoading(true);

    try {
      let persistenceError = "";
      if (summaryId) {
        try {
          await saveSummaryChatMessage(summaryId, userMessage);
        } catch (err) {
          persistenceError = err instanceof Error ? err.message : "AI 튜터 대화 저장 실패";
        }
      }

      const response = await sendAgentMessage(
        localThreadId,
        localThreadId ? [userMessage] : nextMessages,
        localThreadId ? undefined : agentContext || displayContent,
      );
      const assistantMessage: AgentMessage = { role: "assistant", content: response.result };
      setLocalThreadId(response.threadId);
      setAgentMessages(prev => [...prev, assistantMessage]);
      if (summaryId) {
        try {
          await saveSummaryChatMessage(summaryId, assistantMessage);
        } catch (err) {
          persistenceError = err instanceof Error ? err.message : "AI 튜터 대화 저장 실패";
        }
      }
      if (persistenceError) {
        setAgentError(`대화 저장 실패: ${persistenceError}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent 요청 실패";
      setAgentError(message);
    } finally {
      setAgentLoading(false);
    }
  };

  const handleAgentSubmit = async () => {
    await sendAgentQuestion(agentInput);
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18, alignItems: "start" }}>
            <div style={{
              background: "#fafafa", borderRadius: 12, padding: 24,
              fontSize: 14, color: "#444", lineHeight: 1.8,
              overflowX: "auto",
            }}>
              {mindmapData ? (
                <MindmapView key={displayContent} data={mindmapData} />
              ) : (
                <FormattedAiText content={displayContent} />
              )}
            </div>

            <div style={{
              border: "1px solid #f0f0f0",
              borderRadius: 12,
              padding: 18,
              height: 720,
              display: "flex",
              flexDirection: "column",
              background: "#fff",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#222" }}>AI 튜터</h3>
                {agentMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setAgentMessages([]); setLocalThreadId(""); setAgentError(""); }}
                    style={{
                      padding: "4px 10px", borderRadius: 8, border: "1px solid #e0e0e0",
                      background: "#fafafa", color: "#999", fontSize: 12, cursor: "pointer",
                    }}
                  >새 대화</button>
                )}
              </div>
              <p style={{ margin: "0 0 14px", fontSize: 12, lineHeight: 1.6, color: "#888" }}>
                요약본을 기준으로 헷갈리는 개념을 이어서 질문하세요.
              </p>

              {canUseAgent && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#999" }}>추천 질문</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {questions.map(question => (
                      <button
                        key={question}
                        type="button"
                        onClick={() => sendAgentQuestion(question)}
                        disabled={chatLoading || agentLoading}
                        style={{
                          padding: "7px 10px",
                          borderRadius: 999,
                          border: "1px solid #eeeeee",
                          background: "#fafafa",
                          color: "#555",
                          fontSize: 12,
                          fontWeight: 700,
                          lineHeight: 1.35,
                          cursor: chatLoading || agentLoading ? "default" : "pointer",
                          opacity: chatLoading || agentLoading ? 0.55 : 1,
                          textAlign: "left",
                        }}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ flex: 1, minHeight: 0, position: "relative", marginBottom: 14 }}>
              <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                {!canUseAgent ? (
                  <div style={{ padding: 14, borderRadius: 12, background: "#fafafa", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                    새로 생성한 요약에서 AI 튜터 대화를 시작할 수 있습니다.
                  </div>
                ) : chatLoading ? (
                  <div style={{ padding: 14, borderRadius: 12, background: "#fafafa", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                    이전 AI 튜터 대화를 불러오는 중입니다.
                  </div>
                ) : agentMessages.length === 0 ? (
                  <div style={{ padding: 14, borderRadius: 12, background: "#fafafa", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                    예: “이 개념을 쉬운 예시로 설명해줘” 또는 “시험에 나올 만한 포인트를 알려줘”
                  </div>
                ) : (
                  <>
                    {agentMessages.map((msg, i) => {
                      const isLastAssistant = msg.role === "assistant" && i === agentMessages.length - 1 && !agentLoading;
                      const { mainContent, suggestions } = msg.role === "assistant"
                        ? parseAiSuggestions(msg.content)
                        : { mainContent: msg.content, suggestions: [] };
                      return (
                        <div key={`${msg.role}-${i}`} data-msg-role={msg.role} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{
                            padding: "10px 14px",
                            borderRadius: 12,
                            background: msg.role === "user" ? "#E8FAFE" : "#fafafa",
                            color: "#444",
                            fontSize: 13,
                            lineHeight: 1.6
                          }}>
                            <FormattedAiText content={mainContent} />
                          </div>
                          {isLastAssistant && suggestions.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#bbb", letterSpacing: "0.04em" }}>바로 이어서</span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {suggestions.map(suggestion => (
                                  <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => { skipNextScrollRef.current = true; sendAgentQuestion(suggestion); }}
                                    disabled={agentLoading}
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      border: `1px solid ${PINK}33`,
                                      background: "#FFF0F6",
                                      color: PINK,
                                      fontSize: 12,
                                      fontWeight: 400,
                                      lineHeight: 1.35,
                                      cursor: agentLoading ? "default" : "pointer",
                                      opacity: agentLoading ? 0.55 : 1,
                                      textAlign: "left",
                                    }}
                                  >
                                    {suggestion.replace(/\*\*/g, "")}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {agentLoading && (
                      <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 12, background: "#fafafa", color: "#aaa", fontSize: 13 }}>
                        응답 중...
                      </div>
                    )}
                  </>
                )}
              </div>
                {showScrollBtn && (
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    title="맨 아래로"
                    style={{
                      position: "absolute",
                      bottom: 8,
                      right: 8,
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      border: "1px solid #e0e0e0",
                      background: "#fff",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                      color: "#888",
                      fontSize: 16,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 10,
                    }}
                  >↓</button>
                )}
              </div>

              {agentError && (
                <div style={{ marginBottom: 10, fontSize: 12, color: "#E53E3E" }}>{agentError}</div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={agentInput}
                  onChange={e => setAgentInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleAgentSubmit(); }}
                  disabled={!canUseAgent || chatLoading || agentLoading}
                  placeholder="요약본에 대해 질문하기"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "11px 13px",
                    borderRadius: 10,
                    border: "1px solid #e0e0e0",
                    fontSize: 13,
                    outline: "none"
                  }}
                />
                <button
                  onClick={handleAgentSubmit}
                  disabled={!canUseAgent || chatLoading || !agentInput.trim() || agentLoading}
                  style={{
                    padding: "0 14px", borderRadius: 10, border: "none",
                    background: !canUseAgent || chatLoading || agentLoading ? "#ddd" : PINK, color: "#fff",
                    fontSize: 13, fontWeight: 800,
                    cursor: !canUseAgent || chatLoading || agentLoading ? "default" : "pointer",
                    flexShrink: 0,
                  }}
                >
                  {agentLoading ? "응답 중" : "전송"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

const MaterialDetailView = ({ material, onBack, onGoSummary, onGoQuiz }: MaterialDetailViewProps) => {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const isPdf = material.type === "pdf" || material.mimeType === "application/pdf" || material.name.toLowerCase().endsWith(".pdf");

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
            <p style={{ margin: 0, fontSize: 12, color: "#b7b7b7" }}>
              {material.pages ? `${material.pages}p` : material.slides ? `${material.slides}s` : material.type.toUpperCase()} · PDF 원본 보기
            </p>
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
            <button onClick={onGoSummary} style={{
              height: 34, padding: "0 12px", borderRadius: 8, border: "none",
              background: "#FFF0F6", color: PINK, fontSize: 13, fontWeight: 800, cursor: "pointer"
            }}>요약</button>
            <button onClick={onGoQuiz} style={{
              height: 34, padding: "0 12px", borderRadius: 8, border: "none",
              background: "#E8FAFE", color: CYAN, fontSize: 13, fontWeight: 800, cursor: "pointer"
            }}>퀴즈</button>
          </div>
        </div>

        {fileLoading ? (
          <div style={{ minHeight: 520, display: "grid", placeItems: "center", background: "#2b2b2b", color: "#ddd", fontSize: 14 }}>
            원본 PDF를 불러오는 중입니다.
          </div>
        ) : fileUrl && isPdf ? (
          <iframe
            title={material.name}
            src={`${fileUrl}#toolbar=1&navpanes=0`}
            style={{
              width: "100%",
              height: "calc(100vh - 190px)",
              minHeight: 620,
              border: "none",
              background: "#2b2b2b",
              display: "block",
            }}
          />
        ) : (
          <div style={{
            background: "#fafafa",
            padding: 24,
            fontSize: 14,
            color: "#444",
            lineHeight: 1.8,
            minHeight: 520,
            maxHeight: "calc(100vh - 220px)",
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
        )}
      </Card>
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
  const initialCourse = (locationState?.selectedCourse || "").trim();
  const fromDashboardRef = useRef(Boolean(initialCourse && locationState?.fromDashboard));
  const pendingMaterialIdRef = useRef(locationState?.viewMaterial ? locationState.materialId || "" : "");
  const pendingSummaryRef = useRef(locationState?.openSummary ? {
    id: locationState.summaryId || "",
    template: locationState.summaryTemplate,
    materialIds: locationState.materialIds || [],
  } : null);
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searched, setSearched] = useState(Boolean(initialCourse));
  const [selectedCourse, setSelectedCourse] = useState(initialCourse);
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
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<DuplicateFileNotice | null>(null);
  const [agentThreadId, setAgentThreadId] = useState("");
  const [resultBackView, setResultBackView] = useState<"templates" | "upload">("templates");
  const selectedMaterials = materials.filter(material => selectedMaterialIds.includes(material.id));
  const selectedMarkdown = combineMaterialsMarkdown(selectedMaterials);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

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
            setActiveMaterial(material);
            setSelectedMaterialIds([material.id]);
            setSearched(true);
            setView("materialDetail");
            return;
          }
        }

        const pendingSummary = pendingSummaryRef.current;
        if (pendingSummary) {
          pendingSummaryRef.current = null;
          const summary = summaries.find(item =>
            (pendingSummary.id && item.id === pendingSummary.id) ||
            (
              pendingSummary.template &&
              item.template === pendingSummary.template &&
              sameMaterialIds(item.materialIds, pendingSummary.materialIds)
            )
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
          const markdown = await extractMarkdownFromPDF(documentFile);
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
      if (selectedCourse) {
        const savedSummary = (await loadSummariesFromServer(selectedCourse)).find(s =>
          s.template === template && sameMaterialIds(s.materialIds, selectedMaterialIds)
        );

        if (savedSummary) {
          setSummaryText(savedSummary.content);
          setActiveSummaryId(savedSummary.id || null);
          setIsSummarizing(false);
          setView("summaryResult");
          setSummaryError("");
          setElapsedTime(null);
          setLoadingStep("");
          setAgentThreadId("");
          setResultBackView("templates");
          return;
        }
      }

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

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
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
                      background: "#fff",
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
            realContent={summaryText}
            isLoading={isSummarizing}
            error={summaryError}
            loadingStep={loadingStep}
            elapsedTime={elapsedTime}
            threadId={agentThreadId}
            summaryId={activeSummaryId}
            agentContext={selectedMarkdown || summaryText}
            onGoToQuiz={selectedCourse ? handleGoToQuiz : undefined}
          />
        )}

        {view === "materialDetail" && activeMaterial && (
          <MaterialDetailView
            material={activeMaterial}
            onBack={() => setView("upload")}
            onGoSummary={() => setView("templates")}
            onGoQuiz={handleGoToQuiz}
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
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? CYAN : "#ddd"}`,
                    borderRadius: 14, padding: "40px 20px", textAlign: "center",
                    cursor: "pointer", background: dragOver ? "#F0FDFF" : "#fafafa",
                    transition: "all 0.2s", marginBottom: 20
                  }}
                >
                  <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx"
                    onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                  <p style={{ margin: "0 0 8px", fontSize: 14, color: "#888" }}>PDF, PPT 파일을 드래그하거나</p>
                  <button style={{
                    marginTop: 12, padding: "8px 20px", borderRadius: 10, border: "1px solid #ddd",
                    background: "#fff", fontSize: 13, cursor: "pointer", color: "#555"
                  }}>파일 선택</button>
                </div>

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
                    <span style={{ fontSize: 13, color: "#4CAF50", fontWeight: 500 }}>선택한 자료 {selectedMaterials.length}개 — 요약 생성 가능</span>
                  </div>
                )}
                {extractError && (
                  <div style={{ padding: "8px 0", fontSize: 12, color: "#E53E3E" }}>
                    분석 실패: {extractError}
                  </div>
                )}

                {materials.length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#555" }}>
                      강의자료 선택
                    </h4>
                    {materials.map(material => {
                      const isSelected = selectedMaterialIds.includes(material.id);
                      return (
                      <div key={material.id} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 14px",
                        background: isSelected ? "#F0FDFF" : "#fafafa",
                        border: isSelected ? `1px solid ${CYAN}` : "1px solid transparent",
                        borderRadius: 10, marginBottom: 8
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            setSelectedMaterialIds(prev =>
                              e.target.checked
                                ? [...prev, material.id]
                                : prev.filter(id => id !== material.id)
                            );
                          }}
                        />
                        <FileIcon type={material.type} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#333" }}>{material.name}</span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>
                          {material.pages ? `${material.pages}p` : material.slides ? `${material.slides}s` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(material)}
                          aria-label={`${material.name} 삭제`}
                          title="삭제"
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 8,
                            border: "1px solid #eeeeee",
                            background: "#fff",
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
                      textAlign: "center", lineHeight: 1.4
                    }}>요약<br/>새로 생성</button>
                    <button onClick={handleGoToQuiz} disabled={!selectedMarkdown || isExtracting} style={{
                      padding: "18px 14px", borderRadius: 12, border: "none",
                      background: selectedMarkdown && !isExtracting ? "#E8FAFE" : "#f0f0f0",
                      color: selectedMarkdown && !isExtracting ? CYAN : "#aaa",
                      fontSize: 14, fontWeight: 800,
                      cursor: selectedMarkdown && !isExtracting ? "pointer" : "default",
                      textAlign: "center", lineHeight: 1.4
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
