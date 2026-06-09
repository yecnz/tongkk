import { useState, useRef, useEffect, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, pageRoutes, SidebarIcon, Sidebar, Card, normalizeBoldSpacing } from "../common";
import { summarizeWithTemplate, type SummaryTemplate } from "../services/gpt";
import { useToast } from "../ToastContext";
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
  MAX_ORIGINAL_FILE_BYTES,
  type CourseMaterial,
} from "../services/materials";
import { AITutorDrawer } from "../components/AITutorDrawer";
import { createPdfPreviewFromUrl } from "../services/documentPreview";
import { loadUserProfile, updateHideSummaryNotice } from "../services/profile";

type FileKind = "pdf" | "ppt" | "img" | "file";
type SummaryView = "upload" | "materialList" | "templates" | "summaryResult" | "quizCreate" | "materialDetail";
type MaterialDetailTab = "original" | "summary" | "quiz";
type UploadedFile = { name: string; size: number; type: FileKind; pages: number | null; slides: number | null; rawFile: File };
type DuplicateFileNotice = { names: string[]; reattached?: boolean };
type SummarySample = { title: string; content: string };
type UploadStatusState = "uploading" | "extracting" | "previewing" | "storing" | "done" | "duplicate" | "failed";
type UploadFailureKind = "unsupported" | "tooLarge" | "serverTool" | "network" | "auth" | "unknown";
type UploadFileStatus = {
  id: string;
  name: string;
  state: UploadStatusState;
  label: string;
  message: string;
  file?: File;
  materialId?: string;
  failureKind?: UploadFailureKind;
};
type LocationState = {
  selectedCourse?: string;
  fromDashboard?: boolean;
  materialId?: string;
  viewMaterial?: boolean;
  createSummary?: boolean;
  summaryId?: string;
  summaryTemplate?: SummaryTemplate;
  summaryContent?: string;
  summaryCreatedAt?: number;
  materialIds?: string[];
  openSummary?: boolean;
  tutorQuestion?: string;
  quizReviewContext?: string;
  quizReviewTitle?: string;
  materialDetailTab?: MaterialDetailTab;
} | null;
type FileIconProps = { type: FileKind };
// 드래그해서 질문한 본문 구절의 위치 정보. 튜터를 닫을 때 그 자리로 스크롤을 되돌리는 데 쓴다.
// range: 같은 본문이 살아 있을 때 구절 위치 보정용 / scrollY: 확대 등으로 본문이 언마운트돼
// range가 떨어져 나갔을 때 쓰는 드래그 당시 스크롤 위치(근사 복귀용).
type DragAnchor = { range: Range; top: number; scrollY: number };
type TemplateSelectViewProps = { onSelect: (template: SummaryTemplate, opts?: { pageRange?: string; focusPrompt?: string }) => void; onBack: () => void; pageHint?: string };
type SummaryResultViewProps = { template: SummaryTemplate; onBack: () => void; backLabel: string; contextTitle: string; realContent: string; isLoading: boolean; error: string; loadingStep: string; elapsedTime: string | null; threadId: string; summaryId: string | null; resetTutorHistory?: boolean; initialTutorQuestion?: string; onGoToQuiz?: () => void };
type MaterialDetailViewProps = {
  material: CourseMaterial;
  selectedCourse: string;
  onBack: () => void;
  onGoSummary: () => void;
  onGoQuiz: () => void;
  onOpenQuiz: (quizSet: SavedQuizSet) => void;
  initialTab?: MaterialDetailTab;
  initialTutorQuestion?: string;
  reviewContext?: string;
  reviewTitle?: string;
  relatedMaterials?: CourseMaterial[];
  onSelectRelatedMaterial?: (material: CourseMaterial) => void;
  onTabChange?: (tab: MaterialDetailTab) => void;
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
const getUploadStatusId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const upsertUploadStatus = (statuses: UploadFileStatus[], nextStatus: UploadFileStatus) => {
  const index = statuses.findIndex(status => status.id === nextStatus.id);
  if (index < 0) return [nextStatus, ...statuses].slice(0, 8);
  return statuses.map(status => status.id === nextStatus.id ? { ...status, ...nextStatus } : status);
};
const classifyUploadFailure = (message: string): { kind: UploadFailureKind; label: string; guide: string } => {
  const lower = message.toLowerCase();
  if (message.includes("지원") || lower.includes("unsupported")) {
    return {
      kind: "unsupported",
      label: "지원하지 않는 파일",
      guide: "PDF, PPT/PPTX, 이미지 파일이나 텍스트 붙여넣기로 다시 추가해주세요.",
    };
  }
  if (
    message.includes("너무 큽") || message.includes("10MB") || message.includes("413") ||
    message.includes("50MB") || message.includes("저장 한도") ||
    lower.includes("too large") || lower.includes("maximum allowed size") ||
    lower.includes("exceeded the maximum") || lower.includes("payload too large")
  ) {
    return {
      kind: "tooLarge",
      label: "파일이 너무 큼",
      guide: "파일을 50MB 미만으로 줄이거나 나눠 올리면 원본도 저장됩니다. 지금도 텍스트는 저장돼 요약·퀴즈엔 사용할 수 있어요.",
    };
  }
  if (message.includes("로그인") || message.includes("인증") || message.includes("401") || lower.includes("jwt")) {
    return {
      kind: "auth",
      label: "로그인 만료",
      guide: "다시 로그인한 뒤 같은 파일을 재시도해주세요.",
    };
  }
  if (message.includes("LibreOffice") || message.includes("서버에") || message.includes("설정되지") || lower.includes("converter") || lower.includes("not found")) {
    return {
      kind: "serverTool",
      label: "서버 변환 도구 없음",
      guide: "원본 파일을 보관하고, 가능하면 텍스트 추출 결과나 텍스트 붙여넣기로 이어가세요.",
    };
  }
  if (message.includes("네트워크") || lower.includes("failed to fetch") || lower.includes("network") || message.includes("시간 초과")) {
    return {
      kind: "network",
      label: "네트워크 오류",
      guide: "잠시 후 다시 시도해주세요. 큰 파일이면 페이지 수를 줄이면 성공률이 높아집니다.",
    };
  }
  return {
    kind: "unknown",
    label: "분석 실패",
    guide: "다시 시도하거나 텍스트만 붙여넣어 자료로 추가할 수 있습니다.",
  };
};
const sameMaterialIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

const isInitialRouteEntry = (locationKey: string) => locationKey === "default";

// ── 새로고침/딥링크 화면 복원 ─────────────────────────────────────────────
// 보던 화면을 URL(위치: 과목·단계·자료)과 sessionStorage(세부: 탭·요약식별·선택자료)에
// 나눠 저장해, 새로고침해도 같은 화면으로 되돌린다. URL은 자료 단위 공유·북마크도 가능하게 한다.
const VIEW_TO_URL_TOKEN: Record<SummaryView, string> = {
  upload: "upload",
  materialList: "list",
  templates: "templates",
  summaryResult: "summary",
  quizCreate: "quiz",
  materialDetail: "material",
};
const URL_TOKEN_TO_VIEW: Record<string, SummaryView> = {
  upload: "upload",
  list: "upload",
  templates: "templates",
  summary: "summaryResult",
  quiz: "quizCreate",
  material: "materialDetail",
};

const SUMMARY_VIEW_DETAIL_KEY = "tongkk:summaryViewDetail";
type SummaryViewDetail = {
  tab?: MaterialDetailTab;
  summaryId?: string;
  template?: SummaryTemplate;
  materialIds?: string[];
};
const readSummaryViewDetail = (): SummaryViewDetail => {
  try {
    const raw = sessionStorage.getItem(SUMMARY_VIEW_DETAIL_KEY);
    return raw ? (JSON.parse(raw) as SummaryViewDetail) : {};
  } catch {
    return {};
  }
};
const writeSummaryViewDetail = (detail: SummaryViewDetail) => {
  try {
    sessionStorage.setItem(SUMMARY_VIEW_DETAIL_KEY, JSON.stringify(detail));
  } catch {
    // 세션 저장 실패는 복원 편의 기능일 뿐이므로 조용히 무시한다.
  }
};
const clearSummaryViewDetail = () => {
  try {
    sessionStorage.removeItem(SUMMARY_VIEW_DETAIL_KEY);
  } catch {
    // noop
  }
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

const renderHighlightSyntax = (children: ReactNode): ReactNode => {
  if (typeof children === "string") {
    return children.split(/(§EXAM§[\s\S]*?§\/EXAM§|==[^=]+==|\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)|\*\*[^*]+\*\*)/g).map((part, index) => {
      if (part.startsWith("§EXAM§") && part.endsWith("§/EXAM§")) {
        return (
          <mark key={index} style={{ padding: "1px 6px", borderRadius: 5, background: "#FFF3BF", color: "#222" }}>
            <strong style={{ fontWeight: 800 }}>시험 포인트:</strong> {part.slice(6, -7)}
          </mark>
        );
      }
      if (part.startsWith("==") && part.endsWith("==")) {
        return <mark key={index} style={{ padding: "1px 5px", borderRadius: 5, background: "#FFF0F6", color: "#222", fontWeight: 800 }}>{part.slice(2, -2)}</mark>;
      }
      if (part.match(/^\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)$/)) {
        return <span key={index} style={{ display: "inline-flex", alignItems: "center", marginLeft: 4, padding: "2px 7px", borderRadius: 999, background: "var(--color-tint-cyan)", color: CYAN, fontSize: 11, fontWeight: 850, verticalAlign: "middle" }}>{part.slice(1, -1).replace(/^출처:\s*/, "")}</span>;
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
  list: { margin: "6px 0 14px", paddingLeft: 24, lineHeight: 1.75 } satisfies CSSProperties,
  tableWrap: { overflowX: "auto", margin: "12px 0 16px" } satisfies CSSProperties,
};

const markdownComponents: Components = {
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
  p: ({ children }) => <p style={markdownStyles.paragraph}>{renderHighlightSyntax(children)}</p>,
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
    <th style={{ padding: "9px 12px", background: "var(--color-tint-pink)", color: "var(--color-text-strong)", fontWeight: 800, border: "1px solid #f0c0d0", textAlign: "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td style={{ padding: "8px 12px", border: "1px solid #f0e0e8", color: "var(--color-text)", lineHeight: 1.6 }}>{children}</td>,
};

const cheatSheetMarkdownComponents: Components = {
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
  p: ({ children }) => <p style={{ margin: "0 0 8px", lineHeight: 1.65, color: "var(--color-text)" }}>{renderHighlightSyntax(children)}</p>,
  ul: ({ children }) => <ul style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.65, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.65, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 4, paddingLeft: 3 }}>{renderHighlightSyntax(children)}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "10px 0 14px", breakInside: "avoid" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 0, fontSize: 12 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ padding: "8px 9px", background: "var(--color-tint-pink)", color: "var(--color-text-strong)", fontWeight: 800, border: "1px solid #f0c0d0", textAlign: "left" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td style={{ padding: "7px 9px", border: "1px solid #f0e0e8", color: "var(--color-text)", lineHeight: 1.55, verticalAlign: "top" }}>{children}</td>,
};

const SOURCE_PATTERN = /\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/g;

// 출처 표기 안의 '~'(페이지 범위 표기, 예: p.3~7)를 하이픈으로 바꾼다.
// remark-gfm가 '~...~'를 취소선(<del>)으로 해석하면 출처 문자열이 쪼개져
// 출처 배지가 깨지고 페이지 번호가 줄줄이 합쳐 보이는 문제를 막는다.
const sanitizeCitationTildes = (markdown: string): string =>
  markdown.replace(/\(출처:\s*(?:[^()]*\([^)]*\))*[^()]*\)/g, (m) => m.replace(/~/g, "-"));

// 한 섹션에 흩어진 여러 (출처: ...)를 파일별로 묶어 하나로 합친다. (페이지/슬라이드 중복 제거)
const mergeSourceCitations = (sources: string[]): string => {
  const byFile = new Map<string, string[]>();
  for (const src of sources) {
    const inner = src.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "").trim();
    const commaIdx = inner.indexOf(",");
    const file = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
    const locText = commaIdx === -1 ? "" : inner.slice(commaIdx + 1);
    if (!byFile.has(file)) byFile.set(file, []);
    const locs = byFile.get(file)!;
    locText.split(",").map(s => s.trim()).filter(Boolean).forEach(loc => {
      if (!locs.includes(loc)) locs.push(loc);
    });
  }
  const parts = [...byFile.entries()].map(([file, locs]) => (locs.length ? `${file}, ${locs.join(", ")}` : file));
  return parts.length ? `(출처: ${parts.join("; ")})` : "";
};

// 출처 표기에서 파일명 부분만 떼어낸다. (예: "(출처: a.pdf, p.3)" -> "a.pdf")
const citationFileName = (src: string): string => {
  const inner = src.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "").trim();
  const commaIdx = inner.indexOf(",");
  return (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
};

// 요약 전체가 단일 자료(파일명이 한 종류)일 때는 출처에서 파일명을 떼고
// 위치(p.3 등)만 남긴다. 위치 단서 없이 파일명만 있는 출처는 통째로 제거한다.
// 여러 파일명이 섞여 있으면 어느 자료인지 구분이 필요하므로 그대로 둔다.
const simplifySoleFileSources = (markdown: string): string => {
  const matches = markdown.match(SOURCE_PATTERN) || [];
  if (!matches.length) return markdown;
  const files = new Set(matches.map(citationFileName).filter(Boolean));
  if (files.size > 1) return markdown;

  return markdown.replace(SOURCE_PATTERN, (m) => {
    const inner = m.replace(/^\(출처:\s*/, "").replace(/\)\s*$/, "").trim();
    const commaIdx = inner.indexOf(",");
    const loc = commaIdx === -1 ? "" : inner.slice(commaIdx + 1).trim();
    return loc ? `(출처: ${loc})` : "";
  });
};

// 본문 속 인라인 시험 포인트 "(**시험 포인트:** ...)"를 렌더 토큰으로 변환한다.
// 마크다운 파싱(특히 **굵게**) 전에 적용해야 표시 단계에서 형광펜으로 묶어 렌더할 수 있다.
const markInlineExamPoints = (markdown: string): string =>
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
  for (const raw of sectionLines) {
    const content = raw.replace(/^>\s*/, "").trim();
    if (content.trim() === "") continue;
    const deBullet = content.replace(/^-\s*/, "");
    const isAnswer = /^답\s*:/.test(deBullet);
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
      const labelIdx = answerLines.findIndex(a => /^답\s*:/.test(a));
      const label = labelIdx >= 0 ? answerLines[labelIdx] : "답:";
      const points = answerLines.filter((_, k) => k !== labelIdx);
      // '답:' 라벨 줄에 답 내용이 같은 줄에 붙어 있으면(예: '답: RWM이다') 분리해서
      // '답:'은 라벨로만 두고 내용은 하위 bullet로 내린다. (단답·목록답 모두 같은 카드 형태로 통일)
      const inlineAnswer = label.replace(/^답\s*:\s*/, "").trim();
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

const hoistSourceToHeadings = (markdown: string): string => {
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

const normalizeMarkdownContent = (content: string) => normalizeBoldSpacing(content.replace(/\r\n/g, "\n").trim());

// 드래그 앵커를 기준으로 스크롤을 되돌린다.
// - 본문이 살아 있으면(분할 화면 등) 드래그했던 구절을 처음 보던 화면 위치로 맞춘다.
// - 확대 등으로 본문이 언마운트돼 Range가 떨어져 나갔으면, 드래그 당시 스크롤 위치로 근사 복귀한다.
const restoreScrollToAnchor = (anchor: DragAnchor) => {
  requestAnimationFrame(() => {
    if (anchor.range.startContainer.isConnected) {
      const rect = anchor.range.getBoundingClientRect();
      if (rect.top !== 0 || rect.bottom !== 0) {
        const delta = rect.top - anchor.top;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
        return;
      }
    }
    window.scrollTo({ top: anchor.scrollY });
  });
};

// 요약 본문을 감싸 드래그 선택 시 "AI 튜터에게 묻기" 플로팅 버튼을 띄운다.
// 버튼 클릭 시 선택 텍스트를 onAsk로 넘긴다.
const SelectionAskButton = ({ children, onAsk }: { children: ReactNode; onAsk: (text: string, anchor: DragAnchor | null) => void }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);

  const captureSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const wrap = wrapRef.current;
    if (!text || !sel || sel.rangeCount === 0 || !wrap) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!wrap.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    setSelection({
      text,
      top: rect.top - wrapRect.top,
      left: Math.min(Math.max(rect.left - wrapRect.left + rect.width / 2, 70), wrapRect.width - 70),
    });
  };

  // 본문 밖을 클릭하면 버튼을 숨긴다(버튼 자체 클릭은 stopPropagation으로 제외).
  useEffect(() => {
    const clear = () => setSelection(null);
    document.addEventListener("mousedown", clear);
    return () => document.removeEventListener("mousedown", clear);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "relative" }} onMouseUp={captureSelection}>
      {children}
      {selection && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onMouseUp={e => e.stopPropagation()}
          onClick={() => {
            // 튜터가 열리면 요약 칸 폭이 줄어드는 reflow가 일어난다.
            // 선택 영역의 화면상 위치를 기록해 두고, reflow 후 같은 위치를 유지하도록 스크롤을 보정한다.
            const sel = window.getSelection();
            const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
            const anchorTop = range ? range.getBoundingClientRect().top : null;
            onAsk(selection.text, range && anchorTop != null ? { range, top: anchorTop, scrollY: window.scrollY } : null);
            setSelection(null);
            sel?.removeAllRanges();
            if (range && anchorTop != null) {
              requestAnimationFrame(() => {
                const delta = range.getBoundingClientRect().top - anchorTop;
                if (Math.abs(delta) > 1) window.scrollBy(0, delta);
              });
            }
          }}
          style={{
            position: "absolute",
            top: selection.top,
            left: selection.left,
            transform: "translate(-50%, calc(-100% - 8px))",
            zIndex: 50,
            padding: "7px 12px",
            borderRadius: 999,
            border: "none",
            background: PINK,
            color: "var(--color-on-brand)",
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
            cursor: "pointer",
          }}
        >
          AI 튜터에게 묻기
        </button>
      )}
    </div>
  );
};

