import { useState, useRef, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { summarizeWithTemplate, type SummaryTemplate } from "../services/gpt";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";
import { sendAgentMessage, type AgentMessage } from "../services/agent";

type FileKind = "pdf" | "ppt" | "img" | "file";
type SummaryView = "upload" | "templates" | "summaryResult" | "quizCreate";
type UploadedFile = { name: string; size: number; type: FileKind; pages: number | null; slides: number | null; rawFile: File };
type SummarySample = { title: string; content: string };
type MindMapBranch = { title: string; children: string[] };
type ParsedMindMap = { root: string; branches: MindMapBranch[] };
type FileIconProps = { type: FileKind };
type TemplateSelectViewProps = { onSelect: (template: SummaryTemplate) => void; onBack: () => void };
type SummaryResultViewProps = { template: SummaryTemplate; onBack: () => void; realContent: string; isLoading: boolean; error: string; loadingStep: string; elapsedTime: string | null; threadId: string };
type QuizCreateViewProps = { fileName?: string; onBack: () => void };

const templateLabels: Record<SummaryTemplate, string> = {
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
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

const FormattedAiText = ({ content }: { content: string }) => {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={index} style={{ height: 8 }} />;

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <div key={index} style={{
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
            <div key={index} style={{
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
            <div key={index} style={{ display: "flex", gap: 9, alignItems: "flex-start", lineHeight: 1.7 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: PINK, marginTop: 10, flexShrink: 0 }} />
              <span>{renderInlineText(bullet[1])}</span>
            </div>
          );
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          return (
            <div key={index} style={{ display: "flex", gap: 9, alignItems: "flex-start", lineHeight: 1.7 }}>
              <span style={{ color: PINK, fontWeight: 800, minWidth: 18 }}>{numbered[1]}.</span>
              <span>{renderInlineText(numbered[2])}</span>
            </div>
          );
        }

        return (
          <div key={index} style={{ lineHeight: 1.75 }}>
            {renderInlineText(line)}
          </div>
        );
      })}
    </div>
  );
};


const stripInlineMarkdown = (text: string) => (
  text
    .replace(/^#{1,6}\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[-*•]\s+/, "")
    .trim()
);

const parseMindMap = (content: string): ParsedMindMap => {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let root = "";
  let currentBranch: MindMapBranch | null = null;
  let readingRoot = false;
  let readingConnection = false;
  const branches: MindMapBranch[] = [];

  lines.forEach(rawLine => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const rootWithValue = trimmed.match(/^중심\s*주제\s*[:：]\s*(.+)$/);
    if (rootWithValue) {
      root = stripInlineMarkdown(rootWithValue[1]);
      readingRoot = false;
      return;
    }

    if (/^중심\s*주제$/.test(stripInlineMarkdown(trimmed))) {
      readingRoot = true;
      readingConnection = false;
      return;
    }

    if (readingRoot) {
      root = stripInlineMarkdown(trimmed);
      readingRoot = false;
      return;
    }

    if (/^주요\s*가지$/.test(stripInlineMarkdown(trimmed))) {
      readingConnection = false;
      return;
    }

    if (/^핵심\s*연결$/.test(stripInlineMarkdown(trimmed))) {
      currentBranch = { title: "핵심 연결", children: [] };
      branches.push(currentBranch);
      readingConnection = true;
      return;
    }

    const bullet = rawLine.match(/^(\s*)[-*•]\s+(.+)$/);
    const numbered = rawLine.match(/^(\s*)\d+[.)]\s+(.+)$/);
    const item = bullet || numbered;

    if (item) {
      const indent = item[1].replace(/\t/g, "  ").length;
      const value = stripInlineMarkdown(item[2]);
      if (!value) return;

      if (indent >= 2 || readingConnection) {
        if (!currentBranch) {
          currentBranch = { title: "세부 내용", children: [] };
          branches.push(currentBranch);
        }
        currentBranch.children.push(value);
        return;
      }

      currentBranch = { title: value, children: [] };
      branches.push(currentBranch);
      return;
    }

    if (!root && !/^(마인드맵|요약|주요\s*가지|핵심\s*연결)$/.test(stripInlineMarkdown(trimmed))) {
      root = stripInlineMarkdown(trimmed);
    }
  });

  const fallbackLines = lines
    .map(line => stripInlineMarkdown(line))
    .filter(line => line && line !== root && !/^(중심\s*주제|주요\s*가지|핵심\s*연결)$/.test(line));

  const cleanedBranches = branches
    .filter(branch => branch.title && branch.title !== root)
    .map(branch => ({
      title: branch.title,
      children: branch.children.filter(Boolean).slice(0, 4),
    }))
    .slice(0, 8);

  if (cleanedBranches.length === 0) {
    cleanedBranches.push(
      ...fallbackLines.slice(0, 6).map(line => ({ title: line, children: [] })),
    );
  }

  return {
    root: root || "핵심 주제",
    branches: cleanedBranches.length > 0 ? cleanedBranches : [{ title: "핵심 내용", children: [] }],
  };
};

