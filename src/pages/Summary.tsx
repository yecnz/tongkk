import { SourceCitationContext } from "../features/sources/citationContext";
import BrandLogo from "../components/BrandLogo";
import ModalDialog from '../components/ModalDialog';
import { Button, PageHeading } from '../components/ui';
import { PreparationOptions } from "../features/preparation/PreparationPanel";
import { prepareUploadedMaterials, type PreparationKind } from "../services/preparation";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, pageRoutes, SidebarIcon, Sidebar, Card, useSidebarOpen } from "../common";
import { useTutorial } from "../TutorialContext";
import { TutorialHelpButton } from "../components/TutorialHelpButton";
import { summarizeWithTemplate, type SummaryTemplate } from "../services/gpt";
import { resolveSummaryRequest } from "../services/summaryGeneration";
import { summarizeWithTemplateStream } from "../services/summaryStream";
import { useAuth } from "../AuthContext";
import { useSampleDemo } from "../SampleDemoContext";
import { useToast } from "../ToastContext";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";
import { getPdfPageCount } from "../services/pdfPageCount";
import { loadSummariesFromServer, saveSummaryToServer, type SavedSummary } from "../services/summaries";
import type { SavedQuizSet } from "../services/quizSets";
import { combineMaterialsMarkdown, deleteCourseMaterialFromServer, getFileMaterialId, loadCourseMaterialsFromServer, saveCourseMaterials, uploadCourseMaterialFile, MAX_ORIGINAL_FILE_BYTES, type CourseMaterial } from "../services/materials";
import { MaterialDeleteConfirmModal } from "../components/MaterialDeleteConfirmModal";
import { hasPageMarkers } from "../utils/pageMarkers";
import { saveResumePoint } from "../services/dashboardState";
import { MaterialDetailView } from "./summary/MaterialDetailView";
import { SummaryResultView } from "./summary/SummaryResultView";
import { TemplateSelectView } from "./summary/TemplateSelectView";
import type { MaterialDetailTab, UploadFailureKind } from "./summary/types";
import { classifyUploadFailure, formatHubDate, summaryTypeIcon, templateLabels } from "./summary/utils";

type FileKind = "pdf" | "ppt" | "img" | "file";

type SummaryView = "upload" | "materialList" | "templates" | "summaryResult" | "materialDetail";

type UploadedFile = { name: string; size: number; type: FileKind; pages: number | null; slides: number | null; rawFile: File };

type DuplicateFileNotice = { names: string[]; reattached?: boolean };

type UploadStatusState = "uploading" | "extracting" | "previewing" | "storing" | "done" | "duplicate" | "failed";

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