const FormattedAiText = ({ content, template }: { content: string; template?: SummaryTemplate }) => {
  const normalized = markInlineExamPoints(normalizeMarkdownContent(content));
  const hoisted = template && template !== "MINDMAP" ? hoistSourceToHeadings(normalized) : normalized;
  const cleaned = simplifySoleFileSources(hoisted);
  if (!cleaned) return null;

  if (template === "CHEAT_SHEET") {
    return (
      <div style={{
        columnCount: 2,
        columnWidth: 420,
        columnGap: 34,
        columnRule: "1px solid var(--color-border-soft)",
      }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={cheatSheetMarkdownComponents}>
          {cleaned}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {cleaned}
    </ReactMarkdown>
  );
};

// 요약 내용 렌더: MINDMAP은 JSON을 파싱해 시각화하고, 그 외 템플릿은 마크다운으로 렌더한다.
const SummaryContentView = ({ content, template }: { content: string; template?: SummaryTemplate }) => {
  const mindmap = template === "MINDMAP" ? parseMindmapJson(content) : null;
  return mindmap
    ? <MindmapView data={mindmap} />
    : <FormattedAiText content={content} template={template} />;
};

const TemplateSelectView = ({ onSelect, onBack, pageHint }: TemplateSelectViewProps) => {
  const [pageRange, setPageRange] = useState("");
  const [focusPrompt, setFocusPrompt] = useState("");
  const templates: Array<{ key: SummaryTemplate; name: string; desc: string; accent: string }> = [
    { key: "GENERAL", name: "일반 요약", desc: "강의 자료 내용을 깔끔하게 정리", accent: "#555" },
    { key: "LECTURE_NOTE", name: "강의 노트", desc: "개념, 흐름, 시험 포인트를 구조화", accent: PINK },
    { key: "MINDMAP", name: "마인드맵", desc: "중심 주제와 하위 개념의 관계를 구조화", accent: CYAN },
    { key: "CHEAT_SHEET", name: "치트시트", desc: "시험 직전 빠르게 보는 암기표", accent: "#7C3AED" },
  ];

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "var(--color-text-strong)" }}>출력 템플릿 선택</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>반영할 범위와 집중할 내용을 정한 뒤, 요약 형식을 선택하세요</p>
      </div>

      <div style={{ display: "grid", gap: 14, marginBottom: 24, maxWidth: 720 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 800, color: "var(--color-text)" }}>
            반영할 페이지 <span style={{ fontWeight: 600, color: "var(--color-muted)" }}>(선택 · 비우면 전체)</span>
          </label>
          <input
            value={pageRange}
            onChange={e => setPageRange(e.target.value)}
            placeholder={pageHint ? `예: 1-5, 8  (${pageHint})` : "예: 1-5, 8"}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)" }}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 800, color: "var(--color-text)" }}>
            집중할 내용 <span style={{ fontWeight: 600, color: "var(--color-muted)" }}>(선택)</span>
          </label>
          <textarea
            value={focusPrompt}
            onChange={e => setFocusPrompt(e.target.value)}
            placeholder="예: 시험에 나올 핵심 정의와 공식 위주로 정리해줘"
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {templates.map(t => (
          <Card key={t.key} style={{ padding: 0, overflow: "hidden" }}>
            <button onClick={() => onSelect(t.key, { pageRange, focusPrompt })} style={{
              width: "100%",
              minHeight: 190,
              padding: 24,
              border: "none",
              background: "var(--color-card)",
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}>
              <div>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: t.accent, marginBottom: 18 }} />
                <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: "var(--color-text-strong)" }}>{t.name}</h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{t.desc}</p>
              </div>
              <span style={{ marginTop: 20, fontSize: 13, fontWeight: 700, color: t.accent }}>선택하기</span>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
};