const MindMapView = ({ content }: { content: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [showChildren, setShowChildren] = useState(true);
  const mindMap = parseMindMap(content);
  const branches = mindMap.branches;
  const childSpacing = 56;
  const branchGap = 30;
  const rootNode = { x: 18, w: 150, h: 44 };
  const mainNode = { x: 288, w: 192, h: 46 };
  const childNode = { x: 654, w: 250, h: 42 };
  const blockHeights = branches.map(branch => {
    const childCount = showChildren ? Math.max(branch.children.length, 1) : 1;
    return Math.max(58, childCount * childSpacing);
  });
  const canvasHeight = Math.max(500, blockHeights.reduce((sum, height) => sum + height + branchGap, 92));
  const canvasWidth = 950;
  const rootY = canvasHeight / 2 - rootNode.h / 2;
  const branchOffsets = blockHeights.map((_, index) => (
    70 + blockHeights.slice(0, index).reduce((sum, height) => sum + height + branchGap, 0)
  ));

  const rows = branches.map((branch, index) => {
    const blockHeight = blockHeights[index];
    const cursorY = branchOffsets[index];
    const mainY = cursorY + blockHeight / 2 - mainNode.h / 2;
    const children = showChildren ? branch.children : [];
    const childStartY = cursorY + (blockHeight - Math.max(children.length, 1) * childSpacing) / 2;
    const childRows = children.map((child, childIndex) => ({
      title: child,
      y: childStartY + childIndex * childSpacing + (childSpacing - childNode.h) / 2,
    }));
    return { branch, mainY, childRows };
  });

  const nodeStyle = (tone: "root" | "branch" | "child", x: number, y: number, w: number, h: number): CSSProperties => {
    const tones = {
      root: { background: "#EFE8FF", border: "#D6C9FF", color: "#5B49A1" },
      branch: { background: "#F0F0F0", border: "#D9D9D9", color: "#333333" },
      child: { background: "#BFE4E2", border: "#A7D4D1", color: "#285A58" },
    };
    const selected = tones[tone];
    return {
      position: "absolute",
      left: x,
      top: y,
      width: w,
      minHeight: h,
      padding: "10px 14px",
      borderRadius: 8,
      border: `1px solid ${selected.border}`,
      background: selected.background,
      color: selected.color,
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      fontSize: 13,
      fontWeight: 800,
      lineHeight: 1.35,
      boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
      wordBreak: "keep-all",
      overflowWrap: "break-word",
      zIndex: 2,
    };
  };

  const dotStyle = (x: number, y: number, tone: "root" | "branch"): CSSProperties => ({
    position: "absolute",
    left: x,
    top: y,
    width: 24,
    height: 24,
    borderRadius: "50%",
    border: tone === "root" ? "1px solid #D6C9FF" : "1px solid #D7DEE6",
    background: tone === "root" ? "#EFE8FF" : "#EFF3F6",
    color: tone === "root" ? "#6A55B5" : "#52606D",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 800,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
    zIndex: 3,
  });

  const toolButtonStyle: CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 14,
    border: "1px solid #E5E7EB",
    background: "#fff",
    color: "#333",
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)",
  };

  const downloadMindMap = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mindmap-summary.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      position: "relative",
      minHeight: expanded ? 660 : 520,
      maxHeight: expanded ? "none" : 560,
      overflow: "auto",
      borderRadius: 12,
      border: "1px solid #ECECEC",
      background: "#fff",
    }}>
      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 10, zIndex: 5 }}>
        <button type="button" title={expanded ? "작게 보기" : "크게 보기"} onClick={() => setExpanded(value => !value)} style={toolButtonStyle}>
          {expanded ? "↙" : "↗"}
        </button>
        <button type="button" title="마인드맵 텍스트 다운로드" onClick={downloadMindMap} style={toolButtonStyle}>
          ↓
        </button>
      </div>

      <button
        type="button"
        title={showChildren ? "하위 노드 접기" : "하위 노드 펼치기"}
        onClick={() => setShowChildren(value => !value)}
        style={{ ...toolButtonStyle, position: "absolute", right: 16, bottom: 16, zIndex: 5 }}
      >
        {showChildren ? "⌃" : "⌄"}
      </button>

      <div style={{ position: "relative", width: canvasWidth, height: canvasHeight, margin: "0 auto" }}>
        <svg width={canvasWidth} height={canvasHeight} style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          {rows.map((row, index) => {
            const startX = rootNode.x + rootNode.w;
            const startY = rootY + rootNode.h / 2;
            const endX = mainNode.x;
            const endY = row.mainY + mainNode.h / 2;
            return (
              <path
                key={`root-${index}`}
                d={`M ${startX} ${startY} C ${startX + 70} ${startY}, ${endX - 120} ${endY}, ${endX} ${endY}`}
                fill="none"
                stroke="#BFC8D4"
                strokeWidth="2.3"
                strokeLinecap="round"
              />
            );
          })}
          {rows.flatMap((row, branchIndex) => row.childRows.map((child, childIndex) => {
            const startX = mainNode.x + mainNode.w;
            const startY = row.mainY + mainNode.h / 2;
            const endX = childNode.x;
            const endY = child.y + childNode.h / 2;
            return (
              <path
                key={`child-${branchIndex}-${childIndex}`}
                d={`M ${startX} ${startY} C ${startX + 80} ${startY}, ${endX - 120} ${endY}, ${endX} ${endY}`}
                fill="none"
                stroke="#BFC8D4"
                strokeWidth="2.3"
                strokeLinecap="round"
              />
            );
          }))}
        </svg>

        <div style={nodeStyle("root", rootNode.x, rootY, rootNode.w, rootNode.h)}>
          {mindMap.root}
        </div>
        <span style={dotStyle(rootNode.x + rootNode.w + 8, rootY + 10)}>‹</span>

        {rows.map((row, index) => (
          <div key={`branch-node-${index}`}>
            <div style={nodeStyle("branch", mainNode.x, row.mainY, mainNode.w, mainNode.h)}>
              {row.branch.title}
            </div>
            {row.branch.children.length > 0 && (
              <span style={dotStyle(mainNode.x + mainNode.w + 8, row.mainY + 11)}>{showChildren ? "‹" : "›"}</span>
            )}
            {row.childRows.map((child, childIndex) => (
              <div key={`child-node-${index}-${childIndex}`} style={nodeStyle("child", childNode.x, child.y, childNode.w, childNode.h)}>
                {child.title}
              </div>
            ))}
          </div>
        ))}
      </div>
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

