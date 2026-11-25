import PreparationPanel from "../../features/preparation/PreparationPanel";
import { useLearningScope } from "../../features/learningMate/context";
import { useState, useRef, useEffect, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PINK, CYAN, BORDER_COLOR, Card } from "../../common";
import { deleteSummaryById, loadSummariesFromServer, type SavedSummary } from "../../services/summaries";
import { deleteQuizSetById, loadQuizSetsFromServer, type SavedQuizSet } from "../../services/quizSets";
import { loadQuizAttemptsFromServer, type SavedQuizAttempt } from "../../services/quizAttempts";
import { createCourseMaterialFileUrl, MAX_ORIGINAL_FILE_BYTES, type CourseMaterial } from "../../services/materials";
import { AITutorDrawer } from "../../components/AITutorDrawer";
import { PdfViewer } from "../../components/PdfViewer";
import { createPdfPreviewFromUrl } from "../../services/documentPreview";
import { fetchMaterialFile } from "../../services/materialFileCache";
import { SelectionAskButton } from "./SelectionAskButton";
import { FormattedAiText, SummaryContentView } from "./SummaryContent";
import { SummaryActions } from "./SummaryResultView";
import { markdownComponents } from "./markdown";
import type { DragAnchor, MaterialDetailTab } from "./types";
import { buildMindmapQuestion, classifyUploadFailure, formatHubDate, restoreScrollToAnchor, suggestedTutorQuestions, templateLabels } from "./utils";

type MaterialDetailViewProps = {
  material: CourseMaterial;
  selectedCourse: string;
  onBack: () => void;
  backLabel?: string;
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
  onRequestDelete?: () => void;
};

const LOW_QUIZ_SCORE_THRESHOLD = 70;

// 요약 본문과 AI 튜터가 나란히 차지하는 분할 영역의 높이.
// 카드를 뷰포트에 고정하지 않으므로 이 영역만 내부 스크롤되고, 위쪽 머리말/탭은
// 페이지와 함께 바깥 스크롤된다(전체 화면이 같이 내려가는 느낌).
const SPLIT_ROW_HEIGHT = "calc(100vh - 180px)";

const SPLIT_ROW_MIN_HEIGHT = 440;

const TUTOR_SPLIT_STORAGE_KEY = "tongkk:summaryTutorSplit";

// 자료별 '마지막에 본 요약' id를 기억해, 다음에 자료 상세로 들어올 때 그 요약을 먼저 보여준다.
const LAST_SUMMARY_KEY = "tongkk-last-summary-by-material";

const readLastSummaryId = (materialId: string): string => {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_SUMMARY_KEY) || "{}") as Record<string, string>;
    return map[materialId] || "";
  } catch {
    return "";
  }
};

const writeLastSummaryId = (materialId: string, summaryId: string) => {
  try {
    const map = JSON.parse(localStorage.getItem(LAST_SUMMARY_KEY) || "{}") as Record<string, string>;
    map[materialId] = summaryId;
    localStorage.setItem(LAST_SUMMARY_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 사용 불가 시 무시 */
  }
};

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
  // 드래그 종료 핸들러(handleUp)가 최신 비율을 localStorage에 저장할 수 있게 ref로 미러링한다.
  // 렌더 중 ref 쓰기는 react-hooks/refs 규칙 위반이라 effect로 옮긴다(드래그 중엔 handleMove가 직접 갱신).
  const ratioRef = useRef(ratio);
  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

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
        background: hover ? PINK : "var(--color-border)",
        transition: "background 0.15s ease, width 0.15s ease",
      }} />
    </div>
  );
};

// 변환된 PPT/PPTX 미리보기(PDF blob)를 자료별로 보관해, 같은 자료를 다시 열 때
// 원본 다운로드와 백엔드 변환을 반복하지 않는다. objectURL은 페이지가 살아있는 동안 유효하므로
// revoke하지 않고 재사용한다(자료 id = 파일명+크기라 내용이 바뀌면 키도 달라진다).
const pptPreviewUrlCache = new Map<string, string>();