const FileIcon = ({ type }: FileIconProps) => {
  // 파일 타입은 라벨(PDF/PPT/IMG)로 구분하고 색은 무채색으로 통일한다.
  // 색 신호는 선택(핑크)·학습(시안)·삭제(빨강)에만 남기고,
  // 파일 뱃지는 작은 문서 아이콘으로 밋밋함을 덜어준다.
  const labels: Record<FileKind, string> = { pdf: "PDF", ppt: "PPT", img: "IMG", file: "FILE" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
      minWidth: 46, height: 28, padding: "0 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
      color: "var(--color-text-secondary)", background: "var(--color-muted-surface)",
      border: "1px solid var(--color-border-soft)", boxSizing: "border-box",
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      </svg>
      {labels[type] || "FILE"}
    </span>
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
  ["pdf", "ppt", "pptx", "docx", "txt", "md", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes((file.name.split(".").pop() || "").toLowerCase());

// txt/md는 파일 내용이 곧 본문이므로 서버 변환 없이 그대로 읽는다.
const isPlainTextFile = (name: string) => ["txt", "md"].includes((name.split(".").pop() || "").toLowerCase());

const extractMarkdownFromMaterialFile = (file: File) =>
  isPlainTextFile(file.name) ? file.text() : extractMarkdownFromPDF(file);

const getFileNameKey = (name: string) => name.trim().toLowerCase();

const getUploadStatusId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const upsertUploadStatus = (statuses: UploadFileStatus[], nextStatus: UploadFileStatus) => {
  const index = statuses.findIndex(status => status.id === nextStatus.id);
  if (index < 0) return [nextStatus, ...statuses].slice(0, 8);
  return statuses.map(status => status.id === nextStatus.id ? { ...status, ...nextStatus } : status);
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
  materialDetail: "material",
};

const URL_TOKEN_TO_VIEW: Record<string, SummaryView> = {
  upload: "upload",
  list: "upload",
  templates: "templates",
  summary: "summaryResult",
  quiz: "upload", // Legacy URLs return to the real material workflow.
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

// 마지막으로 사용한 요약 템플릿을 기억해 다음 생성의 기본값으로 쓴다.
const LAST_SUMMARY_TEMPLATE_KEY = "tongkk:lastSummaryTemplate";

const readLastSummaryTemplate = (): SummaryTemplate => {
  try {
    const raw = localStorage.getItem(LAST_SUMMARY_TEMPLATE_KEY);
    return raw && raw in templateLabels ? (raw as SummaryTemplate) : "GENERAL";
  } catch {
    return "GENERAL";
  }
};

const writeLastSummaryTemplate = (template: SummaryTemplate) => {
  try {
    localStorage.setItem(LAST_SUMMARY_TEMPLATE_KEY, template);
  } catch {
    // noop
  }
};

// 기본 선택 자료: 전체가 아니라 가장 최근 업로드 1개. 여러 자료를 한 번에 요약하면
// 출력 한도 때문에 내용이 줄어들어, 앱 스스로도 한 개씩 요약을 권장한다.
const latestMaterialIds = (list: CourseMaterial[]) =>
  list.length === 0 ? [] : [list.reduce((latest, item) => (item.updatedAt > latest.updatedAt ? item : latest)).id];

// 새로고침 복원 중 보여줄 스켈레톤. 자료 상세 화면(헤더·탭·본문)의 뼈대를 회색 박스로 흉내내,
// 빈 화면 깜빡임 없이 "곧 자료가 뜬다"는 인상을 준다.
// 펄스 애니메이션·reduced-motion 대응은 공용 .tongkk-skeleton-block(src/index.css)을 따른다.
const RestoreSkeleton = () => {
  const sk = (style: CSSProperties) => (
    <div className="tongkk-skeleton-block" style={style} />
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 24px", borderBottom: "1px solid var(--color-border-soft)" }}>
        {sk({ width: 190, height: 22 })}
        {sk({ width: 110, height: 34, marginLeft: "auto", borderRadius: 10 })}
        {sk({ width: 110, height: 34, borderRadius: 10 })}
      </div>
      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "18px 20px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {sk({ flex: 1, height: 44, borderRadius: 12 })}
          {sk({ flex: 1, height: 44, borderRadius: 12 })}
          {sk({ flex: 1, height: 44, borderRadius: 12 })}
        </div>
        <div style={{ border: `1px solid ${BORDER_COLOR}`, borderRadius: 14, padding: 24 }}>
          {sk({ width: "35%", height: 22, marginBottom: 18 })}
          {sk({ width: "100%", height: 13, marginBottom: 12 })}
          {sk({ width: "96%", height: 13, marginBottom: 12 })}
          {sk({ width: "90%", height: 13, marginBottom: 12 })}
          {sk({ width: "78%", height: 13, marginBottom: 12 })}
          {sk({ width: "86%", height: 13 })}
        </div>
      </div>
    </>
  );
};

export default function Summary() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { showToast } = useToast();
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
  const [sidebar, setSidebar] = useSidebarOpen();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searched, setSearched] = useState(Boolean(initialCourse));
  const [selectedCourse] = useState(initialCourse);
  const [autoPreparationKinds, setAutoPreparationKinds] = useState<PreparationKind[]>([]);
  const [preparationNotice, setPreparationNotice] = useState('');
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [textMaterialTitle, setTextMaterialTitle] = useState("");
  const [textMaterialContent, setTextMaterialContent] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<UploadedFile[]>([]);

  // 초기 view를 URL의 view와 일치시킨다. upload로 시작하면 복원되기 전에 URL 동기화가
  // 새로고침 URL(view=material 등)을 upload로 덮어써, 복원에 쓸 material id가 날아간다.
  const [view, setView] = useState<SummaryView>(restoreFromUrl && urlView ? urlView : "upload");
  // 새로고침(URL 복원) 시 자료를 불러오는 동안 스켈레톤(콘텐츠 뼈대)을 보여준다. 복원이 끝나면 끈다.
  const [restoringFromUrl, setRestoringFromUrl] = useState(restoreFromUrl);

  // 업로드 화면이 실제로 떠 있을 때만(복원 스켈레톤 중 아님) 자료 요약 튜토리얼을 노출한다.
  // 게스트·과목 미선택은 위에서 대시보드로 리다이렉트되므로 여기 도달하면 안전하다.
  const { ready: readyTutorial, maybeShow } = useTutorial();
  const { openSampleDemo } = useSampleDemo();
  useEffect(() => {
    if (view === "upload" && !restoringFromUrl) readyTutorial("summary-upload");
  }, [view, restoringFromUrl, readyTutorial]);
  const [selectedTemplate, setSelectedTemplate] = useState<SummaryTemplate | null>(null);
  const [activeSummaryId, setActiveSummaryId] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [summaryPages, setSummaryPages] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  // 과목의 기존 요약 목록 — 자료별 "요약 N" 배지와 중복 생성 확인에 쓴다.
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [activeMaterial, setActiveMaterial] = useState<CourseMaterial | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  // 요약 진입 화면의 "요약 설정"(퀴즈 설정처럼)에서 고른 값. 하단 "요약 생성하기"가 이 값으로 바로 생성한다.
  const [summaryTemplate, setSummaryTemplate] = useState<SummaryTemplate>(readLastSummaryTemplate);
  // 요약 종류는 사용자가 직접 고르기 전까지 미선택 상태로 둔다(기본값으로 무심코 생성하는 것 방지).
  const [templatePicked, setTemplatePicked] = useState(false);
  const [summaryPageRange, setSummaryPageRange] = useState("");
  const [summaryFocusPrompt, setSummaryFocusPrompt] = useState("");
  // 같은 자료·템플릿 요약이 이미 있을 때 "기존 요약 보기 / 새로 생성"을 묻는 모달.
  const summaryCommandRef = useRef(false);
  const pendingSummarySave = useRef<{ course: string; summary: SavedSummary } | null>(null);
  const [duplicateSummaryPrompt, setDuplicateSummaryPrompt] = useState<SavedSummary | null>(null);
  const [materialDetailInitialTab, setMaterialDetailInitialTab] = useState<MaterialDetailTab>("original");
  // 요약을 막 완성하면 자료 상세의 '요약' 탭으로 착지한다(handleTemplateSelect). 그 순간
  // '만든 요약으로 학습하기'(원본·요약·퀴즈 탭) 안내를 1회 노출한다. maybeShow가 열람·인증·중복을
  // 모두 가드하므로, 단순히 요약 탭으로 진입할 때마다 호출해도 안전하다(이미 봤으면 무시).
  useEffect(() => {
    if (view === "materialDetail" && materialDetailInitialTab === "summary") maybeShow("summary-result");
  }, [view, materialDetailInitialTab, maybeShow]);
  const [activeMaterialTab, setActiveMaterialTab] = useState<MaterialDetailTab>("original");
  const [materialDetailTutorQuestion, setMaterialDetailTutorQuestion] = useState("");
  const [materialDetailReviewContext, setMaterialDetailReviewContext] = useState("");
  const [materialDetailReviewTitle, setMaterialDetailReviewTitle] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [duplicateNotice, setDuplicateNotice] = useState<DuplicateFileNotice | null>(null);
  // 50MB 초과로 원본을 저장하지 못한 파일들을 모아 가운데 모달로 안내.
  const [sizeLimitNotice, setSizeLimitNotice] = useState<{ names: string[] } | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<UploadFileStatus[]>([]);
  const [agentThreadId, setAgentThreadId] = useState("");
  const [resultBackView, setResultBackView] = useState<SummaryView>("templates");
  // 마지막 요약 생성 인자 — 실패 시 재시도용.
  const lastSummaryArgsRef = useRef<{ template: SummaryTemplate; opts?: { pageRange?: string; focusPrompt?: string }; backView: SummaryView } | null>(null);
  // 요약 생성은 화면을 떠나도 계속 진행된다. 완료 시점에 사용자가 결과 화면을 보고
  // 있는지(viewRef), 아예 다른 페이지로 떠났는지(isMountedRef)를 보고 토스트로 알린다.
  const viewRef = useRef<SummaryView>("upload");
  const isMountedRef = useRef(true);
  // templates(템플릿 선택) 화면에서 "돌아가기" 시 돌아갈 화면.
  // 자료 상세에서 진입하면 materialDetail, 그 외에는 upload(과목 자료)로 돌아간다.
  const [templatesBackView, setTemplatesBackView] = useState<SummaryView>("upload");
  // 자료 상세에서 "돌아가기"가 강의 자료 목록(upload 뷰)으로 가야 하는지.
  // 목록을 거쳐 들어왔거나(요약 생성·자료 카드 클릭) 과목 안에서 이동한 경우 true,
  // 대시보드에서 자료로 곧장 진입(딥링크)한 경우 false → 대시보드로 돌아간다.
  const [materialDetailBackToList, setMaterialDetailBackToList] = useState(false);
  const [pendingTutorQuestion] = useState(
    shouldRestoreLocationView ? locationState?.tutorQuestion || "" : "",
  );
  const selectedMaterials = materials.filter(material => selectedMaterialIds.includes(material.id));
  // 전체 선택 버튼 하나로 토글: 전부 선택돼 있으면 해제, 아니면 전체 선택.
  const allMaterialsSelected = materials.length > 0 && selectedMaterials.length === materials.length;
  const selectedMarkdown = combineMaterialsMarkdown(selectedMaterials);
  // 선택 자료에 페이지 마커가 하나도 없으면 '반영할 페이지'가 동작하지 않으므로 입력을 막고 안내한다.
  const selectedHasPageMarkers = selectedMaterials.some(material => hasPageMarkers(material.markdown));
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
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // 새로고침/직접 URL 진입(initial route entry)이면 handoff 소비를 건너뛰고 URL 기반 복원에 맡긴다.
    // 이때 보존된 location.state를 handoff로 오인해 navigate로 URL을 초기화하면, 요약/자료 상세가
    // 잠깐 떴다가 material 정보를 잃고 upload로 떨어진다. 다른 페이지에서 막 넘어온 경우에만 소비한다.
    if (isInitialRouteEntryRef.current) return;
    if (!locationState?.openSummary && !locationState?.viewMaterial && !locationState?.createSummary) return;
    navigate(pageRoutes["자료 요약"], {
      replace: true,
      state: initialCourse ? { selectedCourse: initialCourse, fromDashboard: locationState.fromDashboard } : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 게스트는 곧바로 대시보드로 리다이렉트되므로 조회하지 않는다(호출하면 인증 오류).
    if (!user || !selectedCourse) return;
    let ignore = false;

    Promise.all([
      loadCourseMaterialsFromServer(selectedCourse, { includeMarkdown: true }),
      loadSummariesFromServer(selectedCourse, { includeContent: true }),
    ])
      .then(([nextMaterials, nextSummaries]) => {
        if (ignore) return;
        setMaterials(nextMaterials);
        setSummaries(nextSummaries);
        const pendingMaterialId = pendingMaterialIdRef.current;
        if (pendingMaterialId) {
          pendingMaterialIdRef.current = "";
          // macOS 업로드 파일명은 NFD(자모 분리)라, URL을 거치며 자료 목록의 id와 유니코드 정규화가
          // 어긋날 수 있다(NFC vs NFD). NFC로 통일해 비교해야 새로고침 시 자료 상세가 복원된다
          // (아니면 자료를 못 찾아 upload로 폴백됨).
          const normalizedPendingId = pendingMaterialId.normalize("NFC");
          const material = nextMaterials.find(item => item.id.normalize("NFC") === normalizedPendingId);
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
            // 딥링크/대시보드에서 자료로 곧장 진입한 경우 — 목록을 거치지 않았으므로
            // 돌아가기는 (대시보드 진입이면) 대시보드로 간다.
            setMaterialDetailBackToList(false);
            setView("materialDetail");
            return;
          }
        }

        if (pendingCreateSummaryRef.current) {
          pendingCreateSummaryRef.current = false;
          const validMaterialIds = pendingMaterialIdsRef.current.filter(id => nextMaterials.some(material => material.id === id));
          pendingMaterialIdsRef.current = [];
          setSelectedMaterialIds(validMaterialIds.length > 0 ? validMaterialIds : latestMaterialIds(nextMaterials));
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
          const matchingSummaries = nextSummaries
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
            : latestMaterialIds(nextMaterials);
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
      })
      .finally(() => {
        if (!ignore) setRestoringFromUrl(false);
      });

    return () => {
      ignore = true;
    };
  }, [user, selectedCourse]);

  // 보던 화면을 URL(위치)과 세션(세부)에 반영해 새로고침/딥링크 복원을 지원한다.
  // state -> URL/세션 단방향 동기화이며, replace로 갱신해 히스토리를 더럽히지 않는다.
  useEffect(() => {
    // 게스트는 아래 가드의 <Navigate>가 대시보드로 보내는 중 — 여기서 setSearchParams(replace)를
    // 호출하면 같은 커밋의 리다이렉트를 덮어써 /summary에 갇히므로 동기화를 건너뛴다.
    if (!user) return;
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

  // 대시보드 "이어서 하기"용으로 마지막에 보던 자료·요약을 저장한다(같은 값이면 저장 생략).
  useEffect(() => {
    if (!user || !selectedCourse) return;
    if (view === "materialDetail" && activeMaterial) {
      const tabLabel = { original: "자료 보는 중", summary: "요약 보는 중", quiz: "퀴즈 기록 보는 중" }[activeMaterialTab];
      saveResumePoint({
        route: "/summary",
        course: selectedCourse,
        title: activeMaterial.name,
        activity: tabLabel,
        state: { selectedCourse, fromDashboard: true, viewMaterial: true, materialId: activeMaterial.id, materialDetailTab: activeMaterialTab },
      });
    } else if (view === "summaryResult" && activeSummaryId && selectedTemplate) {
      saveResumePoint({
        route: "/summary",
        course: selectedCourse,
        title: activeMaterial?.name || selectedCourse,
        activity: `${templateLabels[selectedTemplate]} 요약 보는 중`,
        state: { selectedCourse, fromDashboard: true, openSummary: true, summaryId: activeSummaryId, summaryTemplate: selectedTemplate, materialIds: selectedMaterialIds },
      });
    }
  }, [user, view, selectedCourse, activeMaterial, activeMaterialTab, activeSummaryId, selectedTemplate, selectedMaterialIds]);

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
      message: "기존 자료 확인 및 원본 연결 중",
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
            message: "원본 파일 연결 중",
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
            message: "이미 등록된 자료입니다. 기존 자료를 사용합니다.",
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
      message: "파일 확인 중",
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
            message: "자료 내용 추출 중",
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
                message: "자료 저장 중",
                materialId: baseMaterial.id,
              });
              try {
                const savedMaterial = await uploadCourseMaterialFile(selectedCourse, baseMaterial, documentFile);
                uploadedMaterials.push(savedMaterial);
                updateUploadStatus(documentFile, {
                  state: "done",
                  label: "완료",
                  message: "자료를 업로드했습니다.",
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
        setPreparationNotice(await prepareUploadedMaterials(selectedCourse, uploadedMaterials, autoPreparationKinds));
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
      setPreparationNotice(await prepareUploadedMaterials(selectedCourse, [material], autoPreparationKinds));
      setTextMaterialTitle("");
      setTextMaterialContent("");
      setSearched(true);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "텍스트 자료 추가 실패");
    }
  };

  // 자료 삭제 확인 모달 대상과 진행·오류 상태. 요약/퀴즈 삭제 모달과 같은 패턴.
  // pendingMaterialDelete: 단일 자료 삭제 대상, pendingBulkDelete: 요약 설정 화면에서 선택한 여러 자료 일괄 삭제.
  const [pendingMaterialDelete, setPendingMaterialDelete] = useState<CourseMaterial | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [materialDeleteBusy, setMaterialDeleteBusy] = useState(false);
  const [materialDeleteError, setMaterialDeleteError] = useState("");

  // 서버에서 자료를 지운 뒤 화면 상태(자료 목록·선택·요약 배지·업로드 파일)에서도 함께 치운다.
  // 단일 삭제와 일괄 삭제가 같은 정리 로직을 공유한다.
  const purgeDeletedMaterialsFromState = (deletedMaterials: CourseMaterial[]) => {
    if (deletedMaterials.length === 0) return;
    const deletedIds = new Set(deletedMaterials.map(item => item.id));
    const deletedNameKeys = new Set(deletedMaterials.map(item => getFileNameKey(item.name)));
    setMaterials(prev => prev.filter(item => !deletedIds.has(item.id)));
    setSelectedMaterialIds(prev => prev.filter(id => !deletedIds.has(id)));
    // 자료와 함께 지워진 요약을 목록에서도 빼 "요약 N" 배지를 맞춘다.
    setSummaries(prev => prev.filter(summary => !summary.materialIds?.some(id => deletedIds.has(id))));
    setFiles(prev => {
      const nextFiles = prev.filter(file =>
        !deletedIds.has(getFileMaterialId(file)) &&
        !deletedNameKeys.has(getFileNameKey(file.name))
      );
      filesRef.current = nextFiles;
      return nextFiles;
    });
  };

  // × 버튼·자료 상세의 삭제 버튼은 바로 지우지 않고 확인 모달을 연다(Storage 원본까지 지워져 복구 불가).
  const requestDeleteMaterial = (material: CourseMaterial) => {
    setMaterialDeleteError("");
    setPendingMaterialDelete(material);
  };

  const closeDeleteMaterial = () => {
    if (materialDeleteBusy) return; // 삭제 진행 중에는 닫지 않는다.
    setPendingMaterialDelete(null);
    setMaterialDeleteError("");
  };

  const confirmDeleteMaterial = async () => {
    const material = pendingMaterialDelete;
    if (!material || !selectedCourse) return;

    setMaterialDeleteBusy(true);
    setMaterialDeleteError("");
    try {
      // 자료 본체와 파생 데이터(요약·튜터 대화·원본 파일)를 한 번에 정리한다. 퀴즈는 남긴다.
      await deleteCourseMaterialFromServer(selectedCourse, material.id);
      purgeDeletedMaterialsFromState([material]);
      setPendingMaterialDelete(null);
      // 상세 화면에서 지웠다면 더 볼 자료가 없으므로 목록(또는 대시보드 출발이면 대시보드)으로 돌아간다.
      if (view === "materialDetail" && activeMaterial?.id === material.id) {
        if (fromDashboardRef.current) navigate(pageRoutes["대시보드"]);
        else setView("upload");
      }
      showToast("자료를 삭제했습니다.", "info");
    } catch (err) {
      setMaterialDeleteError(err instanceof Error ? err.message : "강의자료 삭제에 실패했습니다.");
    } finally {
      setMaterialDeleteBusy(false);
    }
  };

  // 요약 설정 화면의 "선택 삭제" 버튼 → 선택한 자료를 한 번에 지운다.
  const requestBulkDeleteMaterials = () => {
    if (selectedMaterials.length === 0) return;
    setMaterialDeleteError("");
    setPendingBulkDelete(true);
  };

  const closeBulkDeleteMaterials = () => {
    if (materialDeleteBusy) return; // 삭제 진행 중에는 닫지 않는다.
    setPendingBulkDelete(false);
    setMaterialDeleteError("");
  };

  const confirmBulkDeleteMaterials = async () => {
    if (!selectedCourse) return;
    const targets = selectedMaterials; // 모달이 오버레이로 클릭을 막는 동안 선택은 고정된다.
    if (targets.length === 0) return;

    setMaterialDeleteBusy(true);
    setMaterialDeleteError("");

    // 순차 삭제: 일부가 실패해도 성공분은 화면에 반영하고, 첫 실패 지점에서 멈춰 남은 선택분을 다시 시도하게 한다.
    const deleted: CourseMaterial[] = [];
    let failure: { name: string; message: string } | null = null;
    for (const material of targets) {
      try {
        await deleteCourseMaterialFromServer(selectedCourse, material.id);
        deleted.push(material);
      } catch (err) {
        failure = { name: material.name, message: err instanceof Error ? err.message : "삭제에 실패했습니다." };
        break;
      }
    }

    purgeDeletedMaterialsFromState(deleted);
    setMaterialDeleteBusy(false);

    if (failure) {
      setMaterialDeleteError(
        deleted.length > 0
          ? `${deleted.length}개를 삭제한 뒤 '${failure.name}'에서 멈췄어요: ${failure.message}`
          : `'${failure.name}' 삭제에 실패했어요: ${failure.message}`
      );
      return; // 모달을 열어둔 채 남은 선택분을 다시 시도하게 한다.
    }

    setPendingBulkDelete(false);
    showToast(`자료 ${deleted.length}개를 삭제했어요.`, "info");
  };

  const handleTemplateSelect = async (template: SummaryTemplate, opts?: { pageRange?: string; focusPrompt?: string }, backView: SummaryView = "templates", force = false) => {
    if (summaryCommandRef.current) return;
    // 실패 시 "같은 설정으로 다시 시도"가 마지막 생성 인자를 그대로 재사용한다.
    lastSummaryArgsRef.current = { template, opts, backView };
    writeLastSummaryTemplate(template);
    setSelectedTemplate(template);
    setSummaryPages(opts?.pageRange || ""); // 요약에 쓴 페이지 범위를 보관해 튜터의 원본 본문도 같은 범위로 좁힌다.
    setSummaryError("");

    if (selectedMarkdown) {
      summaryCommandRef.current = true;
      pendingSummarySave.current = null;
      setIsSummarizing(true);
      setSummaryText("");
      setActiveSummaryId(null);
      setSummaryError("");
      setElapsedTime(null);
      setAgentThreadId("");
      setResultBackView(backView);
      // 완료 토스트의 "보러 가기"가 페이지 재진입 후 이 요약을 다시 열 수 있도록 생성 인자를 붙잡아 둔다.
      const generatedMaterialIds = [...selectedMaterialIds];
      const startTime = Date.now();
      try {
        const { identity, existing } = await resolveSummaryRequest(selectedCourse, selectedMarkdown, selectedMaterials, template, opts, force);
        if (existing) { setDuplicateSummaryPrompt(existing); return; }
        const generationId = crypto.randomUUID();
        // 요약 성공 시 자료 상세로 이동했는지 표시. 이동하지 못하면 결과 화면으로 폴백한다.
        let movedToDetail = false;
        setLoadingStep(`${templateLabels[template]} 형식으로 요약 작성 중...`);
        let response: { result: string; threadId: string };
        if (template === "MINDMAP") {
          // 마인드맵은 JSON 출력이라 부분 렌더링이 불가능해 기존 단일 호출을 유지한다.
          response = await summarizeWithTemplate(selectedMarkdown, template, {
            pages: opts?.pageRange,
            focusPrompt: opts?.focusPrompt,
            sourceNames: selectedMaterials.map(material => material.name),
          });
        } else {
          // 스트리밍 경로: 결과 화면으로 먼저 이동해 생성 중인 텍스트를 타자기처럼 보여준다.
          setView("summaryResult");
          const result = await summarizeWithTemplateStream(selectedMarkdown, template, {
            pages: opts?.pageRange,
            focusPrompt: opts?.focusPrompt,
            sourceNames: selectedMaterials.map(material => material.name),
            onDelta: text => setSummaryText(text),
            onProgress: (chunkIndex, chunkTotal) => setLoadingStep(
              chunkTotal > 1
                ? `${templateLabels[template]} 작성 중... (${chunkIndex}/${chunkTotal} 구간)`
                : `${templateLabels[template]} 형식으로 요약 작성 중...`,
            ),
          });
          response = { result, threadId: "" };
        }
        setSummaryText(response.result);
        setAgentThreadId(response.threadId);
        let persistedId: string | undefined;
        let persistedAt = Date.now();
        if (selectedCourse) {
          setLoadingStep("요약 저장 중...");
          const selectedMaterialNames = selectedMaterials.map(material => material.name);
          const savedSummary = {
            template,
            content: response.result,
            createdAt: Date.now(),
            materialIds: generatedMaterialIds,
            materialNames: selectedMaterialNames,
            pageRange: opts?.pageRange,
            focusPrompt: opts?.focusPrompt,
            sourceHash: identity.source_hash, requestKey: identity.request_key,
            generationConfig: identity.generation_config, generationId,
          };
          pendingSummarySave.current = { course: selectedCourse, summary: savedSummary };
          const persistedSummary = await saveSummaryToServer(selectedCourse, savedSummary);
          pendingSummarySave.current = null;
          setActiveSummaryId(persistedSummary.id || null);
          persistedId = persistedSummary.id;
          persistedAt = persistedSummary.createdAt;
          // 자료별 "요약 N" 배지·중복 생성 확인이 새 요약을 바로 반영하도록 목록을 갱신한다.
          setSummaries(prev => [persistedSummary, ...prev.filter(item => item.id !== persistedSummary.id)]);
          // 요약 성공 → 결과 전용 화면(summaryResult)을 건너뛰고 자료 상세의 요약 탭으로 이동한다.
          const targetMaterial = selectedMaterials[0];
          if (targetMaterial) {
            setActiveMaterial(targetMaterial);
            setMaterialDetailInitialTab("summary");
            // 방금 만든 자료의 상세를 보여준 뒤 "돌아가기"는 강의 자료 목록으로.
            setMaterialDetailBackToList(true);
            setView("materialDetail");
            movedToDetail = true;
          }
        }
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(1));
        // 생성을 기다리지 않고 다른 화면으로 이동한 경우 완료를 토스트로 알린다.
        if (!isMountedRef.current) {
          showToast("요약이 완성됐어요.", "success", {
            duration: 10000,
            action: {
              label: "보러 가기",
              onAction: () => navigate(pageRoutes["자료 요약"], {
                state: {
                  selectedCourse,
                  fromDashboard: fromDashboardRef.current,
                  openSummary: true,
                  summaryId: persistedId,
                  summaryTemplate: template,
                  summaryContent: response.result,
                  summaryCreatedAt: persistedAt,
                  materialIds: generatedMaterialIds,
                },
              }),
            },
          });
        } else if (!movedToDetail) {
          // 코스·자료 정보가 없어 자료 상세로 못 갈 때만 결과 화면으로 폴백한다.
          setView("summaryResult");
        }
      } catch (err) {
        const message = pendingSummarySave.current ? '요약은 완성됐지만 저장하지 못했어요. 다시 시도하면 저장만 재시도해요.'
          : err instanceof Error ? err.message : "요약 실패";
        setSummaryError(message);
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(1));
        if (!isMountedRef.current) {
          showToast(`요약 생성에 실패했어요: ${message}`, "error", { duration: 10000 });
        } else {
          setView("summaryResult"); // 실패 시에만 에러·재시도를 결과 화면에서 보여준다.
        }
      } finally {
        summaryCommandRef.current = false;
        setIsSummarizing(false);
        setLoadingStep("");
      }
    } else {
      setSummaryText("");
      setActiveSummaryId(null);
      setView("summaryResult");
    }
  };

  const settingsSummaryOptions = { pageRange: selectedHasPageMarkers ? summaryPageRange : "", focusPrompt: summaryFocusPrompt };
  const startSummaryFromSettings = (force = false) => {
    void handleTemplateSelect(summaryTemplate, settingsSummaryOptions, "upload", force);
  };
  const handleGenerateFromSettings = () => startSummaryFromSettings();

  const retrySummarySave = async () => {
    const pending = pendingSummarySave.current;
    if (!pending || summaryCommandRef.current) return;
    summaryCommandRef.current = true; setIsSummarizing(true); setSummaryError('');
    try {
      const saved = await saveSummaryToServer(pending.course, pending.summary);
      pendingSummarySave.current = null;
      setActiveSummaryId(saved.id || null);
      setSummaries(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
    } catch { setSummaryError('요약을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { summaryCommandRef.current = false; setIsSummarizing(false); }
  };

  const openExistingSummary = (summary: SavedSummary) => {
    setSelectedTemplate(summary.template);
    setActiveSummaryId(summary.id || null);
    setSummaryText(summary.content);
    setSummaryPages(summary.pageRange || "");
    setSummaryPageRange(summary.pageRange || "");
    setSummaryFocusPrompt(summary.focusPrompt || "");
    setIsSummarizing(false);
    setSummaryError("");
    setElapsedTime(null);
    setLoadingStep("");
    setAgentThreadId("");
    setResultBackView("upload");
    setView("summaryResult");
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

  // 게스트는 핸드오프를 받을 경로가 없다 — URL 딥링크(/summary?course=X)로 들어와도 대시보드로.
  if (!user || !selectedCourse) return <Navigate to={pageRoutes["대시보드"]} replace />;

  return (
    <div className="tongkk-soft-surface" style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* 새로고침 복원 중 — 빈 화면 대신 자료 상세 모양의 스켈레톤을 덮어 덜 답답하게 한다. */}
      {restoringFromUrl && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: PAGE_BACKGROUND, overflowY: "auto" }}>
          <RestoreSkeleton />
        </div>
      )}
      {sidebar && <Sidebar active="자료 요약" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sizeLimitNotice && (
        <ModalDialog labelledBy="original-limit-heading" onClose={() => setSizeLimitNotice(null)} width={380} closeOnBackdrop>
          <div className="ui-modal-body">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{
                width: 36, height: 36, borderRadius: "50%", background: "var(--color-tint-yellow)", color: "var(--color-amber-deep)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, flexShrink: 0,
              }}>!</span>
              <h3 id="original-limit-heading" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-strong)" }}>원본은 저장하지 않았어요</h3>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6, color: "var(--color-text)" }}>
              아래 파일은 <b style={{ color: "var(--color-text-strong)" }}>50MB 저장 한도</b>를 넘어 원본을 저장하지 않았어요.{" "}
              <b style={{ color: "var(--color-text-strong)" }}>텍스트는 저장돼 요약·퀴즈에 그대로 사용</b>할 수 있습니다.
            </p>
            <div style={{
              margin: "0 0 14px", padding: "10px 12px", borderRadius: 10, background: "var(--color-page)",
              fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", wordBreak: "break-word", lineHeight: 1.5,
            }}>
              {sizeLimitNotice.names.join(", ")}
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 12, lineHeight: 1.5, color: "var(--color-muted)" }}>
              원본을 저장하려면 50MB 미만으로 나눠 업로드해 주세요.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" tone="cyan"
                onClick={() => setSizeLimitNotice(null)}
              >확인</Button>
            </div>
          </div>
        </ModalDialog>
      )}
      {duplicateSummaryPrompt && (
        <ModalDialog labelledBy="existing-summary-heading" onClose={() => setDuplicateSummaryPrompt(null)} width={420} closeOnBackdrop>
          <div className="ui-modal-body">
            <h3 id="existing-summary-heading" style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 700, color: "var(--color-text-strong)" }}>
              이미 만든 요약이 있습니다
            </h3>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.7, color: "var(--color-text)", wordBreak: "keep-all" }}>
              같은 자료·같은 설정의 <b style={{ color: "var(--color-text-strong)" }}>{templateLabels[duplicateSummaryPrompt.template]}</b> 요약을{" "}
              {formatHubDate(duplicateSummaryPrompt.createdAt)}에 만들었어요.
              새로 생성하면 <b style={{ color: "var(--color-text-strong)" }}>이전 요약도 그대로 보관돼요</b>.
            </p>
            <div style={{ display: "flex", flexWrap: 'wrap', justifyContent: "flex-end", gap: 8 }}>
              <Button
                onClick={() => {
                  setDuplicateSummaryPrompt(null);
                  startSummaryFromSettings(true);
                }}
              >새로 생성</Button>
              <Button variant="primary"
                onClick={() => {
                  const existing = duplicateSummaryPrompt;
                  setDuplicateSummaryPrompt(null);
                  if (existing) openExistingSummary(existing);
                }}
              >기존 요약 보기</Button>
            </div>
          </div>
        </ModalDialog>
      )}
      {duplicateNotice && (
        <div
          role="status"
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
            border: "1px solid color-mix(in srgb, var(--color-pink) 35%, transparent)",
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
                {duplicateNotice.reattached ? "기존 자료에 원본 파일을 다시 연결했습니다" : "이미 등록된 파일입니다"}
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
                  ? "원본 파일을 연결했습니다. 요약은 유지됩니다."
                  : "기존 자료를 그대로 사용할게요. 원본 파일 연결이 없던 자료는 다시 연결을 시도합니다."}
              </div>
            </div>
            <button type="button"
              className="tongkk-hover-dim"
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
        <button type="button" className="tongkk-hover-dim" onClick={() => setSidebar(!sidebar)} aria-label={sidebar ? "메뉴 닫기" : "메뉴 열기"} style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button type="button" className="brand-home tongkk-hover-fade" onClick={() => navigate("/")}><BrandLogo /></button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 자료 요약</span>
        <TutorialHelpButton tutorialKey="summary-upload" style={{ marginLeft: "auto" }} />
      </div>

      <div
        className={view === "summaryResult" || view === "materialDetail" ? "app-container wide" : "app-container"}
        // 넓은 뷰(요약 결과·자료 상세)는 기존의 더 촘촘한 여백을 유지한다(인라인이 클래스보다 우선).
        style={view === "summaryResult" || view === "materialDetail" ? { padding: "18px 20px" } : undefined}
      >
        {view === "templates" && (
          <TemplateSelectView onSelect={handleTemplateSelect} onBack={() => setView(templatesBackView)} pageHint={summaryPageHint} />
        )}

        {view === "summaryResult" && selectedTemplate && (
          <SourceCitationContext.Provider value={{ courseName: selectedCourse, materials, materialIds: summaries.find(summary => summary.id === activeSummaryId)?.materialIds || selectedMaterialIds }}>
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
            sourceMarkdown={selectedMaterials.map(m => `# ${m.name}\n\n${m.markdown}`).join("\n\n")}
            sourcePages={summaryPages}
            isLoading={isSummarizing}
            error={summaryError}
            loadingStep={loadingStep}
            elapsedTime={elapsedTime}
            threadId={agentThreadId}
            summaryId={activeSummaryId}
            resetTutorHistory={isInitialRouteEntryRef.current}
            initialTutorQuestion={pendingTutorQuestion}
            onGoToQuiz={selectedCourse ? handleGoToQuiz : undefined}
            onRetry={lastSummaryArgsRef.current ? () => {
              if (pendingSummarySave.current) { void retrySummarySave(); return; }
              const args = lastSummaryArgsRef.current;
              if (args) void handleTemplateSelect(args.template, args.opts, args.backView, true);
            } : undefined}
          />
          </SourceCitationContext.Provider>
        )}

        {view === "materialDetail" && activeMaterial && (
          <MaterialDetailView
            material={activeMaterial}
            selectedCourse={selectedCourse}
            onBack={() => {
              // 목록을 거쳐 들어왔으면 강의 자료 목록(upload 뷰)으로, 대시보드에서
              // 곧장 진입(딥링크)했으면 대시보드로 돌아간다.
              if (materialDetailBackToList && selectedCourse) setView("upload");
              else if (fromDashboardRef.current) navigate(pageRoutes["대시보드"]);
              else setView("upload");
            }}
            backLabel={materialDetailBackToList && selectedCourse ? "← 과목 자료로" : fromDashboardRef.current ? "← 대시보드로" : "← 과목 자료로"}
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
            onRequestDelete={() => requestDeleteMaterial(activeMaterial)}
          />
        )}

        {view === "upload" && selectedCourse && (
          <div>
            <PageHeading title={selectedCourse} description="자료를 올리고, 필요한 내용을 요약하거나 퀴즈로 학습하세요." />
            <Card className="learning-card"><p>업로드 후 함께 준비할 학습 자료</p><PreparationOptions value={autoPreparationKinds} onChange={setAutoPreparationKinds} />{preparationNotice && <p role="status">{preparationNotice}</p>}</Card>
            <button type="button" onClick={() => navigate(pageRoutes["대시보드"])} style={{
              background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
            }}>← 대시보드로</button>
              <Card style={{ padding: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {(["file", "text"] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={inputMode === mode}
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
                    className="tongkk-dropzone"
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      border: `2px dashed ${dragOver ? "color-mix(in srgb, var(--color-cyan) 40%, transparent)" : BORDER_COLOR}`,
                      borderRadius: 14, padding: "40px 20px", textAlign: "center",
                      cursor: "pointer", background: dragOver ? "var(--color-tint-cyan)" : MUTED_SURFACE,
                      transition: "all 0.2s", marginBottom: 20
                    }}
                  >
                    <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff"
                      onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                    <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-muted)" }}>강의자료 파일을 드래그하거나</p>
                    <button type="button" style={{
                      marginTop: 12, padding: "8px 20px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                      background: "var(--color-card)", fontSize: 13, cursor: "pointer", color: "var(--color-text)"
                    }}>파일 선택</button>
                    <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--color-muted)" }}>
                      어떤 결과가 나오는지 궁금하면{" "}
                      <button type="button" onClick={e => { e.stopPropagation(); openSampleDemo(); }} style={{
                        background: "none", border: "none", padding: 0, color: PINK, fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline",
                      }}>예시로 둘러보기</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    <label className="ui-field" htmlFor="text-material-title">자료 이름</label>
                    <input
                      id="text-material-title"
                      className="ui-input"
                      value={textMaterialTitle}
                      onChange={e => setTextMaterialTitle(e.target.value)}
                      placeholder="자료 이름 (예: 3주차 강의 노트)"
                    />
                    <label className="ui-field" htmlFor="text-material-content">자료 내용</label>
                    <textarea
                      id="text-material-content"
                      className="ui-input"
                      value={textMaterialContent}
                      onChange={e => setTextMaterialContent(e.target.value)}
                      placeholder="강의 스크립트나 노트를 붙여넣어 주세요..."
                      rows={8}
                      style={{ lineHeight: 1.6, resize: "vertical" }}
                    />
                    <Button variant="primary"
                      onClick={handleAddTextMaterial}
                      disabled={!textMaterialTitle.trim() || !textMaterialContent.trim()}
                    >
                      자료로 추가
                    </Button>
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
                        const tone = isFailed ? "var(--color-danger)" : isDone ? CYAN : isDuplicate ? "var(--color-amber-deep)" : status.state === "previewing" ? CYAN : PINK;
                        const background = isFailed ? "var(--color-tint-pink)" : isDone ? "var(--color-tint-cyan)" : isDuplicate ? "var(--color-tint-yellow)" : "var(--color-tint-pink)";
                        const linkedMaterial = status.materialId ? materials.find(material => material.id === status.materialId) : null;

                        return (
                          <div key={status.id} style={{
                            padding: 12,
                            borderRadius: 12,
                            border: `1px solid ${isFailed ? "color-mix(in srgb, var(--color-danger) 35%, transparent)" : "var(--color-border-soft)"}`,
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
                                      setMaterialDetailBackToList(true);
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
                  <div style={{
                    padding: "4px 0", fontSize: 13, color: "var(--color-text-secondary)",
                    marginBottom: 14, fontWeight: 500,
                  }}>
                    저장된 강의자료 {materials.length}개 중 {selectedMaterials.length}개가 요약에 반영됩니다
                  </div>
                )}

                {materials.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>
                        강의자료 선택
                      </h4>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => setSelectedMaterialIds(allMaterialsSelected ? [] : materials.map(material => material.id))} style={{ border: `1px solid ${BORDER_COLOR}`, background: "var(--color-card)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "var(--color-text-secondary)", cursor: "pointer" }}>{allMaterialsSelected ? "전체 해제" : "전체 선택"}</button>
                        <button
                          type="button"
                          onClick={requestBulkDeleteMaterials}
                          disabled={selectedMaterials.length === 0}
                          title={selectedMaterials.length === 0 ? "삭제할 자료를 먼저 선택해 주세요" : `선택한 자료 ${selectedMaterials.length}개 삭제`}
                          style={{
                            border: `1px solid ${selectedMaterials.length === 0 ? BORDER_COLOR : "color-mix(in srgb, var(--color-danger) 38%, transparent)"}`,
                            background: "var(--color-card)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800,
                            color: selectedMaterials.length === 0 ? "var(--color-muted)" : "var(--color-danger)",
                            cursor: selectedMaterials.length === 0 ? "default" : "pointer",
                            opacity: selectedMaterials.length === 0 ? 0.55 : 1,
                          }}
                        >
                          선택 삭제{selectedMaterials.length > 0 ? ` ${selectedMaterials.length}` : ""}
                        </button>
                      </div>
                    </div>
                    {materials.map(material => {
                      const isSelected = selectedMaterialIds.includes(material.id);
                      const materialSummaryCount = summaries.filter(summary => summary.materialIds?.includes(material.id)).length;
                      return (
                      <div
                        key={material.id}
                        className={isSelected ? undefined : "tongkk-hover-row"}
                        style={{
                          display: "flex", alignItems: "center", flexWrap: 'wrap', gap: 12, padding: "10px 12px",
                          background: isSelected ? "var(--color-muted-surface)" : "var(--color-card)",
                          border: "1px solid var(--color-border-soft)",
                          borderRadius: 10, marginBottom: 8,
                          transition: "background 0.15s, border-color 0.15s",
                        }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 200px', minWidth: 0, minHeight: 40, cursor: 'pointer' }}>
                          <input type="checkbox" className="tongkk-checkbox" checked={isSelected}
                            onChange={event => setSelectedMaterialIds(previous => event.target.checked
                              ? [...previous, material.id] : previous.filter(id => id !== material.id))} />
                          <FileIcon type={material.type} />
                          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: 14, fontWeight: 600, color: "var(--color-text-strong)" }}>{material.name}</span>
                        </label>
                        {materialSummaryCount > 0 && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setActiveMaterial(material);
                              setSelectedMaterialIds([material.id]);
                              setMaterialDetailInitialTab("summary");
                              setMaterialDetailTutorQuestion("");
                              setMaterialDetailReviewContext("");
                              setMaterialDetailReviewTitle("");
                              setMaterialDetailBackToList(true);
                              setView("materialDetail");
                            }}
                            title="이 자료의 기존 요약 보기"
                            style={{
                              height: 22, padding: "0 9px", borderRadius: 999, border: "none",
                              background: "var(--color-muted-surface)", color: "var(--color-text-secondary)",
                              fontSize: 11, fontWeight: 800, cursor: "pointer", flexShrink: 0,
                            }}
                          >
                            요약 {materialSummaryCount}
                          </button>
                        )}
                        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                          {material.pages ? `${material.pages}p` : material.slides ? `${material.slides}s` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setActiveMaterial(material);
                            setSelectedMaterialIds([material.id]);
                            // 학습은 공부 목적이므로 요약이 있으면 요약 탭부터, 없으면 원본 탭으로 연다.
                            setMaterialDetailInitialTab(materialSummaryCount > 0 ? "summary" : "original");
                            setMaterialDetailTutorQuestion("");
                            setMaterialDetailReviewContext("");
                            setMaterialDetailReviewTitle("");
                            setMaterialDetailBackToList(true);
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
                          onClick={e => { e.stopPropagation(); requestDeleteMaterial(material); }}
                          onMouseEnter={e => { e.currentTarget.style.color = "var(--color-danger)"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = "var(--color-muted)"; }}
                          aria-label={`${material.name} 삭제`}
                          title="자료 삭제"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            height: 26,
                            width: 28,
                            borderRadius: 8,
                            border: `1px solid ${BORDER_COLOR}`,
                            background: "var(--color-card)",
                            color: "var(--color-muted)",
                            cursor: "pointer",
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 7h16" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
                            <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
                          </svg>
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {searched && (
                <Card style={{ padding: 24, marginTop: 16 }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>요약 설정</h3>

                  <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", marginBottom: 8, display: "block" }}>요약 종류</label>
                  <div className="option-grid-4" style={{ marginBottom: 20 }}>
                    {([
                      { key: "GENERAL", name: "일반 요약", desc: "내용을 깔끔하게 정리" },
                      { key: "LECTURE_NOTE", name: "강의 노트", desc: "개념·흐름·시험 포인트" },
                      { key: "MINDMAP", name: "마인드맵", desc: "개념 관계를 구조화" },
                      { key: "CHEAT_SHEET", name: "치트시트", desc: "시험 직전 암기표" },
                    ] as const).map(t => {
                      const active = templatePicked && summaryTemplate === t.key;
                      return (
                        <button key={t.key} type="button"
                          aria-pressed={active}
                          onClick={() => { if (active) { setTemplatePicked(false); } else { setSummaryTemplate(t.key); setTemplatePicked(true); } }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--color-muted-surface)"; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.background = "var(--color-card)"; }}
                          style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                          padding: "12px 8px", borderRadius: 10,
                          border: active ? "1px solid color-mix(in srgb, var(--color-pink) 45%, transparent)" : "1px solid var(--color-border-soft)",
                          background: active ? "var(--color-tint-pink)" : "var(--color-card)",
                          cursor: "pointer", transition: "background 0.15s",
                        }}>
                          <span style={{ display: "flex", color: active ? PINK : "var(--color-muted)" }}>{summaryTypeIcon(t.key, 20)}</span>
                          <span style={{ fontSize: 14, fontWeight: active ? 800 : 700, color: active ? PINK : "var(--color-text-strong)" }}>{t.name}</span>
                          <span style={{ fontSize: 11.5, lineHeight: 1.4, textAlign: "center", color: "var(--color-text-secondary)" }}>{t.desc}</span>
                        </button>
                      );
                    })}
                  </div>

                  <label htmlFor="summary-page-range" className="ui-field" style={{ marginBottom: 8 }}>
                    반영할 페이지
                  </label>
                  {selectedHasPageMarkers ? (
                    <input
                      id="summary-page-range"
                      className="ui-input"
                      value={summaryPageRange}
                      onChange={e => setSummaryPageRange(e.target.value)}
                      placeholder={summaryPageHint ? `예: 1-5, 8  (${summaryPageHint})` : "예: 1-5, 8"}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)", marginBottom: 16 }}
                    />
                  ) : (
                    <div style={{ padding: "10px 12px", borderRadius: 10, background: MUTED_SURFACE, fontSize: 12.5, lineHeight: 1.6, color: "var(--color-text-secondary)", marginBottom: 16 }}>
                      {selectedMaterials.length > 0
                        ? "페이지 정보가 없습니다. 파일을 다시 업로드해 주세요."
                        : "자료를 선택해 페이지 범위를 지정해 주세요."}
                    </div>
                  )}

                  <label htmlFor="summary-focus" className="ui-field" style={{ marginBottom: 8 }}>
                    집중할 내용
                  </label>
                  <textarea
                    id="summary-focus"
                    className="ui-input"
                    value={summaryFocusPrompt}
                    onChange={e => setSummaryFocusPrompt(e.target.value)}
                    placeholder="예: 시험에 나올 핵심 정의와 공식 위주로 정리해줘"
                    rows={2}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
                  />
                </Card>
              )}

              {searched && (
                <Button variant="primary"
                  onClick={handleGenerateFromSettings}
                  disabled={!selectedMarkdown || isExtracting || isSummarizing || !templatePicked}
                  busy={isExtracting || isSummarizing}
                  style={{ width: '100%', marginTop: 16 }}
                >
                  {isExtracting ? "자료 분석 중..." : isSummarizing ? "요약 생성 중..." : !templatePicked ? "요약 종류를 선택해 주세요" : "요약 생성하기"}
                </Button>
              )}
          </div>
        )}
      </div>
      {pendingMaterialDelete && (
        <MaterialDeleteConfirmModal
          materialName={pendingMaterialDelete.name}
          summaryCount={summaries.filter(summary => summary.materialIds?.includes(pendingMaterialDelete.id)).length}
          busy={materialDeleteBusy}
          error={materialDeleteError}
          onCancel={closeDeleteMaterial}
          onConfirm={confirmDeleteMaterial}
        />
      )}
      {pendingBulkDelete && (
        <MaterialDeleteConfirmModal
          materialCount={selectedMaterials.length}
          summaryCount={summaries.filter(summary => summary.materialIds?.some(id => selectedMaterialIds.includes(id))).length}
          busy={materialDeleteBusy}
          error={materialDeleteError}
          onCancel={closeBulkDeleteMaterials}
          onConfirm={confirmBulkDeleteMaterials}
        />
      )}
    </div>
  );
}