const SummaryResultView = ({ template, onBack, realContent, isLoading, error, loadingStep, elapsedTime, threadId }: SummaryResultViewProps) => {
  const data = summaryData[template];
  const displayContent = realContent || data.content;
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const canUseAgent = Boolean(threadId);

  const handleAgentSubmit = async () => {
    const content = agentInput.trim();
    if (!content || !canUseAgent || agentLoading) return;

    const userMessage: AgentMessage = { role: "user", content };
    setAgentMessages(prev => [...prev, userMessage]);
    setAgentInput("");
    setAgentError("");
    setAgentLoading(true);

    try {
      const response = await sendAgentMessage(threadId, [userMessage]);
      setAgentMessages(prev => [...prev, { role: "assistant", content: response.result }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent 요청 실패";
      setAgentError(message);
    } finally {
      setAgentLoading(false);
    }
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 템플릿 선택으로</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{
            padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: template === "GENERAL" ? "#f5f5f5" : template === "LECTURE_NOTE" ? "#FFF0F6" : template === "MINDMAP" ? "#E8FAFE" : "#F2EEFF",
            color: template === "GENERAL" ? "#555" : template === "LECTURE_NOTE" ? PINK : template === "MINDMAP" ? CYAN : "#7C3AED"
          }}>{templateLabels[template]}</span>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#222" }}>
            {templateLabels[template]} 요약
          </h2>
          {isLoading && (
            <span style={{ fontSize: 13, color: "#aaa", marginLeft: 8 }}>AI가 요약 중...</span>
          )}
          {!isLoading && elapsedTime && (
            <span style={{ fontSize: 12, color: "#bbb", marginLeft: 8 }}>⏱ {elapsedTime}초</span>
          )}
        </div>

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
          <div style={{
            background: "#fafafa", borderRadius: 12, padding: 24,
            fontSize: 14, color: "#444", lineHeight: 1.8
          }}>
            {template === "MINDMAP" ? <MindMapView content={displayContent} /> : <FormattedAiText content={displayContent} />}
          </div>
        )}

        {!isLoading && (
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button style={{
              padding: "10px 24px", borderRadius: 10, border: "none",
              background: CYAN, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer"
            }}>공유하기</button>
            <button style={{
              padding: "10px 24px", borderRadius: 10, border: "1px solid #e0e0e0",
              background: "#fff", color: "#555", fontSize: 14, cursor: "pointer"
            }}>다운로드</button>
          </div>
        )}

        {canUseAgent && !isLoading && !error && (
          <div style={{ marginTop: 24, paddingTop: 22, borderTop: "1px solid #f0f0f0" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#222" }}>추가 질문</h3>
            {agentMessages.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                {agentMessages.map((msg, i) => (
                  <div key={`${msg.role}-${i}`} style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "78%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: msg.role === "user" ? "#E8FAFE" : "#fafafa",
                    color: "#444",
                    fontSize: 13,
                    lineHeight: 1.6
                  }}>
                    <FormattedAiText content={msg.content} />
                  </div>
                ))}
              </div>
            )}
            {agentError && (
              <div style={{ marginBottom: 10, fontSize: 12, color: "#E53E3E" }}>{agentError}</div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={agentInput}
                onChange={e => setAgentInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAgentSubmit(); }}
                placeholder="요약본에 대해 이어서 질문하기"
                style={{
                  flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
                  fontSize: 14, outline: "none"
                }}
              />
              <button
                onClick={handleAgentSubmit}
                disabled={!agentInput.trim() || agentLoading}
                style={{
                  padding: "0 18px", borderRadius: 10, border: "none",
                  background: agentLoading ? "#ddd" : PINK, color: "#fff",
                  fontSize: 14, fontWeight: 700, cursor: agentLoading ? "default" : "pointer"
                }}
              >
                {agentLoading ? "응답 중" : "전송"}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

const QuizCreateView = ({ fileName, onBack }: QuizCreateViewProps) => {
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

          <button style={{
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
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [view, setView] = useState<SummaryView>("upload");
  const [selectedTemplate, setSelectedTemplate] = useState<SummaryTemplate | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [extractedMarkdown, setExtractedMarkdown] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [agentThreadId, setAgentThreadId] = useState("");

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const arr = Array.from(fileList).filter(f =>
      f.type === "application/pdf" || f.type.startsWith("image/") ||
      f.name.endsWith(".ppt") || f.name.endsWith(".pptx")
    );
    if (arr.length === 0) return;
    setUploading(true);

    await new Promise(res => setTimeout(res, 1200));

    const nf = arr.map(f => ({
      name: f.name, size: f.size, type: getFileType(f.name),
      pages: f.type === "application/pdf" ? Math.floor(Math.random() * 30) + 5 : null,
      slides: f.name.endsWith(".pptx") || f.name.endsWith(".ppt") ? Math.floor(Math.random() * 40) + 10 : null,
      rawFile: f,
    }));
    setFiles(prev => [...prev, ...nf]);
    setUploading(false);
    setSearched(true);

    const pdfFile = arr.find(f => f.type === "application/pdf");
    if (pdfFile) {
      setIsExtracting(true);
      setExtractError("");
      setExtractedMarkdown("");
      try {
        const markdown = await extractMarkdownFromPDF(pdfFile);
        setExtractedMarkdown(markdown);
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : "PDF 분석 실패");
      } finally {
        setIsExtracting(false);
      }
    }
  };

  const communityResults = [
    { title: "알고리즘 7주차 정리", type: "요약" },
    { title: "DP 문제풀이 퀴즈", type: "퀴즈" },
    { title: "중간고사 예상문제 모음", type: "요약" },
  ];

  const handleTemplateSelect = async (template: SummaryTemplate) => {
    setSelectedTemplate(template);
    setSummaryError("");

    if (extractedMarkdown) {
      setIsSummarizing(true);
      setView("summaryResult");
      setSummaryText("");
      setSummaryError("");
      setElapsedTime(null);
      setAgentThreadId("");
      const startTime = Date.now();
      try {
        setLoadingStep(`${templateLabels[template]} 형식으로 요약 중...`);
        const response = await summarizeWithTemplate(extractedMarkdown, template);
        setSummaryText(response.result);
        setAgentThreadId(response.threadId);
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
      setView("summaryResult");
    }
  };

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="자료 요약" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 자료 요약</span>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        {courses.length > 0 && view === "upload" && (
          <div style={{ marginBottom: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#555", marginRight: 12 }}>과목 선택</span>
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
              {courses.map((c, i) => (
                <button key={i} onClick={() => setSelectedCourse(selectedCourse === c ? "" : c)} style={{
                  padding: "7px 16px", borderRadius: 20,
                  border: selectedCourse === c ? "none" : "1px solid #e0e0e0",
                  background: selectedCourse === c ? PINK : "#fafafa",
                  color: selectedCourse === c ? "#fff" : "#555",
                  fontSize: 13, fontWeight: selectedCourse === c ? 600 : 400, cursor: "pointer"
                }}>{c}</button>
              ))}
            </span>
          </div>
        )}

        {view === "templates" && (
          <TemplateSelectView onSelect={handleTemplateSelect} onBack={() => setView("upload")} />
        )}

        {view === "summaryResult" && selectedTemplate && (
          <SummaryResultView
            template={selectedTemplate}
            onBack={() => setView("templates")}
            realContent={summaryText}
            isLoading={isSummarizing}
            error={summaryError}
            loadingStep={loadingStep}
            elapsedTime={elapsedTime}
            threadId={agentThreadId}
          />
        )}

        {view === "quizCreate" && (
          <QuizCreateView fileName={files[0]?.name} onBack={() => setView("upload")} />
        )}

        {view === "upload" && (
          <div style={{ display: "grid", gridTemplateColumns: files.length > 0 && searched ? "380px 1fr" : "1fr", gap: 28 }}>
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
                  <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx,image/*"
                    onChange={e => handleFiles(e.target.files)} style={{ display: "none" }} />
                  <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📄</div>
                  <p style={{ margin: 0, fontSize: 14, color: "#888" }}>PDF, PPT, 이미지 파일을 드래그하거나</p>
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
                    <span style={{ fontSize: 13, color: PINK, fontWeight: 500 }}>📄 PDF 분석 중...</span>
                  </div>
                )}
                {!isExtracting && extractedMarkdown && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <span style={{ fontSize: 13 }}>✅</span>
                    <span style={{ fontSize: 13, color: "#4CAF50", fontWeight: 500 }}>PDF 분석 완료 — 요약 생성 가능</span>
                  </div>
                )}
                {extractError && (
                  <div style={{ padding: "8px 0", fontSize: 12, color: "#E53E3E" }}>
                    ⚠️ 분석 실패: {extractError}
                  </div>
                )}

                {files.length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#555" }}>업로드된 파일</h4>
                    {files.map((f, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                        background: "#fafafa", borderRadius: 10, marginBottom: 8
                      }}>
                        <FileIcon type={f.type} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#333" }}>{f.name}</span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>
                          {f.pages ? `${f.pages}p` : f.slides ? `${f.slides}s` : ""}
                        </span>
                        <button onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{
                          background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {files.length > 0 && searched && (
              <div>
                <Card style={{ padding: 24 }}>
                  <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700, color: "#222", textAlign: "center" }}>
                    커뮤니티 검색 결과
                  </h3>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#222" }}>제주대</h4>
                      {communityResults.map((item, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                          borderBottom: "1px solid #f5f5f5"
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: item.type === "요약" ? PINK : CYAN, flexShrink: 0
                          }}/>
                          <span style={{ flex: 1, fontSize: 14, color: "#444" }}>{item.title}</span>
                          <span style={{
                            fontSize: 11, padding: "2px 10px", borderRadius: 10,
                            background: item.type === "요약" ? "#FFF0F6" : "#E8FAFE",
                            color: item.type === "요약" ? PINK : CYAN, fontWeight: 500
                          }}>{item.type}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ width: 1, background: "#f0f0f0" }}/>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 130 }}>
                      <button onClick={() => setView("templates")} disabled={!extractedMarkdown || isExtracting} style={{
                        padding: "16px 12px", borderRadius: 12, border: "none",
                        background: extractedMarkdown && !isExtracting ? "#FFF0F6" : "#f0f0f0",
                        color: extractedMarkdown && !isExtracting ? PINK : "#aaa",
                        fontSize: 14, fontWeight: 600,
                        cursor: extractedMarkdown && !isExtracting ? "pointer" : "default",
                        textAlign: "center", lineHeight: 1.4
                      }}>요약<br/>새로 생성</button>
                      <button onClick={() => setView("quizCreate")} style={{
                        padding: "16px 12px", borderRadius: 12, border: "none",
                        background: "#E8FAFE", color: CYAN, fontSize: 14, fontWeight: 600,
                        cursor: "pointer", textAlign: "center", lineHeight: 1.4
                      }}>퀴즈<br/>새로 생성</button>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