// 자료 상세에서 삭제 확인 모달이 다루는 대상(요약 또는 퀴즈 세트).
type DeleteTarget =
  | { kind: "summary"; summary: SavedSummary }
  | { kind: "quiz"; quizSet: SavedQuizSet }
  | null;

export const MaterialDetailView = ({
  material,
  selectedCourse,
  onBack,
  backLabel = "← 과목 자료로",
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
  onRequestDelete,
}: MaterialDetailViewProps) => {
  useLearningScope({ courseName: selectedCourse, materialId: material.id, title: material.name });
  const learningNavigate = useNavigate();
  const [activeTab, setActiveTab] = useState<MaterialDetailTab>(initialTab);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  // 원본 이미지: filePath 기준 캐시로 받은 objectURL(준비 전엔 null → 로딩 표시). 재다운로드 방지용.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [hubRefresh, setHubRefresh] = useState(0);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState("");
  // 원본(PDF) 탭: PDF 영역을 "화면 가용 높이 + Tongkk 바 높이"만큼 잡는다. 그러면 페이지 스크롤이 딱
  // Tongkk 바 높이만큼만 생겨서, 위로 스크롤하면 맨 위 Tongkk 바만 사라지고 자료 정보·탭은 남는다.
  // rect.top은 페이지 스크롤 시 음수가 되므로 scrollY를 더해 문서 기준으로 계산한다.
  const TONGKK_BAR_HEIGHT = 80;
  const originalAreaRef = useRef<HTMLDivElement>(null);
  const [originalAreaHeight, setOriginalAreaHeight] = useState<number>();
  useEffect(() => {
    if (activeTab !== "original") return;
    const update = () => {
      const el = originalAreaRef.current;
      if (!el) return;
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      setOriginalAreaHeight(Math.max(SPLIT_ROW_MIN_HEIGHT, window.innerHeight - docTop + TONGKK_BAR_HEIGHT));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [activeTab, material.id]);
  const [activeSummaryId, setActiveSummaryId] = useState<string>("");
  const [tutorPrompt, setTutorPrompt] = useState(initialTutorQuestion);
  const [isOriginalTutorOpen, setIsOriginalTutorOpen] = useState(false);
  const [isSummaryTutorOpen, setIsSummaryTutorOpen] = useState(Boolean(initialTutorQuestion.trim() && initialTab === "summary"));
  // 확대 시 본문 칸을 숨기고 튜터가 그 영역을 꽉 채운다.
  const [isOriginalTutorExpanded, setIsOriginalTutorExpanded] = useState(false);
  const [isSummaryTutorExpanded, setIsSummaryTutorExpanded] = useState(false);
  const [tutorSelectionQuestion, setTutorSelectionQuestion] = useState<{ text: string; nonce: number } | null>(null);
  const [showSummaryList, setShowSummaryList] = useState(false);
  // 퀴즈 탭에서 카드를 눌러 펼친 퀴즈 세트(최신 풀이 채점 이력 표시)
  const [expandedQuizSetId, setExpandedQuizSetId] = useState<string | null>(null);
  // 삭제 확인 모달 대상(요약/퀴즈)과 진행·오류 상태. 네이티브 confirm 대신 클릭형 모달로 처리한다.
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const lowerMaterialName = material.name.toLowerCase();
  // 드래그해서 질문한 본문 구절의 위치. 튜터를 닫을 때 그 자리로 스크롤을 되돌린다.
  const dragAnchorRef = useRef<DragAnchor | null>(null);
  // 요약/원본 ↔ AI 튜터 가로 분할 비율(드래그 조절, localStorage 기억).
  const tutorSplit = useTutorSplit();

  // 완성된 질문을 그대로 튜터 입력창에 채운다(마인드맵 노드 질문 등).
  const askSummaryTutorWithQuestion = (question: string, anchor: DragAnchor | null) => {
    dragAnchorRef.current = anchor;
    setIsSummaryTutorOpen(true);
    setTutorSelectionQuestion(prev => ({ text: question, nonce: (prev?.nonce ?? 0) + 1 }));
  };
  // 본문 드래그 선택: "다음 내용을 설명해줘" 접두사를 붙인다.
  const askSummaryTutorWithSelection = (text: string, anchor: DragAnchor | null) =>
    askSummaryTutorWithQuestion(`다음 내용을 설명해줘:\n${text}`, anchor);
  // '쉬운 설명 보기': 더 쉬운 말로 풀어달라는 접두사를 붙인다(이슈 #66).
  const askSummaryTutorSimpleWithSelection = (text: string, anchor: DragAnchor | null) =>
    askSummaryTutorWithQuestion(`이 내용을 쉽게 설명해줘. :\n${text}`, anchor);

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
  const isImage = material.type === "img" || (material.mimeType || "").startsWith("image/");
  const isDocx = material.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lowerMaterialName.endsWith(".docx");
  // 텍스트 자료: 붙여넣기(원본 파일 없음)와 txt/md 업로드 모두 저장된 markdown이 곧 본문이라 같은 방식으로 렌더링한다.
  // mimeType이 비어 있는 옛 붙여넣기 자료는 id 접두사로 판별한다.
  const isTextMaterial = (material.mimeType || "").startsWith("text/") || material.id.startsWith("text:")
    || lowerMaterialName.endsWith(".txt") || lowerMaterialName.endsWith(".md");
  const hasReviewContext = Boolean(reviewContext.trim());
  const fileTypeLabel = material.type === "pdf" ? "PDF" : material.type === "ppt" ? "PPT" : material.type === "img" ? "이미지" : isDocx ? "DOCX" : isTextMaterial ? "텍스트" : "자료";
  const pageInfo = material.pages ? `${material.pages}페이지`
    : material.slides ? `${material.slides}슬라이드`
    : isTextMaterial && !material.filePath && material.size ? `${material.size.toLocaleString()}자`
    : material.size ? `${(material.size / (1024 * 1024)).toFixed(1)}MB`
    : "페이지 정보 없음";
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

    setPreviewPdfUrl(null);
    setPreviewError("");

    // 원본 탭을 실제로 열었을 때만 변환한다. 예전엔 자료에 들어서기만 해도(요약 탭 포함)
    // 원본 PPT/DOCX를 통째로 받아 변환해 Egress를 크게 낭비했다.
    if (activeTab !== "original" || !fileUrl || !(isPresentation || isDocx)) {
      setPreviewLoading(false);
      return () => {
        ignore = true;
      };
    }

    // 이미 변환해둔 미리보기가 있으면 원본 다운로드·변환 없이 바로 재사용한다.
    const cachedPreview = pptPreviewUrlCache.get(material.id);
    if (cachedPreview) {
      setPreviewPdfUrl(cachedPreview);
      setPreviewLoading(false);
      return () => {
        ignore = true;
      };
    }

    setPreviewLoading(true);
    createPdfPreviewFromUrl(fileUrl, material.name, material.filePath)
      .then(url => {
        // 변환 결과는 페이지 생존 동안 재사용하므로 revoke하지 않고 캐시에 보관한다.
        pptPreviewUrlCache.set(material.id, url);
        if (!ignore) setPreviewPdfUrl(url);
      })
      .catch(err => {
        if (!ignore) setPreviewError(err instanceof Error ? err.message : "원본 미리보기 변환에 실패했습니다.");
      })
      .finally(() => {
        if (!ignore) setPreviewLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeTab, fileUrl, isPresentation, isDocx, material.id, material.name, material.filePath]);

  // 원본 이미지: 서명 URL은 새로고침마다 토큰이 바뀌어 브라우저 HTTP 캐시가 빗나간다.
  // filePath 기준 Cache Storage(fetchMaterialFile)로 받아 objectURL로 보여줘 재다운로드(Egress)를 막는다.
  useEffect(() => {
    setImageUrl(null);
    if (activeTab !== "original" || !isImage || !fileUrl) {
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    fetchMaterialFile(fileUrl, { cacheKey: material.filePath })
      .then(blob => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        // 캐시·네트워크 모두 실패한 드문 경우만 서명 URL을 직접 쓰게 둔다(로딩 멈춤 방지).
        if (!revoked) setImageUrl(fileUrl);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeTab, isImage, fileUrl, material.filePath]);

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
      loadSummariesFromServer(selectedCourse, { includeContent: true }),
      loadQuizSetsFromServer(selectedCourse, { includeQuestions: true }),
      loadQuizAttemptsFromServer(selectedCourse, { includeAnswers: true }),
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
        // 마지막에 본 요약이 있으면 그걸 먼저, 없으면 일반 요약(GENERAL), 그것도 없으면 최신.
        const lastViewedId = readLastSummaryId(material.id);
        const defaultSummary = materialSummaries.find(summary => summary.id === lastViewedId)
          || materialSummaries.find(summary => summary.template === "GENERAL")
          || materialSummaries[0];

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
  }, [selectedCourse, material.id, hubRefresh]);

  // 사용자가 요약을 전환할 때마다 '마지막에 본 요약'으로 기억한다(다음 진입 시 그 요약을 먼저 보여줌).
  useEffect(() => {
    if (activeSummaryId) writeLastSummaryId(material.id, activeSummaryId);
  }, [activeSummaryId, material.id]);

  const activeSummary = summaries.find(summary => summary.id === activeSummaryId) || summaries[0];
  const recentQuizAttempt = quizAttempts[0];
  const latestAttemptByQuizSetId = quizAttempts.reduce<Map<string, SavedQuizAttempt>>((map, attempt) => {
    if (attempt.quizSetId && !map.has(attempt.quizSetId)) map.set(attempt.quizSetId, attempt);
    return map;
  }, new Map());

  // × 버튼은 바로 지우지 않고 확인 모달을 연다.
  const requestDelete = (target: NonNullable<DeleteTarget>) => {
    setDeleteError("");
    setPendingDelete(target);
  };
  const closeDelete = () => {
    if (deleteBusy) return; // 삭제 진행 중에는 닫지 않는다.
    setPendingDelete(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      if (pendingDelete.kind === "summary") {
        const { summary } = pendingDelete;
        if (summary.id) {
          await deleteSummaryById(selectedCourse, summary.id);
          const next = summaries.filter(item => item.id !== summary.id);
          setSummaries(next);
          if (activeSummaryId === summary.id) {
            const fallback = next.find(item => item.template === "GENERAL") || next[0];
            setActiveSummaryId(fallback?.id || "");
          }
        }
      } else {
        const { quizSet } = pendingDelete;
        await deleteQuizSetById(selectedCourse, quizSet.id);
        setQuizSets(prev => prev.filter(item => item.id !== quizSet.id));
        setExpandedQuizSetId(prev => (prev === quizSet.id ? null : prev));
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setDeleteBusy(false);
    }
  };
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
    // 텍스트 붙여넣기 자료: 원본 파일이 없으므로 저장된 마크다운 본문을 바로 렌더링한다.
    // FormattedAiText는 AI 출력 전용 후처리(출처 헤딩 합치기 등)를 거치므로, 사용자가 쓴 원문에는 적용하지 않는다.
    if (isTextMaterial) {
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
          <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]} components={markdownComponents}>
            {material.markdown || "표시할 내용이 없습니다."}
          </ReactMarkdown>
        </div>
      );
    }

    if (fileLoading || previewLoading) {
      return (
        <div style={{ height: "100%", minHeight: 0, display: "grid", placeItems: "center", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: 14 }}>
          {previewLoading
            ? (isDocx ? "DOCX 미리보기를 PDF로 변환하는 중입니다." : "PPT/PPTX 미리보기를 PDF로 변환하는 중입니다.")
            : (isImage ? "원본 이미지를 불러오는 중입니다." : "원본 파일을 불러오는 중입니다.")}
        </div>
      );
    }

    if (isImage && material.filePath) {
      // 캐시된 이미지(objectURL)가 준비되기 전까지는 로딩만 보여준다 — 서명 URL로 먼저 한 번
      // 받아버리는(Egress) 것을 막기 위해 src에 fileUrl을 직접 걸지 않는다.
      if (!imageUrl) {
        return (
          <div style={{ height: "100%", minHeight: 0, display: "grid", placeItems: "center", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            원본 이미지를 불러오는 중입니다.
          </div>
        );
      }
      return (
        <div style={{
          height: "100%",
          minHeight: 0,
          overflow: "auto",
          background: "var(--color-surface)",
          display: "grid",
          placeItems: "center",
          padding: 24,
          boxSizing: "border-box",
        }}>
          <img
            src={imageUrl}
            alt={material.name}
            style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
          />
        </div>
      );
    }

    if (fileUrl && isPdf) {
      return <PdfViewer url={fileUrl} cacheKey={material.filePath} title={material.name} />;
    }

    if (previewPdfUrl) {
      return <PdfViewer url={previewPdfUrl} title={material.name} />;
    }

    // 원본이 없는 이유 구분: 50MB 한도 초과면 그에 맞는 안내, 그 외(원본 저장 기능 추가 전 업로드 등)는 기존 안내.
    const originalSize = material.size;
    const noOriginalMessage =
      !material.filePath && originalSize != null && originalSize > MAX_ORIGINAL_FILE_BYTES
        ? `이 자료는 원본이 ${(originalSize / (1024 * 1024)).toFixed(1)}MB로 저장 한도(50MB)를 넘어 원본을 저장하지 않았어요. 텍스트는 저장돼 요약·퀴즈에 그대로 사용할 수 있어요.`
        : "이 자료는 원본 저장 기능 추가 전에 업로드되어 원본 파일이 없습니다. 같은 파일을 다시 업로드하면 다음부터 원본 보기로 열립니다.";

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
          background: fileError || previewError ? "var(--color-tint-pink)" : "var(--color-tint-yellow)",
          color: fileError || previewError ? "var(--color-danger)" : "var(--color-amber-deep)",
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.55,
        }}>
          {previewFailure ? `${previewFailure.label}: ${previewError} 아래에 텍스트 추출 결과를 대신 보여드릴게요.` : fileError || (isPresentation || isDocx
            ? (isDocx
              ? "DOCX 원본 미리보기를 준비하지 못했습니다. 서버에 LibreOffice가 설치되어 있으면 PDF 미리보기로 변환해 볼 수 있습니다."
              : isLegacyPpt
                ? "PPT 원본 미리보기를 준비하지 못했습니다. 서버에 LibreOffice가 설치되어 있으면 PDF 미리보기로 변환해 볼 수 있습니다."
                : "PPTX 원본 미리보기를 준비하지 못했습니다. 서버에 LibreOffice가 설치되어 있으면 PDF 미리보기로 변환해 볼 수 있습니다.")
            : noOriginalMessage)}
        </div>
        {fileUrl && (isPresentation || isDocx) && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", marginBottom: 16, color: CYAN, fontSize: 13, fontWeight: 800, textDecoration: "none" }}
          >
            {isDocx ? "원본 DOCX 열기" : "원본 PPT/PPTX 열기"}
          </a>
        )}
        {/* 원본 파일이 없어도(50MB 초과 등) 변환 텍스트는 저장돼 있으므로 본문을 보여준다. */}
        {(material.filePath || material.markdown) && (
          <FormattedAiText content={material.markdown || "표시할 변환 내용이 없습니다."} />
        )}
      </div>
    );
  };

  return (
    <div>
      <button type="button" onClick={onBack} style={{
        background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>{backLabel}</button>
      <button type="button" onClick={() => learningNavigate(`/learn?${new URLSearchParams({ course: selectedCourse, material: material.id })}`)} style={{
        marginLeft: 16, marginBottom: 20, padding: "8px 12px", borderRadius: 10,
        border: "none", background: "var(--color-tint-pink)", color: "var(--color-pink-deep)", cursor: "pointer", fontSize: 13, fontWeight: 600,
      }}>직접 설명하며 학습하기 →</button>
      <PreparationPanel key={`${selectedCourse}:${material.id}`} course={selectedCourse} materialId={material.id} onApplied={(kind, id) => { if (kind === 'summary') { writeLastSummaryId(material.id, id); setActiveTab('summary'); } else if (kind === 'quiz') setActiveTab('quiz'); setHubRefresh(n => n + 1); }} />
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
          // 진행 단계·삭제 버튼은 축소되지 않으므로, 좁은 화면에서는 다음 줄로 내려 제목이 0px로 찌그러지지 않게 한다.
          flexWrap: "wrap",
          gap: 16,
        }}>
          <div style={{ flex: "1 1 auto", minWidth: 160 }}>
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
                const color = step.current ? "var(--color-text-strong)" : "var(--color-muted)";
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
                        background: step.done ? "var(--color-muted)" : "var(--color-card)",
                        color: step.done ? "var(--color-on-brand)" : step.current ? "var(--color-text-strong)" : "var(--color-muted)",
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
          {onRequestDelete && (
            <button
              type="button"
              className="tongkk-hover-danger"
              onClick={onRequestDelete}
              aria-label={`${material.name} 삭제`}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                border: `1px solid ${BORDER_COLOR}`,
                background: "var(--color-card)",
                color: "var(--color-danger)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              자료 삭제
            </button>
          )}
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
                <button type="button" className="tongkk-hover-tint" onClick={() => { const next = !isOriginalTutorOpen; setIsOriginalTutorOpen(next); if (!next) setIsOriginalTutorExpanded(false); }} style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1px solid ${BORDER_COLOR}`,
                  background: isOriginalTutorOpen ? "var(--color-muted-surface)" : "var(--color-card)",
                  color: isOriginalTutorOpen ? "var(--color-text-strong)" : "var(--color-text)",
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
                  <SummaryActions template={activeSummary.template} content={activeSummary.content} />
                  <button type="button" className="tongkk-hover-tint" onClick={() => handleSummaryTutorOpenChange(!isSummaryTutorOpen)} style={{
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: `1px solid ${BORDER_COLOR}`,
                    background: isSummaryTutorOpen ? "var(--color-muted-surface)" : "var(--color-card)",
                    color: isSummaryTutorOpen ? "var(--color-text-strong)" : "var(--color-text)",
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
          <div ref={originalAreaRef} style={{ height: originalAreaHeight ?? SPLIT_ROW_HEIGHT, minHeight: SPLIT_ROW_MIN_HEIGHT }}>
          <div
            ref={tutorSplit.containerRef}
            style={{
              display: "flex",
              alignItems: "stretch",
              height: "100%",
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
                    sourceMarkdown={material.markdown}
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
                  <button type="button" onClick={onGoSummary} style={{ padding: "12px 18px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--color-pink) 25%, transparent)", background: "var(--color-tint-pink)", color: PINK, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    요약 생성하기
                  </button>
                </div>
              </div>
            ) : (
              <div style={isSummaryTutorExpanded
                // 확대 시 위쪽 메뉴까지 덮는 전체 화면 오버레이로 띄워 튜터가 화면을 통째로 쓰게 한다.
                ? { position: "fixed", inset: 0, zIndex: 250, display: "flex", padding: 16, background: "var(--color-page)", boxSizing: "border-box" }
                : { display: "flex", alignItems: "stretch", gap: 14, height: SPLIT_ROW_HEIGHT, minHeight: SPLIT_ROW_MIN_HEIGHT }}>
                {showSummaryList && !isSummaryTutorExpanded && (
                  <div style={{ flex: "0 0 220px", minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {summaries.map(summary => (
                      <div key={summary.id || `${summary.template}-${summary.createdAt}`} style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setActiveSummaryId(summary.id || "")}
                          style={{
                            width: "100%",
                            padding: "12px 34px 12px 13px",
                            borderRadius: 10,
                            border: activeSummary?.id === summary.id ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : `1px solid ${BORDER_COLOR}`,
                            background: activeSummary?.id === summary.id ? "var(--color-tint-pink)" : "var(--color-card)",
                            color: activeSummary?.id === summary.id ? PINK : "var(--color-text)",
                            textAlign: "left",
                            cursor: "pointer",
                          }}
                        >
                          <strong style={{ display: "block", fontSize: 13, marginBottom: 4 }}>{templateLabels[summary.template]}</strong>
                          <span style={{ display: "block", fontSize: 11, color: "var(--color-muted)" }}>{formatHubDate(summary.createdAt)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); requestDelete({ kind: "summary", summary }); }}
                          aria-label={`${templateLabels[summary.template]} 요약 삭제`}
                          title="삭제"
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            border: `1px solid ${BORDER_COLOR}`,
                            background: "var(--color-card)",
                            color: "var(--color-muted)",
                            cursor: "pointer",
                            fontSize: 13,
                            lineHeight: "20px",
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
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
                        <SelectionAskButton onAsk={askSummaryTutorWithSelection} onAskSimple={askSummaryTutorSimpleWithSelection}>
                          <SummaryContentView content={activeSummary.content} template={activeSummary.template} onNodeFocus={(label, pathLabels) => askSummaryTutorWithQuestion(buildMindmapQuestion(label, pathLabels), null)} persistKey={activeSummary.id} />
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
                          sourceMarkdown={material.markdown}
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
                  <button type="button" onClick={onGoQuiz} style={{ padding: "12px 18px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--color-cyan) 25%, transparent)", background: "var(--color-tint-cyan)", color: CYAN, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    퀴즈 생성하기
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {quizSets.map(quizSet => {
                  const latestAttempt = latestAttemptByQuizSetId.get(quizSet.id);
                  const isExpanded = expandedQuizSetId === quizSet.id;
                  return (
                    <div key={quizSet.id} style={{ padding: 18, borderRadius: 12, background: "var(--color-card)", border: `1px solid ${BORDER_COLOR}` }}>
                      <div
                        onClick={latestAttempt ? () => setExpandedQuizSetId(prev => (prev === quizSet.id ? null : quizSet.id)) : undefined}
                        style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", cursor: latestAttempt ? "pointer" : "default" }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                            <h3 style={{ margin: 0, fontSize: 16, color: "var(--color-text-strong)", wordBreak: "break-word" }}>{quizSet.title}</h3>
                            {multiSourceBadge(quizSet.materialIds)}
                            {latestAttempt && (
                              <span style={{
                                padding: "4px 8px",
                                borderRadius: 999,
                                background: "var(--color-muted-surface)",
                                color: "var(--color-text-secondary)",
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
                            {latestAttempt && <span style={{ color: CYAN }}>{isExpanded ? "풀이 이력 접기 ▴" : "풀이 이력 보기 ▾"}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <button type="button" className="tongkk-hover-tint-cyan" onClick={e => { e.stopPropagation(); onOpenQuiz(quizSet); }} style={{ padding: "10px 14px", borderRadius: 9, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-text)", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                            {latestAttempt ? "분석 리포트" : "퀴즈 풀기"}
                          </button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); requestDelete({ kind: "quiz", quizSet }); }}
                            aria-label={`${quizSet.title} 퀴즈 삭제`}
                            title="삭제"
                            style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${BORDER_COLOR}`, background: "var(--color-card)", color: "var(--color-muted)", cursor: "pointer", fontSize: 16, lineHeight: "32px", padding: 0 }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {isExpanded && latestAttempt && (
                        <div style={{ marginTop: 14, borderTop: `1px solid ${BORDER_COLOR}`, paddingTop: 14, display: "grid", gap: 12 }}>
                          {latestAttempt.answers.map((ans, i) => {
                            // 저장된 퀴즈 세트의 같은 인덱스 문항에서 선지/정답 인덱스를 가져온다(문항 순서는 보존됨).
                            const q = quizSet.questions[i];
                            const options = (ans.type === "객관식" || ans.type === "OX") ? q?.options : undefined;
                            return (
                              <div key={`${quizSet.id}-${i}`} style={{ padding: 14, borderRadius: 10, background: "var(--color-surface)", border: "1px solid var(--color-border-soft)" }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                                  <span style={{
                                    flexShrink: 0,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    background: ans.isCorrect ? "var(--color-tint-cyan)" : "var(--color-tint-pink)",
                                    color: ans.isCorrect ? CYAN : PINK,
                                    fontSize: 11,
                                    fontWeight: 850,
                                  }}>{ans.isCorrect ? "정답" : "오답"}</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "var(--color-text-strong)", lineHeight: 1.5, wordBreak: "break-word" }}>
                                    Q{i + 1}. {ans.question}
                                  </span>
                                </div>
                                {options && options.length > 0 ? (
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {options.map((opt, oi) => {
                                      const isCorrectOpt = q?.answer === oi;
                                      const isMyChoice = opt === ans.studentAnswer;
                                      // 내 선택은 연한 회색, 실제 정답은 오답일 때만 핑크로 강조. 나머지 선지는 중립.
                                      const showCorrect = isCorrectOpt && !ans.isCorrect;
                                      return (
                                        <div key={oi} style={{
                                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                                          padding: "9px 12px", borderRadius: 9,
                                          background: showCorrect ? "var(--color-tint-pink)" : isMyChoice ? "var(--color-muted-surface)" : "var(--color-card)",
                                          border: `1px solid ${showCorrect ? PINK : "var(--color-border-soft)"}`,
                                        }}>
                                          <span style={{ minWidth: 0, fontSize: 13, color: showCorrect ? PINK : "var(--color-text)", fontWeight: showCorrect || isMyChoice ? 750 : 600, lineHeight: 1.45, wordBreak: "break-word" }}>
                                            {String.fromCharCode(65 + oi)}. {opt}
                                          </span>
                                          {(isMyChoice || showCorrect) && (
                                            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 850, color: showCorrect ? PINK : "var(--color-text-secondary)" }}>
                                              {showCorrect ? "정답" : "내 답"}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {q?.explanation && (
                                      <div style={{ marginTop: 2, fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                                        <strong style={{ color: "var(--color-text)" }}>해설</strong> {q.explanation}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6, paddingLeft: 2 }}>
                                    <span>내 답: <span style={{ padding: "2px 8px", borderRadius: 6, background: "var(--color-muted-surface)", color: "var(--color-text)", fontWeight: 700 }}>{ans.studentAnswer ?? "미응답"}</span></span>
                                    {!ans.isCorrect && (
                                      <span>정답: <strong style={{ color: PINK }}>{ans.correctAnswer ?? "정답 정보 없음"}</strong></span>
                                    )}
                                    {(ans.feedback || q?.explanation) && (
                                      <span><strong style={{ color: "var(--color-text)" }}>해설</strong> {ans.feedback || q?.explanation}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button type="button" onClick={onGoQuiz} style={{ justifySelf: "start", padding: "11px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--color-cyan) 20%, transparent)", background: "var(--color-tint-cyan)", color: CYAN, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                  새 퀴즈 만들기
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </Card>
      {pendingDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Card style={{ padding: 28, width: "min(380px, 100%)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>
              {pendingDelete.kind === "summary" ? "요약을 삭제할까요?" : "퀴즈를 삭제할까요?"}
            </h3>
            <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
              {pendingDelete.kind === "summary"
                ? `'${templateLabels[pendingDelete.summary.template]}' 요약과 연결된 AI 튜터 대화가 함께 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.`
                : `'${pendingDelete.quizSet.title}' 퀴즈가 삭제됩니다. 풀이 기록은 통계에 남습니다. 삭제 후에는 되돌릴 수 없습니다.`}
            </p>
            {deleteError && (
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-danger)", fontWeight: 700, lineHeight: 1.5 }}>{deleteError}</p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={closeDelete}
                disabled={deleteBusy}
                style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-text)", cursor: deleteBusy ? "default" : "pointer", fontSize: 14 }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteBusy}
                style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: deleteBusy ? "var(--color-muted-surface)" : "light-dark(#4b5563, #5b6473)", color: "var(--color-on-brand)", cursor: deleteBusy ? "default" : "pointer", fontSize: 14, fontWeight: 700 }}
              >
                {deleteBusy ? "삭제 중" : "삭제"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