const SummaryResultView = ({ template, onBack, backLabel, contextTitle, realContent, isLoading, error, loadingStep, elapsedTime, threadId, summaryId, resetTutorHistory = false, initialTutorQuestion, onGoToQuiz }: SummaryResultViewProps) => {
  const data = summaryData[template];
  const displayContent = realContent || data.content;
  const mindmapData = template === "MINDMAP" && displayContent ? parseMindmapJson(displayContent) : null;
  const [actionMessage, setActionMessage] = useState("");
  const [pdfSaving, setPdfSaving] = useState(false);
  const [showPrintGuide, setShowPrintGuide] = useState(false);
  const [isTutorOpen, setIsTutorOpen] = useState(Boolean(initialTutorQuestion?.trim()));
  // 확대 시 요약 본문 칸을 숨기고 튜터가 그 영역을 꽉 채운다.
  const [isResultExpanded, setIsResultExpanded] = useState(false);
  const [tutorSelectionQuestion, setTutorSelectionQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const pdfExportRef = useRef<HTMLDivElement | null>(null);
  // 드래그해서 질문한 본문 구절의 위치. 튜터를 닫을 때 그 자리로 스크롤을 되돌린다.
  const dragAnchorRef = useRef<DragAnchor | null>(null);

  const askTutorWithSelection = (text: string, anchor: DragAnchor | null) => {
    dragAnchorRef.current = anchor;
    setIsTutorOpen(true);
    setTutorSelectionQuestion(prev => ({ text: `다음 내용을 설명해줘:\n${text}`, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  // 튜터를 닫으면 그리드가 2열→1열로 reflow된다. 드래그했던 구절을 처음 보던 화면 위치로 되돌린다.
  const handleTutorOpenChange = (next: boolean) => {
    setIsTutorOpen(next);
    if (!next) setIsResultExpanded(false); // 닫으면 확대 상태도 해제(본문이 숨겨진 빈 화면 방지).
    if (!next) setTutorSelectionQuestion(null); // 닫으면 대기 중인 선택 질문을 비워 재오픈 시 자동 채움을 막는다.
    const anchor = dragAnchorRef.current;
    if (next || !anchor) return;
    dragAnchorRef.current = null;
    restoreScrollToAnchor(anchor);
  };
  const questions = suggestedTutorQuestions[template];

  // 복사 텍스트도 화면과 동일하게 정제: 본문 인라인 (출처:...)는 제거하고 헤딩 출처만 남긴다.
  const exportContent = template === "MINDMAP"
    ? displayContent
    : simplifySoleFileSources(hoistSourceToHeadings(normalizeMarkdownContent(displayContent)));
  const exportText = `${templateLabels[template]} 요약\n\n${exportContent}`;

  useEffect(() => {
    if (initialTutorQuestion?.trim()) setIsTutorOpen(true);
  }, [initialTutorQuestion]);

  // 실제 인쇄(→ PDF 저장) 실행. 안내 팝업에서 '계속'을 누르면 호출된다.
  const runPrint = () => {
    setShowPrintGuide(false);
    const prevTitle = document.title;
    document.title = `tongkk-${template.toLowerCase()}-summary`;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    setActionMessage("인쇄 창에서 '대상'을 'PDF로 저장'으로 선택하세요.");
    window.print();
  };

  const handleDownload = async () => {
    if (pdfSaving) return;

    // 텍스트 요약: 브라우저 인쇄로 PDF 저장 (인쇄창 → '대상'을 'PDF로 저장' 선택)
    // 화면 렌더링을 그대로 인쇄하므로 글자 선택이 가능한 텍스트 PDF가 나온다.
    // 바로 인쇄창을 띄우면 사용자가 당황하므로, 먼저 이유를 안내하는 팝업을 보여준다.
    if (!mindmapData) {
      setShowPrintGuide(true);
      return;
    }

    // 마인드맵은 시각화라 인쇄 대신 기존 이미지 캡처(PDF) 방식 유지
    if (!pdfExportRef.current) return;

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
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pdf-print-area, .pdf-print-area * { visibility: visible !important; }
          .pdf-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            z-index: auto !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
      {showPrintGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PDF 저장 안내"
          onClick={() => setShowPrintGuide(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "min(440px, 100%)", background: "var(--color-card)", borderRadius: 20, padding: "32px 30px",
            boxShadow: "0 18px 50px rgba(0,0,0,0.22)", border: "1px solid var(--color-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "var(--color-tint-cyan)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
              }}>📄</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text-strong)" }}>PDF로 저장하기</h3>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.8, color: "var(--color-text)", wordBreak: "keep-all" }}>
              <b style={{ color: CYAN }}>계속</b>을 누르면 <b style={{ color: "var(--color-text-strong)" }}>인쇄 창</b>이 열립니다.<br />
              프린터 대신 <b style={{ color: "var(--color-text-strong)" }}>PDF로 저장</b>을 선택하면 돼요.
            </p>
            <div style={{
              margin: "0 0 24px", padding: "16px 16px", borderRadius: 12, background: "var(--color-page)",
              fontSize: 13, lineHeight: 1.8, color: "var(--color-text-secondary)", wordBreak: "keep-all",
              display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <span style={{ flexShrink: 0 }}>💡</span>
              <span>
                저장된 PDF는 이미지가 아니라 문서 형태라서,<br />
                <b style={{ color: "var(--color-text-strong)" }}>텍스트 선택과 복사</b>가 가능해요.
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowPrintGuide(false)}
                style={{
                  padding: "9px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >취소</button>
              <button
                type="button"
                onClick={runPrint}
                style={{
                  padding: "9px 22px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}
              >계속</button>
            </div>
          </div>
        </div>
      )}
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>{backLabel}</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{
              padding: "9px 18px", borderRadius: 999, border: "2px solid var(--color-border-soft)",
              background: "var(--color-card)", fontSize: 17, fontWeight: 600, flex: "0 0 auto",
              color: template === "GENERAL" ? "#555" : template === "LECTURE_NOTE" ? PINK : template === "MINDMAP" ? CYAN : "#7C3AED"
            }}>{templateLabels[template]}</span>
            {isLoading && (
              <span style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 700 }}>
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
                padding: "6px 10px", borderRadius: 999, background: "var(--color-surface)",
                color: "var(--color-muted)", fontSize: 12, fontWeight: 700
              }}>{elapsedTime}초</span>
            )}
            {!isLoading && (
              <>
                <button onClick={handleCopyAll} style={{
                  height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 13, fontWeight: 700, cursor: "pointer"
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
                    background: PINK, color: "var(--color-on-brand)", fontSize: 13, fontWeight: 700, cursor: "pointer"
                  }}>퀴즈 생성하기</button>
                )}
                <button onClick={() => handleTutorOpenChange(!isTutorOpen)} style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: isTutorOpen ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : "1px solid var(--color-border-soft)",
                  background: isTutorOpen ? "var(--color-tint-pink)" : "var(--color-card)",
                  color: isTutorOpen ? PINK : "var(--color-text)",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}>{isTutorOpen ? "튜터 닫기" : "AI 튜터"}</button>
              </>
            )}
          </div>
        </div>
        {actionMessage && !isLoading && (
          <div style={{ margin: "-6px 0 16px", fontSize: 12, color: "var(--color-muted)", textAlign: "right" }}>
            {actionMessage}
          </div>
        )}
        {!isLoading && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, borderBottom: "1px solid var(--color-border-soft)" }}>
            <button type="button" style={{
              padding: "10px 4px 12px",
              border: "none",
              borderBottom: `2px solid ${PINK}`,
              background: "transparent",
              color: "var(--color-text-strong)",
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
                color: "var(--color-muted)",
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
            className="pdf-print-area"
            data-theme="light"
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
              // 인쇄(PDF)도 화면과 동일하게 보이도록 웹과 같은 렌더러를 사용한다.
              // (이전 PdfFormattedAiText는 출처를 가공하지 않아 문장 끝마다 출처가 노출됐다.)
              <FormattedAiText content={displayContent} template={template} />
            )}
          </div>
        )}

        {isLoading ? (
          <div style={{
            background: "var(--color-surface)", borderRadius: 12, padding: 48,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16
          }}>
            <div style={{
              width: 36, height: 36,
              border: `3px solid ${PINK}`, borderTop: "3px solid transparent",
              borderRadius: "50%", animation: "spin 0.8s linear infinite"
            }}/>
            <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)" }}>
              {loadingStep || "처리 중..."}
            </p>
          </div>
        ) : error ? (
          <div style={{
            background: "var(--color-tint-pink)", borderRadius: 12, padding: 24,
            fontSize: 14, color: "var(--color-danger)", lineHeight: 1.6
          }}>
            <strong>요약 실패:</strong> {error}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: isResultExpanded ? "minmax(0, 1fr)" : isTutorOpen ? "minmax(0, 1fr) 400px" : "minmax(0, 1fr)",
            gap: isTutorOpen && !isResultExpanded ? 12 : 0,
            alignItems: "stretch",
          }}>
            {!isResultExpanded && (
              <div style={{
                background: "var(--color-card)", borderRadius: 12, padding: 28,
                border: "1px solid var(--color-border-soft)",
                fontSize: 15, color: "var(--color-text)", lineHeight: 1.85,
                overflowX: "auto",
                minWidth: 0,
              }}>
                {mindmapData ? (
                  <MindmapView key={displayContent} data={mindmapData} />
                ) : (
                  <SelectionAskButton onAsk={askTutorWithSelection}>
                    <FormattedAiText content={displayContent} template={template} />
                  </SelectionAskButton>
                )}
              </div>
            )}

            {isTutorOpen && (
              <AITutorDrawer
                layout="embedded"
                open={isTutorOpen}
                onOpenChange={handleTutorOpenChange}
                expanded={isResultExpanded}
                onExpandedChange={setIsResultExpanded}
                contextTitle={contextTitle}
                contextMarkdown={realContent}
                summaryId={summaryId}
                threadId={threadId}
                suggestedQuestions={questions}
                initialQuestion={!isLoading ? initialTutorQuestion : undefined}
                pendingQuestion={tutorSelectionQuestion ?? undefined}
                disabledReason="요약 생성 후 AI 튜터를 사용할 수 있습니다"
                resetHistory={resetTutorHistory}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

// 요약 결과의 전체 복사 / PDF 다운로드 / 퀴즈 생성하기 버튼 묶음.
// 자세히 보기 페이지(SummaryResultView)와 동일한 동작을, 자료 상세의 요약 탭에서 바로 쓰도록 분리했다.
// 숨김 export 노드(.pdf-print-area)·인쇄 CSS·안내 모달을 자체적으로 포함하므로, 버튼 줄 안에 그대로 넣으면 된다.
const SummaryActions = ({ template, content, onGoToQuiz }: { template: SummaryTemplate; content: string; onGoToQuiz?: () => void }) => {
  const { showToast } = useToast();
  const [pdfSaving, setPdfSaving] = useState(false);
  const [showPrintGuide, setShowPrintGuide] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement | null>(null);
  const mindmapData = template === "MINDMAP" && content ? parseMindmapJson(content) : null;
  // 복사 텍스트도 화면과 동일하게 정제: 본문 인라인 (출처:...)는 제거하고 헤딩 출처만 남긴다.
  const exportContent = template === "MINDMAP"
    ? content
    : simplifySoleFileSources(hoistSourceToHeadings(normalizeMarkdownContent(content)));
  const exportText = `${templateLabels[template]} 요약\n\n${exportContent}`;

  // 실제 인쇄(→ PDF 저장) 실행. 안내 팝업에서 '계속'을 누르면 호출된다.
  const runPrint = () => {
    setShowPrintGuide(false);
    const prevTitle = document.title;
    document.title = `tongkk-${template.toLowerCase()}-summary`;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    showToast("인쇄 창에서 '대상'을 'PDF로 저장'으로 선택하세요.", "info");
    window.print();
  };

  const handleDownload = async () => {
    if (pdfSaving) return;
    // 텍스트 요약: 브라우저 인쇄로 PDF 저장(텍스트 선택 가능). 마인드맵: 이미지 캡처(PDF).
    if (!mindmapData) {
      setShowPrintGuide(true);
      return;
    }
    if (!pdfExportRef.current) return;
    setPdfSaving(true);
    try {
      await document.fonts.ready;
      const exportNode = pdfExportRef.current;
      if (!exportNode) return;
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
      showToast("PDF를 다운로드했습니다.", "success");
    } catch {
      document.querySelectorAll<HTMLElement>('[data-pdf-backdrop]').forEach(el => el.remove());
      if (pdfExportRef.current) {
        pdfExportRef.current.style.left = "-10000px";
        pdfExportRef.current.style.zIndex = "-1";
        pdfExportRef.current.style.letterSpacing = "";
      }
      showToast("PDF 다운로드에 실패했습니다.", "error");
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
    try {
      await copySummaryToClipboard();
      showToast("요약본 전체를 클립보드에 복사했습니다.", "success");
    } catch {
      showToast("전체 복사에 실패했습니다.", "error");
    }
  };

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .pdf-print-area, .pdf-print-area * { visibility: visible !important; }
          .pdf-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            z-index: auto !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
      {showPrintGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PDF 저장 안내"
          onClick={() => setShowPrintGuide(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "min(440px, 100%)", background: "var(--color-card)", borderRadius: 20, padding: "32px 30px",
            boxShadow: "0 18px 50px rgba(0,0,0,0.22)", border: "1px solid var(--color-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "var(--color-tint-cyan)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
              }}>📄</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text-strong)" }}>PDF로 저장하기</h3>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.8, color: "var(--color-text)", wordBreak: "keep-all" }}>
              <b style={{ color: CYAN }}>계속</b>을 누르면 <b style={{ color: "var(--color-text-strong)" }}>인쇄 창</b>이 열립니다.<br />
              프린터 대신 <b style={{ color: "var(--color-text-strong)" }}>PDF로 저장</b>을 선택하면 돼요.
            </p>
            <div style={{
              margin: "0 0 24px", padding: "16px 16px", borderRadius: 12, background: "var(--color-page)",
              fontSize: 13, lineHeight: 1.8, color: "var(--color-text-secondary)", wordBreak: "keep-all",
              display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <span style={{ flexShrink: 0 }}>💡</span>
              <span>
                저장된 PDF는 이미지가 아니라 문서 형태라서,<br />
                <b style={{ color: "var(--color-text-strong)" }}>텍스트 선택과 복사</b>가 가능해요.
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowPrintGuide(false)}
                style={{
                  padding: "9px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  background: "var(--color-card)", color: "var(--color-text)", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >취소</button>
              <button
                type="button"
                onClick={runPrint}
                style={{
                  padding: "9px 22px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}
              >계속</button>
            </div>
          </div>
        </div>
      )}
      <button onClick={handleCopyAll} style={{
        padding: "9px 12px", borderRadius: 8, border: `1px solid ${BORDER_COLOR}`,
        background: "var(--color-card)", color: "var(--color-text)", fontSize: 12, fontWeight: 800, cursor: "pointer",
      }}>전체 복사</button>
      <button onClick={handleDownload} disabled={pdfSaving} style={{
        padding: "9px 12px", borderRadius: 8, border: "none",
        background: pdfSaving ? "#d9f5f9" : "#70dff0",
        color: "#555", fontSize: 12, fontWeight: 800,
        cursor: pdfSaving ? "default" : "pointer",
        opacity: pdfSaving ? 0.75 : 1,
      }}>{pdfSaving ? "PDF 생성 중" : "PDF 다운로드"}</button>
      {onGoToQuiz && (
        <button onClick={onGoToQuiz} style={{
          padding: "9px 12px", borderRadius: 8, border: "none",
          background: PINK, color: "var(--color-on-brand)", fontSize: 12, fontWeight: 800, cursor: "pointer",
        }}>퀴즈 생성하기</button>
      )}
      <div
        ref={pdfExportRef}
        className="pdf-print-area"
        data-theme="light"
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
          <MindmapView key={`pdf-${content}`} data={mindmapData} />
        ) : (
          <FormattedAiText content={content} template={template} />
        )}
      </div>
    </>
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

// 요약 본문과 AI 튜터가 나란히 차지하는 분할 영역의 높이.
// 카드를 뷰포트에 고정하지 않으므로 이 영역만 내부 스크롤되고, 위쪽 머리말/탭은
// 페이지와 함께 바깥 스크롤된다(전체 화면이 같이 내려가는 느낌).
const SPLIT_ROW_HEIGHT = "calc(100vh - 180px)";
const SPLIT_ROW_MIN_HEIGHT = 440;
const TUTOR_SPLIT_STORAGE_KEY = "tongkk:summaryTutorSplit";

// 요약 ↔ AI 튜터의 가로 점유 비율을 드래그로 조절하고 localStorage에 기억한다.
// ratio는 왼쪽(요약/원본)이 차지하는 비율(0~1). 분할 컨테이너에 containerRef를 달아야 한다.
const useTutorSplit = (initial = 0.62) => {
  const [ratio, setRatio] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(TUTOR_SPLIT_STORAGE_KEY));
      return saved >= 0.3 && saved <= 0.8 ? saved : initial;
    } catch {
      return initial;
    }
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const minLeft = Math.min(0.7, 320 / rect.width);
      const minRight = Math.min(0.7, 360 / rect.width);
      let next = (moveEvent.clientX - rect.left) / rect.width;
      next = Math.max(minLeft, Math.min(1 - minRight, next));
      ratioRef.current = next;
      setRatio(next);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      try {
        localStorage.setItem(TUTOR_SPLIT_STORAGE_KEY, String(ratioRef.current));
      } catch {
        // 비율 저장 실패는 편의 기능이라 조용히 무시한다.
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return { ratio, containerRef, startDrag };
};

// 요약/원본과 AI 튜터 사이의 드래그 구분선. 가운데 알약 핸들에 호버 강조를 준다.
const TutorSplitDivider = ({ onPointerDown }: { onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="드래그해서 요약과 AI 튜터 비율을 조절하세요"
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: "0 0 16px",
        alignSelf: "stretch",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "col-resize",
        touchAction: "none",
      }}
    >
      <div style={{
        width: hover ? 6 : 4,
        height: 52,
        borderRadius: 999,
        background: hover ? PINK : "#d4d4d4",
        transition: "background 0.15s ease, width 0.15s ease",
      }} />
    </div>
  );
};

const MaterialDetailView = ({
  material,
  selectedCourse,
  onBack,
  onGoSummary,
  onGoQuiz,
  onOpenQuiz,
  initialTab = "original",
  initialTutorQuestion = "",
  reviewContext = "",
  reviewTitle = "",
  relatedMaterials = [],
  onSelectRelatedMaterial,
  onTabChange,
}: MaterialDetailViewProps) => {
  const [activeTab, setActiveTab] = useState<MaterialDetailTab>(initialTab);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState("");
  const [activeSummaryId, setActiveSummaryId] = useState<string>("");
  const [tutorPrompt, setTutorPrompt] = useState(initialTutorQuestion);
  const [isOriginalTutorOpen, setIsOriginalTutorOpen] = useState(false);
  const [isSummaryTutorOpen, setIsSummaryTutorOpen] = useState(Boolean(initialTutorQuestion.trim() && initialTab === "summary"));
  // 확대 시 본문 칸을 숨기고 튜터가 그 영역을 꽉 채운다.
  const [isOriginalTutorExpanded, setIsOriginalTutorExpanded] = useState(false);
  const [isSummaryTutorExpanded, setIsSummaryTutorExpanded] = useState(false);
  const [tutorSelectionQuestion, setTutorSelectionQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const [showSummaryList, setShowSummaryList] = useState(false);
  const lowerMaterialName = material.name.toLowerCase();
  // 드래그해서 질문한 본문 구절의 위치. 튜터를 닫을 때 그 자리로 스크롤을 되돌린다.
  const dragAnchorRef = useRef<DragAnchor | null>(null);
  // 요약/원본 ↔ AI 튜터 가로 분할 비율(드래그 조절, localStorage 기억).
  const tutorSplit = useTutorSplit();

  const askSummaryTutorWithSelection = (text: string, anchor: DragAnchor | null) => {
    dragAnchorRef.current = anchor;
    setIsSummaryTutorOpen(true);
    setTutorSelectionQuestion(prev => ({ text: `다음 내용을 설명해줘:\n${text}`, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  // 튜터를 닫으면 그리드가 reflow된다. 드래그했던 구절을 처음 보던 화면 위치로 되돌린다.
  const handleSummaryTutorOpenChange = (next: boolean) => {
    setIsSummaryTutorOpen(next);
    if (!next) setIsSummaryTutorExpanded(false); // 닫으면 확대 상태도 해제(본문이 숨겨진 빈 화면 방지).
    if (!next) setTutorSelectionQuestion(null); // 닫으면 대기 중인 선택 질문을 비워 재오픈 시 자동 채움을 막는다.
    const anchor = dragAnchorRef.current;
    if (next || !anchor) return;
    dragAnchorRef.current = null;
    restoreScrollToAnchor(anchor);
  };
  const isPdf = material.type === "pdf" || material.mimeType === "application/pdf" || lowerMaterialName.endsWith(".pdf");
  const isPptx = material.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || lowerMaterialName.endsWith(".pptx");
  const isLegacyPpt = lowerMaterialName.endsWith(".ppt");
  const isPresentation = material.type === "ppt" || isPptx || isLegacyPpt;
  const hasReviewContext = Boolean(reviewContext.trim());
  const fileTypeLabel = material.type === "pdf" ? "PDF" : material.type === "ppt" ? "PPT" : material.type === "img" ? "이미지" : "자료";
  const pageInfo = material.pages ? `${material.pages}페이지` : material.slides ? `${material.slides}슬라이드` : "페이지 정보 없음";
  const previewFailure = previewError ? classifyUploadFailure(previewError) : null;

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
    let ignore = false;
    let objectUrl = "";

    setPreviewPdfUrl(null);
    setPreviewError("");

    if (!fileUrl || !isPresentation) {
      setPreviewLoading(false);
      return () => {
        ignore = true;
      };
    }

    setPreviewLoading(true);
    createPdfPreviewFromUrl(fileUrl, material.name)
      .then(url => {
        objectUrl = url;
        if (!ignore) {
          setPreviewPdfUrl(url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch(err => {
        if (!ignore) setPreviewError(err instanceof Error ? err.message : "PPT/PPTX 미리보기 변환에 실패했습니다.");
      })
      .finally(() => {
        if (!ignore) setPreviewLoading(false);
      });

    return () => {
      ignore = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl, isPresentation, material.id, material.name]);

  useEffect(() => {
    setActiveTab(initialTab);
    setTutorPrompt(initialTutorQuestion);
    setIsOriginalTutorOpen(false);
    setIsSummaryTutorOpen(Boolean(initialTutorQuestion.trim() && initialTab === "summary"));
    setIsOriginalTutorExpanded(false);
    setIsSummaryTutorExpanded(false);
  }, [material.id, initialTab, initialTutorQuestion]);

  // 사용자가 탭을 바꾸면 부모에 알려 현재 탭을 세션에 저장하게 한다(새로고침 복원용).
  useEffect(() => {
    onTabChange?.(activeTab);
  }, [activeTab, onTabChange]);

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
  const latestAttemptByQuizSetId = quizAttempts.reduce<Map<string, SavedQuizAttempt>>((map, attempt) => {
    if (attempt.quizSetId && !map.has(attempt.quizSetId)) map.set(attempt.quizSetId, attempt);
    return map;
  }, new Map());
  const hasSummaries = summaries.length > 0;
  const hasQuizSets = quizSets.length > 0;
  const hasLowRecentScore = Boolean(recentQuizAttempt && recentQuizAttempt.scorePercent < LOW_QUIZ_SCORE_THRESHOLD);
  const tutorContextMarkdown = activeSummary?.content || "";
  const reviewTutorSection = hasReviewContext
    ? `# ${reviewTitle || "이번 퀴즈 오답 복습"}\n\n${reviewContext.trim()}`
    : "";
  const combinedTutorContextMarkdown = [tutorContextMarkdown, reviewTutorSection].filter(Boolean).join("\n\n---\n\n");
  const tutorContextTitle = activeSummary
    ? `${material.name} · ${templateLabels[activeSummary.template]}`
    : `${material.name} · 요약 없음`;
  const tutorSuggestions = activeSummary ? suggestedTutorQuestions[activeSummary.template] : suggestedTutorQuestions.GENERAL;
  const materialProgressSteps = [
    { label: "자료 업로드 완료", done: true, current: false },
    { label: hasSummaries ? "요약 완료" : "요약 생성 필요", done: hasSummaries, current: !hasSummaries },
    { label: hasQuizSets ? "퀴즈 준비됨" : "퀴즈 생성 필요", done: hasQuizSets, current: hasSummaries && !hasQuizSets },
    {
      label: recentQuizAttempt ? (hasLowRecentScore ? "오답 복습 대기" : "복습 완료") : "복습 대기",
      done: Boolean(recentQuizAttempt && !hasLowRecentScore),
      current: Boolean(hasQuizSets && (!recentQuizAttempt || hasLowRecentScore)),
    },
  ];

  const tabButtonStyle = (tab: MaterialDetailTab): CSSProperties => ({
    height: 34,
    borderRadius: 10,
    border: activeTab === tab ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
    background: activeTab === tab ? "var(--color-tint-pink)" : "var(--color-card)",
    color: activeTab === tab ? PINK : "var(--color-text-secondary)",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  });
  const multiSourceBadge = (materialIds: string[] = []) => materialIds.length > 1 && (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 8px",
      borderRadius: 999,
      background: "var(--color-tint-cyan)",
      color: CYAN,
      fontSize: 11,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}>
      여러 자료를 함께 사용함
    </span>
  );

  const renderOriginalTab = () => {
    if (fileLoading || previewLoading) {
      return (
        <div style={{ height: "100%", minHeight: 0, display: "grid", placeItems: "center", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: 14 }}>
          {previewLoading ? "PPT/PPTX 미리보기를 PDF로 변환하는 중입니다." : "원본 파일을 불러오는 중입니다."}
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
            height: "100%",
            minHeight: 0,
            border: "none",
            background: "var(--color-surface)",
            display: "block",
          }}
        />
      );
    }

    if (previewPdfUrl) {
      return (
        <iframe
          title={`${material.name} PDF preview`}
          src={`${previewPdfUrl}#toolbar=1&navpanes=0`}
          style={{
            width: "100%",
            height: "100%",
            minHeight: 0,
            border: "none",
            background: "var(--color-surface)",
            display: "block",
          }}
        />
      );
    }

    // 원본이 없는 이유 구분: 50MB 한도 초과면 그에 맞는 안내, 그 외(원본 저장 기능 추가 전 업로드 등)는 기존 안내.
    const originalSize = material.size;
    const noOriginalMessage =
      !material.filePath && originalSize != null && originalSize > MAX_ORIGINAL_FILE_BYTES
        ? `이 자료는 원본이 ${(originalSize / (1024 * 1024)).toFixed(1)}MB로 저장 한도(50MB)를 넘어 원본을 저장하지 않았어요. 텍스트는 저장돼 요약·퀴즈에 그대로 사용할 수 있어요.`
        : "이 자료는 원본 PDF 저장 기능 추가 전에 업로드되어 원본 파일이 없습니다. 같은 PDF를 다시 업로드하면 다음부터 PDF 뷰어로 열립니다.";

    return (
      <div style={{
        background: "var(--color-surface)",
        padding: 24,
        fontSize: 14,
        color: "var(--color-text)",
        lineHeight: 1.8,
        height: "100%",
        overflowY: "auto",
        boxSizing: "border-box",
      }}>
        <div style={{
          marginBottom: 18,
          padding: "12px 14px",
          borderRadius: 10,
          background: fileError || previewError ? "var(--color-tint-pink)" : "#FFF8E8",
          color: fileError || previewError ? "var(--color-danger)" : "#9A6B00",
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.55,
        }}>
          {previewFailure ? `${previewFailure.label}: ${previewError} 아래에 텍스트 추출 결과를 대신 보여드릴게요.` : fileError || (isPresentation
            ? (isLegacyPpt
              ? "PPT 원본 미리보기를 준비하지 못했습니다. 서버에 LibreOffice가 설치되어 있으면 PDF 미리보기로 변환해 볼 수 있습니다."
              : "PPTX 원본 미리보기를 준비하지 못했습니다. 서버에 LibreOffice가 설치되어 있으면 PDF 미리보기로 변환해 볼 수 있습니다.")
            : noOriginalMessage)}
        </div>
        {fileUrl && isPresentation && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", marginBottom: 16, color: CYAN, fontSize: 13, fontWeight: 800, textDecoration: "none" }}
          >
            원본 PPT/PPTX 열기
          </a>
        )}
        {material.filePath && (
          <FormattedAiText content={material.markdown || "표시할 변환 내용이 없습니다."} />
        )}
      </div>
    );
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 과목 자료로</button>
      <Card style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{
          flexShrink: 0,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          overflow: "hidden",
        }}>
        <div style={{
          padding: "9px 18px",
          borderBottom: "1px solid var(--color-border-soft)",
          background: "var(--color-surface)",
          color: "var(--color-text-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)", wordBreak: "break-word" }}>
              {material.name}
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: "var(--color-text-secondary)" }}>
              <span>{fileTypeLabel}</span>
              <span>{pageInfo}</span>
              <span>업데이트 {formatHubDate(material.updatedAt)}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {materialProgressSteps.map((step, index) => {
                const color = step.done ? "var(--color-muted)" : step.current ? PINK : "var(--color-muted)";
                const connectorFilled = index > 0 && materialProgressSteps[index - 1].done;
                return (
                  <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
                    {index > 0 && (
                      <div style={{ width: 18, height: 2, background: connectorFilled ? "var(--color-muted)" : "var(--color-border-soft)" }} />
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        flexShrink: 0,
                        border: `2px solid ${color}`,
                        background: step.done ? "var(--color-muted)" : step.current ? PINK : "var(--color-card)",
                        color: step.done || step.current ? "var(--color-on-brand)" : "var(--color-muted)",
                        fontSize: 10,
                        fontWeight: 900,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        {step.done ? "✓" : index + 1}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, color, whiteSpace: "nowrap" }}>
                        {step.label}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
          {relatedMaterials.length > 1 && (
            <div style={{ padding: "0 18px 12px", background: "var(--color-card)" }}>
              <div style={{
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${BORDER_COLOR}`,
                background: "var(--color-card)",
              }}>
                <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 850, color: "var(--color-muted)" }}>
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
                          border: isActive ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                          background: isActive ? "var(--color-tint-pink)" : "var(--color-surface)",
                          color: isActive ? PINK : "var(--color-text-secondary)",
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
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          zIndex: 20,
          background: "var(--color-card)",
          padding: "10px 18px",
          borderBottom: "1px solid var(--color-border-soft)",
        }}>
          {hasSummaries && activeTab !== "quiz" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
              {activeTab === "summary" && (
                <button
                  type="button"
                  onClick={() => setShowSummaryList(prev => !prev)}
                  aria-label={showSummaryList ? "요약 목록 닫기" : "요약 목록 열기"}
                  title={showSummaryList ? "요약 목록 닫기" : "요약 목록 열기"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginRight: "auto",
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: showSummaryList ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                    background: showSummaryList ? "var(--color-tint-pink)" : "var(--color-card)",
                    color: showSummaryList ? PINK : "var(--color-text)",
                    fontSize: 16,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ☰
                </button>
              )}
              {activeTab === "original" && (
                <button type="button" onClick={() => { const next = !isOriginalTutorOpen; setIsOriginalTutorOpen(next); if (!next) setIsOriginalTutorExpanded(false); }} style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: isOriginalTutorOpen ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                  background: isOriginalTutorOpen ? "var(--color-tint-pink)" : "var(--color-card)",
                  color: isOriginalTutorOpen ? PINK : "var(--color-text)",
                  fontSize: 13,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  cursor: "pointer",
                }}>{isOriginalTutorOpen ? "튜터 닫기" : "AI 튜터"}</button>
              )}
              {activeTab === "summary" && activeSummary && (
                <>
                  {multiSourceBadge(activeSummary.materialIds)}
                  <SummaryActions template={activeSummary.template} content={activeSummary.content} onGoToQuiz={onGoQuiz} />
                  <button onClick={() => handleSummaryTutorOpenChange(!isSummaryTutorOpen)} style={{
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: isSummaryTutorOpen ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                    background: isSummaryTutorOpen ? "var(--color-tint-pink)" : "var(--color-card)",
                    color: isSummaryTutorOpen ? PINK : "var(--color-text)",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}>
                    {isSummaryTutorOpen ? "튜터 닫기" : "AI 튜터"}
                  </button>
                </>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <button type="button" onClick={() => setActiveTab("original")} style={tabButtonStyle("original")}>원본</button>
            <button type="button" onClick={() => setActiveTab("summary")} style={tabButtonStyle("summary")}>요약 {summaries.length > 0 ? summaries.length : ""}</button>
            <button type="button" onClick={() => setActiveTab("quiz")} style={tabButtonStyle("quiz")}>퀴즈 {quizSets.length > 0 ? quizSets.length : ""}</button>
          </div>
          {hubError && <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--color-danger)", fontWeight: 700 }}>{hubError}</p>}
        </div>

        <div style={{ overflow: "hidden", borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>
        {activeTab === "original" && (
          <div
            ref={tutorSplit.containerRef}
            style={{
              display: "flex",
              alignItems: "stretch",
              height: SPLIT_ROW_HEIGHT,
              minHeight: SPLIT_ROW_MIN_HEIGHT,
            }}
          >
            {!isOriginalTutorExpanded && (
              <div style={{ flex: isOriginalTutorOpen ? `${tutorSplit.ratio} 1 0` : "1 1 0", minWidth: 0, overflow: "hidden" }}>
                {renderOriginalTab()}
              </div>
            )}
            {isOriginalTutorOpen && (
              <>
                {!isOriginalTutorExpanded && <TutorSplitDivider onPointerDown={tutorSplit.startDrag} />}
                <div style={{ flex: isOriginalTutorExpanded ? "1 1 0" : `${1 - tutorSplit.ratio} 1 0`, minWidth: 0, minHeight: 0 }}>
                  <AITutorDrawer
                    layout="embedded"
                    fill
                    open={isOriginalTutorOpen}
                    onOpenChange={(next) => { setIsOriginalTutorOpen(next); if (!next) setIsOriginalTutorExpanded(false); }}
                    expanded={isOriginalTutorExpanded}
                    onExpandedChange={setIsOriginalTutorExpanded}
                    contextTitle={tutorContextTitle}
                    contextMarkdown={combinedTutorContextMarkdown}
                    summaryId={activeSummary?.id || null}
                    materialId={material.id}
                    suggestedQuestions={tutorSuggestions}
                    initialQuestion={tutorPrompt}
                    onInitialQuestionConsumed={() => setTutorPrompt("")}
                    disabledReason="요약 생성 후 AI 튜터를 사용할 수 있습니다"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "summary" && (
          <div style={{ padding: 24, background: "var(--color-surface)", minHeight: 520 }}>
            {hubLoading ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", color: "var(--color-muted)", fontSize: 14 }}>연결된 요약을 불러오는 중입니다.</div>
            ) : summaries.length === 0 ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--color-text-strong)" }}>아직 요약이 없습니다</h3>
                  <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--color-muted)" }}>이 자료를 기준으로 바로 학습용 요약을 만들 수 있습니다.</p>
                  <button onClick={onGoSummary} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: PINK, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    요약 생성하기
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "stretch", gap: 14, height: SPLIT_ROW_HEIGHT, minHeight: SPLIT_ROW_MIN_HEIGHT }}>
                {showSummaryList && !isSummaryTutorExpanded && (
                  <div style={{ flex: "0 0 220px", minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {summaries.map(summary => (
                      <button
                        key={summary.id || `${summary.template}-${summary.createdAt}`}
                        type="button"
                        onClick={() => setActiveSummaryId(summary.id || "")}
                        style={{
                          padding: "12px 13px",
                          borderRadius: 10,
                          border: activeSummary?.id === summary.id ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                          background: activeSummary?.id === summary.id ? "var(--color-tint-pink)" : "var(--color-card)",
                          color: activeSummary?.id === summary.id ? PINK : "var(--color-text)",
                          textAlign: "left",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        <strong style={{ display: "block", fontSize: 13, marginBottom: 4 }}>{templateLabels[summary.template]}</strong>
                        <span style={{ display: "block", fontSize: 11, color: "var(--color-muted)" }}>{formatHubDate(summary.createdAt)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={onGoSummary}
                      style={{
                        padding: "12px 13px",
                        borderRadius: 10,
                        border: "1px dashed color-mix(in srgb, var(--color-pink) 40%, transparent)",
                        background: "var(--color-card)",
                        color: PINK,
                        fontSize: 13,
                        fontWeight: 850,
                        cursor: "pointer",
                        flexShrink: 0,
                        textAlign: "center",
                      }}
                    >
                      + 요약 새로 생성
                    </button>
                  </div>
                )}
                <div
                  ref={tutorSplit.containerRef}
                  style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "stretch" }}
                >
                  {activeSummary && !isSummaryTutorExpanded && (
                    <div style={{ flex: isSummaryTutorOpen ? `${tutorSplit.ratio} 1 0` : "1 1 0", minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
                      <div style={{ padding: 22, borderRadius: 12, background: "var(--color-card)", border: `1px solid ${BORDER_COLOR}`, minWidth: 0, minHeight: "100%", boxSizing: "border-box" }}>
                        <div style={{ marginBottom: 18 }}>
                          <h3 style={{ margin: "0 0 6px", fontSize: 18, color: "var(--color-text-strong)" }}>{templateLabels[activeSummary.template]}</h3>
                          <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>{formatHubDate(activeSummary.createdAt)}</p>
                        </div>
                        {hasReviewContext && (
                          <div style={{
                            marginBottom: 18,
                            padding: 16,
                            borderRadius: 12,
                            border: "1px solid #F8DFA8",
                            background: "#FFF8E8",
                          }}>
                            <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 850, color: "#7A5200" }}>
                              {reviewTitle || "이번 퀴즈 오답 복습"}
                            </h4>
                            <pre style={{
                              margin: 0,
                              maxHeight: 220,
                              overflowY: "auto",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontFamily: "inherit",
                              fontSize: 13,
                              lineHeight: 1.65,
                              color: "#6A4B00",
                            }}>
                              {reviewContext.trim()}
                            </pre>
                          </div>
                        )}
                        <SelectionAskButton onAsk={askSummaryTutorWithSelection}>
                          <SummaryContentView content={activeSummary.content} template={activeSummary.template} />
                        </SelectionAskButton>
                      </div>
                    </div>
                  )}
                  {isSummaryTutorOpen && activeSummary && (
                    <>
                      {!isSummaryTutorExpanded && <TutorSplitDivider onPointerDown={tutorSplit.startDrag} />}
                      <div style={{ flex: isSummaryTutorExpanded ? "1 1 0" : `${1 - tutorSplit.ratio} 1 0`, minWidth: 0, minHeight: 0 }}>
                        <AITutorDrawer
                          layout="embedded"
                          fill
                          open={isSummaryTutorOpen}
                          onOpenChange={handleSummaryTutorOpenChange}
                          expanded={isSummaryTutorExpanded}
                          onExpandedChange={setIsSummaryTutorExpanded}
                          contextTitle={`${material.name} · ${templateLabels[activeSummary.template]}`}
                          contextMarkdown={combinedTutorContextMarkdown}
                          summaryId={activeSummary.id || null}
                          materialId={material.id}
                          suggestedQuestions={suggestedTutorQuestions[activeSummary.template]}
                          initialQuestion={tutorPrompt}
                          onInitialQuestionConsumed={() => setTutorPrompt("")}
                          pendingQuestion={tutorSelectionQuestion ?? undefined}
                          disabledReason="요약 생성 후 AI 튜터를 사용할 수 있습니다"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "quiz" && (
          <div style={{ padding: 24, background: "var(--color-surface)", minHeight: 520 }}>
            {hubLoading ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", color: "var(--color-muted)", fontSize: 14 }}>연결된 퀴즈를 불러오는 중입니다.</div>
            ) : quizSets.length === 0 ? (
              <div style={{ minHeight: 300, display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--color-text-strong)" }}>아직 퀴즈가 없습니다</h3>
                  <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--color-muted)" }}>이 자료와 연결된 문제 세트를 새로 만들 수 있습니다.</p>
                  <button onClick={onGoQuiz} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    퀴즈 생성하기
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {quizSets.map(quizSet => {
                  const latestAttempt = latestAttemptByQuizSetId.get(quizSet.id);
                  return (
                    <div key={quizSet.id} style={{ padding: 18, borderRadius: 12, background: "var(--color-card)", border: `1px solid ${BORDER_COLOR}`, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          <h3 style={{ margin: 0, fontSize: 16, color: "var(--color-text-strong)", wordBreak: "break-word" }}>{quizSet.title}</h3>
                          {multiSourceBadge(quizSet.materialIds)}
                          {latestAttempt && (
                            <span style={{
                              padding: "4px 8px",
                              borderRadius: 999,
                              background: latestAttempt.scorePercent < LOW_QUIZ_SCORE_THRESHOLD ? "#FFF5F5" : "#F1FFF5",
                              color: latestAttempt.scorePercent < LOW_QUIZ_SCORE_THRESHOLD ? "#E53E3E" : "#2F9E44",
                              fontSize: 11,
                              fontWeight: 850,
                            }}>
                              풀이 {latestAttempt.scorePercent}%
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: "var(--color-muted)", fontWeight: 700 }}>
                          <span>난이도 {quizSet.difficulty}</span>
                          <span>{quizSet.questionType}</span>
                          <span>{quizSet.count || quizSet.questions.length}문항</span>
                          <span>{formatHubDate(quizSet.createdAt)}</span>
                        </div>
                      </div>
                      <button onClick={() => onOpenQuiz(quizSet)} style={{ flexShrink: 0, padding: "10px 14px", borderRadius: 9, border: "none", background: CYAN, color: "var(--color-on-brand)", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                        {latestAttempt ? "분석 리포트" : "퀴즈 풀기"}
                      </button>
                    </div>
                  );
                })}
                <button onClick={onGoQuiz} style={{ justifySelf: "start", padding: "11px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--color-cyan) 20%, transparent)", background: "var(--color-tint-cyan)", color: CYAN, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                  새 퀴즈 만들기
                </button>
              </div>
            )}
          </div>
        )}
        </div>
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
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "var(--color-text-strong)" }}>퀴즈 생성</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-soft)" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)" }}>요약된 파일 미리보기</span>
          </div>
          <div style={{
            padding: 24, minHeight: 360, background: "var(--color-surface)",
            fontSize: 13, color: "var(--color-text)", lineHeight: 1.8
          }}>
            <p style={{ fontWeight: 600, color: "var(--color-text-strong)", marginTop: 0 }}>{fileName || "업로드된 파일"} - 요약본</p>
            <p>이번 강의에서는 동적 프로그래밍(DP)의 핵심 개념을 다루었습니다. DP는 큰 문제를 작은 하위 문제로 나누어 해결하는 알고리즘 설계 기법입니다.</p>
            <p>메모이제이션과 타뷸레이션 두 가지 접근 방식이 있으며, 최적 부분 구조와 중복 부분 문제라는 두 가지 조건이 필요합니다.</p>
            <p>피보나치 수열, 배낭 문제, 최장 공통 부분 수열(LCS) 등의 대표적인 예제를 통해 DP의 적용 방법을 학습했습니다.</p>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>난이도</h3>
            <div style={{ display: "flex", gap: 10 }}>
              {["낮음", "보통", "높음"].map(d => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  padding: "10px 24px", borderRadius: 10,
                  border: difficulty === d ? "none" : "1px solid var(--color-border-soft)",
                  background: difficulty === d ? PINK : "var(--color-card)",
                  color: difficulty === d ? "var(--color-on-brand)" : "var(--color-text)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>문항수</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: 80, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                  fontSize: 14, textAlign: "center", outline: "none"
                }}
              />
              <span style={{ fontSize: 14, color: "var(--color-muted)" }}>개</span>
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>문제 유형</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["O/X", "객관식", "단답형", "주관식"].map(t => (
                <button key={t} onClick={() => toggleType(t)} style={{
                  padding: "10px 20px", borderRadius: 10,
                  border: types.includes(t) ? "none" : "1px solid var(--color-border-soft)",
                  background: types.includes(t) ? CYAN : "var(--color-card)",
                  color: types.includes(t) ? "var(--color-on-brand)" : "var(--color-text)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{t}</button>
              ))}
            </div>
          </div>

          <button onClick={onCreate} style={{
            padding: "16px 0", borderRadius: 14, border: "none",
            background: PINK, color: "var(--color-on-brand)", fontSize: 16, fontWeight: 700,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const locationState = (location.state as LocationState) || null;
  const isInitialRouteEntryRef = useRef(isInitialRouteEntry(location.key));
  const shouldRestoreLocationView = !isInitialRouteEntryRef.current;

  // 복원 소스 결정: 다른 페이지에서 넘어온 핸드오프(location.state)가 최우선이고,
  // 핸드오프가 없고 URL 쿼리에 과목이 있으면 새로고침/딥링크로 보고 URL+세션에서 복원한다.
  const hasHandoff = shouldRestoreLocationView && Boolean(
    locationState?.viewMaterial || locationState?.createSummary || locationState?.openSummary,
  );
  const urlCourse = (searchParams.get("course") || "").trim();
  const urlView = URL_TOKEN_TO_VIEW[searchParams.get("view") || ""];
  const urlMaterialId = searchParams.get("material") || "";
  const restoreFromUrl = !hasHandoff && Boolean(urlCourse);
  const sessionDetailRef = useRef<SummaryViewDetail>(restoreFromUrl ? readSummaryViewDetail() : {});
  const sessionDetail = sessionDetailRef.current;

  const initialCourse = ((locationState?.selectedCourse || (restoreFromUrl ? urlCourse : "")) || "").trim();
  const fromDashboardRef = useRef(Boolean(locationState?.selectedCourse?.trim() && locationState?.fromDashboard));
  const pendingMaterialIdRef = useRef(
    hasHandoff && locationState?.viewMaterial
      ? locationState.materialId || locationState.materialIds?.[0] || ""
      : restoreFromUrl && urlView === "materialDetail"
        ? urlMaterialId
        : "",
  );
  const pendingCreateSummaryRef = useRef(
    (hasHandoff && Boolean(locationState?.createSummary)) ||
    (restoreFromUrl && urlView === "templates"),
  );
  const pendingMaterialDetailTabRef = useRef<MaterialDetailTab>(
    hasHandoff && locationState?.viewMaterial
      ? locationState.materialDetailTab || "original"
      : restoreFromUrl && urlView === "materialDetail"
        ? sessionDetail.tab || "original"
        : "original",
  );
  const pendingMaterialTutorQuestionRef = useRef(
    hasHandoff && locationState?.viewMaterial ? locationState.tutorQuestion || "" : "",
  );
  const pendingMaterialReviewContextRef = useRef(
    hasHandoff && locationState?.viewMaterial ? locationState.quizReviewContext || "" : "",
  );
  const pendingMaterialReviewTitleRef = useRef(
    hasHandoff && locationState?.viewMaterial ? locationState.quizReviewTitle || "" : "",
  );
  const pendingMaterialIdsRef = useRef<string[]>(
    hasHandoff && (locationState?.viewMaterial || locationState?.createSummary)
      ? locationState.materialIds || (locationState.materialId ? [locationState.materialId] : [])
      : restoreFromUrl
        ? sessionDetail.materialIds || (urlMaterialId ? [urlMaterialId] : [])
        : [],
  );
  const pendingSummaryRef = useRef(
    hasHandoff && locationState?.openSummary
      ? {
          id: locationState.summaryId || "",
          template: locationState.summaryTemplate,
          content: locationState.summaryContent || "",
          createdAt: locationState.summaryCreatedAt || Date.now(),
          materialIds: locationState.materialIds || [],
        }
      : restoreFromUrl && urlView === "summaryResult"
        ? {
            id: sessionDetail.summaryId || "",
            template: sessionDetail.template,
            content: "",
            createdAt: Date.now(),
            materialIds: sessionDetail.materialIds || [],
          }
        : null,
  );
  // URL 복원인데 자료 상세/요약을 못 살릴 때(자료 삭제, 요약 생성 중 새로고침 등) 돌아갈 화면.
  const pendingViewRef = useRef<SummaryView | null>(
    restoreFromUrl ? urlView || "upload" : null,
  );
  const [sidebar, setSidebar] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searched, setSearched] = useState(Boolean(initialCourse));
  const [selectedCourse] = useState(initialCourse);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [textMaterialTitle, setTextMaterialTitle] = useState("");
  const [textMaterialContent, setTextMaterialContent] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<UploadedFile[]>([]);

  const [view, setView] = useState<SummaryView>("upload");
  // 요약 안내 팝업 '다시 보지 않기' 설정은 계정별(Supabase 프로필)로 저장한다.
  // 로드 전에는 true(숨김)로 두어, 불러오기 전에 팝업이 깜빡이지 않게 한다.
  const [hideSummaryNoticePref, setHideSummaryNoticePref] = useState(true);

  useEffect(() => {
    let ignore = false;
    loadUserProfile()
      .then(profile => { if (!ignore) setHideSummaryNoticePref(profile.hideSummaryNotice); })
      .catch(() => { if (!ignore) setHideSummaryNoticePref(false); });
    return () => { ignore = true; };
  }, []);

  // 업로드 화면에 '실제로' 머무를 때만 요약 안내 팝업을 띄운다.
  // 딥링크 진입 시 비동기 로딩이 끝나기 전까지 view가 잠깐 'upload'였다가
  // materialDetail/summaryResult 등으로 바뀌는데, 그 transient 동안 팝업이
  // 깜빡이는 걸 막기 위해 '대기 중인 딥링크 네비게이션'이 없을 때만 띄운다.
  useEffect(() => {
    const hasPendingNav =
      Boolean(pendingMaterialIdRef.current) ||
      pendingCreateSummaryRef.current ||
      Boolean(pendingSummaryRef.current);
    if (view === "upload" && !hasPendingNav && !hideSummaryNoticePref) {
      setShowMultiSummaryNotice(true);
    } else {
      setShowMultiSummaryNotice(false);
    }
  }, [view, hideSummaryNoticePref]);
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
  const [activeMaterialTab, setActiveMaterialTab] = useState<MaterialDetailTab>("original");
  const [materialDetailTutorQuestion, setMaterialDetailTutorQuestion] = useState("");
  const [materialDetailReviewContext, setMaterialDetailReviewContext] = useState("");
  const [materialDetailReviewTitle, setMaterialDetailReviewTitle] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<DuplicateFileNotice | null>(null);
  // 50MB 초과로 원본을 저장하지 못한 파일들을 모아 가운데 모달로 안내.
  const [sizeLimitNotice, setSizeLimitNotice] = useState<{ names: string[] } | null>(null);
  const [showMultiSummaryNotice, setShowMultiSummaryNotice] = useState(false);
  const [dontShowMultiSummaryNotice, setDontShowMultiSummaryNotice] = useState(false);
  const [uploadStatuses, setUploadStatuses] = useState<UploadFileStatus[]>([]);
  const [agentThreadId, setAgentThreadId] = useState("");
  const [resultBackView, setResultBackView] = useState<SummaryView>("templates");
  // templates(템플릿 선택) 화면에서 "돌아가기" 시 돌아갈 화면.
  // 자료 상세에서 진입하면 materialDetail, 그 외에는 upload(과목 자료)로 돌아간다.
  const [templatesBackView, setTemplatesBackView] = useState<SummaryView>("upload");
  const [pendingTutorQuestion] = useState(
    shouldRestoreLocationView ? locationState?.tutorQuestion || "" : "",
  );
  const selectedMaterials = materials.filter(material => selectedMaterialIds.includes(material.id));
  const selectedMarkdown = combineMaterialsMarkdown(selectedMaterials);
  // 페이지 범위 입력 힌트는 자료가 하나일 때만 명확하므로 그 경우에만 보여준다.
  const summaryPageHint = selectedMaterials.length === 1
    ? (selectedMaterials[0].pages
        ? `총 ${selectedMaterials[0].pages}페이지`
        : selectedMaterials[0].slides
          ? `총 ${selectedMaterials[0].slides}슬라이드`
          : undefined)
    : undefined;

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!locationState?.openSummary && !locationState?.viewMaterial && !locationState?.createSummary) return;
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
            setMaterialDetailReviewContext(pendingMaterialReviewContextRef.current);
            setMaterialDetailReviewTitle(pendingMaterialReviewTitleRef.current);
            pendingMaterialDetailTabRef.current = "original";
            pendingMaterialTutorQuestionRef.current = "";
            pendingMaterialReviewContextRef.current = "";
            pendingMaterialReviewTitleRef.current = "";
            setSearched(true);
            setView("materialDetail");
            return;
          }
        }

        if (pendingCreateSummaryRef.current) {
          pendingCreateSummaryRef.current = false;
          const validMaterialIds = pendingMaterialIdsRef.current.filter(id => nextMaterials.some(material => material.id === id));
          pendingMaterialIdsRef.current = [];
          setSelectedMaterialIds(validMaterialIds.length > 0 ? validMaterialIds : nextMaterials.map(material => material.id));
          setSelectedTemplate(null);
          setActiveSummaryId(null);
          setSummaryText("");
          setSummaryError("");
          setElapsedTime(null);
          setLoadingStep("");
          setAgentThreadId("");
          setResultBackView("upload");
          setTemplatesBackView("upload");
          setSearched(true);
          setView("templates");
          return;
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

        // URL에서 자료 목록을 복원하거나, 자료 상세·요약 복원이 실패한 경우(자료 삭제 등)의 안전 착지.
        if (pendingViewRef.current) {
          const fallbackView = pendingViewRef.current;
          pendingViewRef.current = null;
          if (fallbackView !== "upload" && nextMaterials.length > 0) {
            setSearched(true);
            setView("upload");
          }
        }
      })
      .catch(error => {
        setExtractError(error instanceof Error ? error.message : "강의자료 불러오기 실패");
      });

    return () => {
      ignore = true;
    };
  }, [selectedCourse]);

  // 보던 화면을 URL(위치)과 세션(세부)에 반영해 새로고침/딥링크 복원을 지원한다.
  // state -> URL/세션 단방향 동기화이며, replace로 갱신해 히스토리를 더럽히지 않는다.
  useEffect(() => {
    if (!selectedCourse) {
      if (searchParams.toString()) setSearchParams(new URLSearchParams(), { replace: true });
      clearSummaryViewDetail();
      return;
    }

    const nextParams = new URLSearchParams();
    nextParams.set("course", selectedCourse);
    nextParams.set("view", VIEW_TO_URL_TOKEN[view]);
    if ((view === "materialDetail" || view === "summaryResult") && activeMaterial?.id) {
      nextParams.set("material", activeMaterial.id);
    }
    if (searchParams.toString() !== nextParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }

    // 세부 UI는 세션에 저장. 요약 생성 중에도 식별자만 저장하고 본문(휘발성)은 저장하지 않는다.
    writeSummaryViewDetail({
      tab: activeMaterialTab,
      summaryId: activeSummaryId || undefined,
      template: selectedTemplate || undefined,
      materialIds: selectedMaterialIds,
    });
    // searchParams/setSearchParams는 비교·갱신용이며 stable하므로 의존성에서 제외한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedCourse, activeMaterial?.id, activeMaterialTab, activeSummaryId, selectedTemplate, selectedMaterialIds]);

  useEffect(() => {
    if (!duplicateNotice) return;
    const timer = window.setTimeout(() => setDuplicateNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [duplicateNotice]);

  const updateUploadStatus = (file: File, nextStatus: Omit<UploadFileStatus, "id" | "name" | "file">) => {
    setUploadStatuses(prev => upsertUploadStatus(prev, {
      id: getUploadStatusId(file),
      name: file.name,
      file,
      ...nextStatus,
    }));
  };

  const failUploadStatus = (file: File, message: string) => {
    const failure = classifyUploadFailure(message);
    updateUploadStatus(file, {
      state: "failed",
      label: failure.label,
      message: `${message} ${failure.guide}`,
      failureKind: failure.kind,
    });
  };

  const handleSelectedFiles = async (incomingFiles: File[]) => {
    const unsupportedFiles = incomingFiles.filter(file => !isSupportedDocumentFile(file));
    unsupportedFiles.forEach(file => {
      const failure = classifyUploadFailure("지원하지 않는 파일 형식입니다.");
      updateUploadStatus(file, {
        state: "failed",
        label: failure.label,
        message: failure.guide,
        failureKind: failure.kind,
      });
    });

    const arr = incomingFiles.filter(isSupportedDocumentFile);
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
    duplicateFiles.forEach(file => updateUploadStatus(file, {
      state: "duplicate",
      label: "이미 등록된 파일",
      message: "기존 자료를 확인하고, 원본 파일 연결이 없으면 다시 연결합니다.",
    }));
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
          updateUploadStatus(match.file, {
            state: "storing",
            label: "원본 다시 연결 중",
            message: "기존 자료에 원본 파일을 다시 연결하고 있습니다.",
            materialId: nextMaterial.id,
          });
          try {
            nextMaterial = await uploadCourseMaterialFile(selectedCourse, nextMaterial, match.file);
            didAttachFiles = true;
            updateUploadStatus(match.file, {
              state: "done",
              label: "원본 연결 완료",
              message: "기존 자료에 원본 파일만 다시 연결됐습니다.",
              materialId: nextMaterial.id,
            });
          } catch (err) {
            const message = err instanceof Error ? `원본 파일 저장 실패: ${err.message}` : "원본 파일 저장 실패";
            setExtractError(message);
            failUploadStatus(match.file, message);
          }
        } else if (match) {
          updateUploadStatus(match.file, {
            state: "duplicate",
            label: "기존 자료 사용",
            message: "이미 등록된 자료입니다. 기존 자료를 그대로 사용합니다.",
            materialId: nextMaterial.id,
          });
        }
        nextMaterials.push(nextMaterial);
      }

      if (didUpdatePages || didAttachFiles) {
        await saveCourseMaterials(selectedCourse, nextMaterials);
        setMaterials(nextMaterials);
        if (didAttachFiles) {
          setDuplicateNotice({ names: Array.from(new Set(duplicateNames)), reattached: true });
        }
      }
    }
    if (newFiles.length === 0) return;

    setUploading(true);
    newFiles.forEach(file => updateUploadStatus(file, {
      state: "uploading",
      label: "업로드 중",
      message: "파일 정보를 읽고 저장 준비를 하고 있습니다.",
    }));

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
    setSizeLimitNotice(null);
    const uploadedMaterials: CourseMaterial[] = [];
    const oversizeNames: string[] = [];
    try {
      for (const documentFile of newFiles) {
        try {
          updateUploadStatus(documentFile, {
            state: "extracting",
            label: "텍스트 추출 중",
            message: "자료 내용을 Markdown으로 변환하고 있습니다.",
          });
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
            if (documentFile.size > MAX_ORIGINAL_FILE_BYTES) {
              // 한도 초과: 원본 저장은 건너뛰고 텍스트만 저장 — 실패가 아니라 정상 폴백이라 에러 배너 없이 안내만.
              uploadedMaterials.push(baseMaterial);
              oversizeNames.push(documentFile.name);
              updateUploadStatus(documentFile, {
                state: "done",
                label: "텍스트만 완료",
                message: `원본 파일이 ${(documentFile.size / (1024 * 1024)).toFixed(1)}MB로 저장 한도(50MB)를 넘어 원본은 저장하지 않았어요. 텍스트는 저장돼 요약·퀴즈에 그대로 사용할 수 있어요.`,
                materialId: baseMaterial.id,
              });
            } else {
              updateUploadStatus(documentFile, {
                state: "storing",
                label: "원본 저장 중",
                message: "추출된 텍스트와 원본 파일을 저장하고 있습니다.",
                materialId: baseMaterial.id,
              });
              try {
                const savedMaterial = await uploadCourseMaterialFile(selectedCourse, baseMaterial, documentFile);
                uploadedMaterials.push(savedMaterial);
                updateUploadStatus(documentFile, {
                  state: "done",
                  label: "완료",
                  message: "업로드와 텍스트 추출이 완료됐습니다.",
                  materialId: savedMaterial.id,
                });
              } catch (err) {
                const message = err instanceof Error ? `원본 파일 저장 실패: ${err.message}` : "원본 파일 저장 실패";
                setExtractError(message);
                uploadedMaterials.push(baseMaterial);
                updateUploadStatus(documentFile, {
                  state: "done",
                  label: "텍스트만 완료",
                  message: `${message} 그래도 텍스트 추출 결과는 저장되어 요약과 퀴즈에 사용할 수 있습니다.`,
                  materialId: baseMaterial.id,
                });
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "파일 분석 실패";
          setExtractError(message);
          failUploadStatus(documentFile, message);
        }
      }

      if (oversizeNames.length > 0) {
        setSizeLimitNotice({ names: oversizeNames });
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

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    await handleSelectedFiles(Array.from(fileList));
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

  const handleTemplateSelect = async (template: SummaryTemplate, opts?: { pageRange?: string; focusPrompt?: string }) => {
    setSelectedTemplate(template);
    setSummaryError("");

    if (selectedMarkdown) {
      // "요약 새로 생성"은 같은 자료여도 항상 새로 만든다(중복 허용). 기존 요약을 재사용하지 않는다.
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
        const response = await summarizeWithTemplate(selectedMarkdown, template, {
          pages: opts?.pageRange,
          focusPrompt: opts?.focusPrompt,
        });
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
          // 중복 허용: 같은 자료·템플릿이어도 기존 요약을 지우지 않고 항상 새로 저장한다.
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
    setMaterialDetailReviewContext("");
    setMaterialDetailReviewTitle("");
    setTemplatesBackView("materialDetail");
    setView("templates");
  };

  const handleCreateQuizForMaterial = (material: CourseMaterial) => {
    setSelectedMaterialIds([material.id]);
    navigate(pageRoutes["퀴즈 생성"], {
      state: { course: selectedCourse, materialIds: [material.id], fromDashboard: fromDashboardRef.current },
    });
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
    setMaterialDetailReviewContext("");
    setMaterialDetailReviewTitle("");
  };

  if (!selectedCourse) return <Navigate to={pageRoutes["대시보드"]} replace />;

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="자료 요약" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {showMultiSummaryNotice && view === "upload" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="요약 안내"
          onClick={() => {
            if (dontShowMultiSummaryNotice) {
              setHideSummaryNoticePref(true);
              updateHideSummaryNotice(true).catch(() => {});
            }
            setShowMultiSummaryNotice(false);
          }}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "min(440px, 100%)", background: "var(--color-card)", borderRadius: 20, padding: "32px 30px",
            boxShadow: "0 18px 50px rgba(0,0,0,0.22)", border: "1px solid var(--color-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "#FFF7ED",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
              }}>📝</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text-strong)" }}>요약 안내</h3>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.8, color: "var(--color-text)", wordBreak: "keep-all" }}>
              출력 토큰이 제한되어 있어, <b style={{ color: "var(--color-text-strong)" }}>여러 개 요약해도</b> <b style={{ color: "var(--color-text-strong)" }}>하나만 </b>생성돼요.
            </p>
            <div style={{
              margin: "0 0 24px", padding: "16px 16px", borderRadius: 12, background: "var(--color-page)",
              fontSize: 13, lineHeight: 1.8, color: "var(--color-text-secondary)", wordBreak: "keep-all",
              display: "flex", gap: 8, alignItems: "flex-start",
            }}>
              <span style={{ flexShrink: 0 }}>💡</span>
              <span>
                자료가 많을수록 AI가 내용을 줄여서 요약할 수 있어요.<br />
                각 자료를 자세히 보고 싶다면 <b style={{ color: PINK }}>한 개씩 선택해서 요약</b>하는 걸 추천해요.
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--color-muted)", cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={dontShowMultiSummaryNotice}
                  onChange={e => setDontShowMultiSummaryNotice(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                다시 보지 않기
              </label>
              <button
                type="button"
                onClick={() => {
                  if (dontShowMultiSummaryNotice) {
                    setHideSummaryNoticePref(true);
                    updateHideSummaryNotice(true).catch(() => {});
                  }
                  setShowMultiSummaryNotice(false);
                }}
                style={{
                  padding: "9px 22px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}
              >확인</button>
            </div>
          </div>
        </div>
      )}
      {sizeLimitNotice && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="원본 저장 한도 안내"
          onClick={() => setSizeLimitNotice(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: "min(380px, 100%)", background: "var(--color-card)", borderRadius: 18, padding: 24,
            boxShadow: "0 18px 50px rgba(0,0,0,0.22)", border: "1px solid var(--color-border-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "#FFF7ED", color: "#F59E0B",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, flexShrink: 0,
              }}>!</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text-strong)" }}>원본은 저장하지 않았어요</h3>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6, color: "var(--color-text)" }}>
              아래 파일은 <b style={{ color: "var(--color-text-strong)" }}>50MB 저장 한도</b>를 넘어 원본을 저장하지 않았어요.{" "}
              <b style={{ color: "var(--color-text-strong)" }}>텍스트는 저장돼 요약·퀴즈에 그대로 사용</b>할 수 있어요.
            </p>
            <div style={{
              margin: "0 0 14px", padding: "10px 12px", borderRadius: 10, background: "var(--color-page)",
              fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", wordBreak: "break-word", lineHeight: 1.5,
            }}>
              {sizeLimitNotice.names.join(", ")}
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 12, lineHeight: 1.5, color: "var(--color-muted)" }}>
              원본까지 저장하려면 파일을 50MB 미만으로 줄이거나 나눠서 올려주세요.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setSizeLimitNotice(null)}
                style={{
                  padding: "9px 22px", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}
              >확인</button>
            </div>
          </div>
        </div>
      )}
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
            background: "var(--color-card)",
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
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text-strong)", marginBottom: 4 }}>
                {duplicateNotice.reattached ? "기존 자료에 원본 파일을 다시 연결했어요" : "이미 등록된 파일입니다"}
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
              <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
                {duplicateNotice.reattached
                  ? "요약 내용은 그대로 두고, 원본 미리보기에 필요한 파일만 연결했습니다."
                  : "기존 자료를 그대로 사용할게요. 원본 파일 연결이 없던 자료는 다시 연결을 시도합니다."}
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
                background: "var(--color-surface)",
                color: "var(--color-muted)",
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

      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-border-soft)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 자료 요약</span>
      </div>

      <div style={{
        padding: view === "summaryResult" || view === "materialDetail" ? "18px 20px" : 24,
        maxWidth: view === "summaryResult" || view === "materialDetail" ? 1480 : 1100,
        margin: "0 auto",
      }}>
        {view === "templates" && (
          <TemplateSelectView onSelect={handleTemplateSelect} onBack={() => setView(templatesBackView)} pageHint={summaryPageHint} />
        )}

        {view === "summaryResult" && selectedTemplate && (
          <SummaryResultView
            template={selectedTemplate}
            onBack={() => setView(resultBackView)}
            backLabel={
              resultBackView === "materialDetail" ? "← 자료 상세로"
              : resultBackView === "upload" ? "← 과목 자료로"
              : "← 템플릿 선택으로"
            }
            contextTitle={`${selectedMaterials.map(material => material.name).join(", ") || "현재 자료"} · ${templateLabels[selectedTemplate]}`}
            realContent={summaryText}
            isLoading={isSummarizing}
            error={summaryError}
            loadingStep={loadingStep}
            elapsedTime={elapsedTime}
            threadId={agentThreadId}
            summaryId={activeSummaryId}
            resetTutorHistory={isInitialRouteEntryRef.current}
            initialTutorQuestion={pendingTutorQuestion}
            onGoToQuiz={selectedCourse ? handleGoToQuiz : undefined}
          />
        )}

        {view === "materialDetail" && activeMaterial && (
          <MaterialDetailView
            material={activeMaterial}
            selectedCourse={selectedCourse}
            onBack={() => { if (fromDashboardRef.current) navigate(pageRoutes["대시보드"]); else setView("upload"); }}
            onGoSummary={() => handleCreateSummaryForMaterial(activeMaterial)}
            onGoQuiz={() => handleCreateQuizForMaterial(activeMaterial)}
            onOpenQuiz={handleOpenMaterialQuiz}
            initialTab={materialDetailInitialTab}
            initialTutorQuestion={materialDetailTutorQuestion}
            reviewContext={materialDetailReviewContext}
            reviewTitle={materialDetailReviewTitle}
            relatedMaterials={materials.filter(material => selectedMaterialIds.includes(material.id))}
            onSelectRelatedMaterial={handleSelectRelatedMaterial}
            onTabChange={setActiveMaterialTab}
          />
        )}

        {view === "quizCreate" && (
          <QuizCreateView fileName={selectedMaterials.map(material => material.name).join(", ")} onBack={() => setView("upload")} onCreate={handleGoToQuiz} />
        )}

        {view === "upload" && selectedCourse && (
          <div>
            <button onClick={() => navigate(pageRoutes["대시보드"])} style={{
              background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
            }}>← 대시보드로</button>
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
                        border: inputMode === mode ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                        background: inputMode === mode ? "var(--color-tint-pink)" : "var(--color-card)",
                        color: inputMode === mode ? PINK : "var(--color-text-secondary)",
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
                    <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-muted)" }}>강의자료 파일을 드래그하거나</p>
                    <button style={{
                      marginTop: 12, padding: "8px 20px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                      background: "var(--color-card)", fontSize: 13, cursor: "pointer", color: "var(--color-text)"
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
                        background: textMaterialTitle.trim() && textMaterialContent.trim() ? PINK : "var(--color-border-soft)",
                        color: "var(--color-on-brand)",
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
                  <div style={{ padding: "8px 0", fontSize: 12, color: "var(--color-danger)" }}>
                    분석 실패: {extractError}
                  </div>
                )}

                {uploadStatuses.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 850, color: "var(--color-muted)" }}>
                      파일별 처리 상태
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {uploadStatuses.map(status => {
                        const isFailed = status.state === "failed";
                        const isDone = status.state === "done";
                        const isDuplicate = status.state === "duplicate";
                        const tone = isFailed ? "#E53E3E" : isDone ? "#2F9E44" : isDuplicate ? "#B7791F" : status.state === "previewing" ? CYAN : PINK;
                        const background = isFailed ? "#FFF5F5" : isDone ? "#F1FFF5" : isDuplicate ? "#FFF8E8" : "#FFF7FB";
                        const linkedMaterial = status.materialId ? materials.find(material => material.id === status.materialId) : null;

                        return (
                          <div key={status.id} style={{
                            padding: 12,
                            borderRadius: 12,
                            border: `1px solid ${isFailed ? "#FED7D7" : "var(--color-border-soft)"}`,
                            background: "var(--color-card)",
                          }}>
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
                                  <span style={{ padding: "4px 8px", borderRadius: 999, background, color: tone, fontSize: 11, fontWeight: 850 }}>
                                    {status.label}
                                  </span>
                                  <strong style={{ fontSize: 13, color: "var(--color-text-strong)", wordBreak: "break-word" }}>{status.name}</strong>
                                </div>
                                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--color-text-secondary)" }}>
                                  {status.message}
                                </p>
                              </div>
                            </div>
                            {(isFailed || linkedMaterial) && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                                {isFailed && status.file && (
                                  <button
                                    type="button"
                                    onClick={() => void handleSelectedFiles([status.file as File])}
                                    style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-text)", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                                  >
                                    다시 시도
                                  </button>
                                )}
                                {linkedMaterial && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMaterial(linkedMaterial);
                                      setSelectedMaterialIds([linkedMaterial.id]);
                                      setMaterialDetailInitialTab("original");
                                      setMaterialDetailTutorQuestion("");
                                      setMaterialDetailReviewContext("");
                                      setMaterialDetailReviewTitle("");
                                      setView("materialDetail");
                                    }}
                                    style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--color-cyan) 20%, transparent)", background: "var(--color-tint-cyan)", color: CYAN, fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                                  >
                                    자료 열기
                                  </button>
                                )}
                                {isFailed && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => fileRef.current?.click()}
                                      style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                                    >
                                      다른 파일 업로드
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setInputMode("text")}
                                      style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--color-pink) 20%, transparent)", background: "var(--color-tint-pink)", color: PINK, fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                                    >
                                      텍스트 붙여넣기
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {materials.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>
                        강의자료 선택
                      </h4>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => setSelectedMaterialIds(materials.map(material => material.id))} style={{ border: `1px solid ${BORDER_COLOR}`, background: "var(--color-card)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "var(--color-text-secondary)", cursor: "pointer" }}>전체 선택</button>
                        <button type="button" onClick={() => setSelectedMaterialIds([])} style={{ border: `1px solid ${BORDER_COLOR}`, background: "var(--color-card)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "var(--color-text-secondary)", cursor: "pointer" }}>전체 해제</button>
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
                          border: isSelected ? "1.5px solid color-mix(in srgb, var(--color-pink) 27%, transparent)" : `1px solid ${BORDER_COLOR}`,
                          borderRadius: 10, marginBottom: 8, cursor: "pointer",
                        }}>
                        <div style={{
                          width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                          background: isSelected ? PINK : "transparent",
                          border: isSelected ? `2px solid ${PINK}` : "2px solid #ccc",
                          transition: "all 0.15s",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {isSelected && <span style={{ color: "var(--color-on-brand)", fontSize: 10, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                        </div>
                        <FileIcon type={material.type} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--color-text-strong)" }}>{material.name}</span>
                        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
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
                            setMaterialDetailReviewContext("");
                            setMaterialDetailReviewTitle("");
                            setView("materialDetail");
                          }}
                          style={{
                            height: 26,
                            padding: "0 8px",
                            borderRadius: 8,
                            border: "1px solid color-mix(in srgb, var(--color-cyan) 20%, transparent)",
                            background: "var(--color-tint-cyan)",
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
                            color: "var(--color-muted)",
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
                  <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: "var(--color-text-strong)" }}>
                    선택한 자료로 만들기
                  </h3>
                  <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "var(--color-muted)" }}>
                    체크한 강의자료를 기준으로 요약을 만들거나 바로 퀴즈를 생성할 수 있습니다.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <button onClick={() => { setTemplatesBackView("upload"); setView("templates"); }} disabled={!selectedMarkdown || isExtracting} style={{
                      padding: "18px 14px", borderRadius: 12, border: "none",
                      background: selectedMarkdown && !isExtracting ? "var(--color-tint-pink)" : "var(--color-surface)",
                      color: selectedMarkdown && !isExtracting ? PINK : "var(--color-muted)",
                      fontSize: 14, fontWeight: 800,
                      cursor: selectedMarkdown && !isExtracting ? "pointer" : "default",
                      textAlign: "center", lineHeight: 1.4,
                    }}>요약<br/>새로 생성</button>
                    <button onClick={handleGoToQuiz} disabled={!selectedMarkdown || isExtracting} style={{
                      padding: "18px 14px", borderRadius: 12, border: "none",
                      background: selectedMarkdown && !isExtracting ? "var(--color-tint-cyan)" : "var(--color-surface)",
                      color: selectedMarkdown && !isExtracting ? CYAN : "var(--color-muted)",
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
