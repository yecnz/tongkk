import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, pageRoutes, SidebarIcon, Sidebar, Card, normalizeBoldSpacing, normalizeMathDelimiters, escapeStrayMultiplication, type PageRouteLabel } from "../common";
import { useTutorial } from "../TutorialContext";
import { TutorialHelpButton } from "../components/TutorialHelpButton";
import { hasPageMarkers } from "../utils/pageMarkers";
import {
  generateQuiz,
  gradeSubjectiveAnswer,
  analyzeWrongAnswers,
  type QuizQuestion,
  type QuizDifficulty,
  type QuizQuestionType,
  type SubjectiveGradeResult,
  type SummaryTemplate,
  type WrongAnalysisItem,
} from "../services/gpt";
import { saveWrongAnswerAnalysisToServer } from "../services/wrongAnswerAnalyses";
import { useAuth } from "../AuthContext";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";
import { getPdfPageCount } from "../services/pdfPageCount";
import { loadSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, saveQuizSetToServer, type SavedQuizSet } from "../services/quizSets";
import {
  loadQuizAttemptsFromServer,
  saveQuizAttemptToServer,
  type QuizAttemptAnswer,
  type SavedQuizAttempt,
} from "../services/quizAttempts";
import { inferWeakTopicFromQuestion } from "../services/statsHelpers";
import { isShortAnswerCorrect } from "../services/answerMatch";
import {
  getFileMaterialId,
  loadCourseMaterialsFromServer,
  saveCourseMaterials,
  uploadCourseMaterialFile,
  type CourseMaterial,
} from "../services/materials";

type QuizView = "courseList" | "materialList" | "courseDetail" | "generating" | "quiz" | "result";
type QuizSource = "raw" | SummaryTemplate;
type QuizLocationState = {
  course?: string;
  selectedCourse?: string;
  template?: SummaryTemplate;
  materialIds?: string[];
  fromDashboard?: boolean;
  quizSetId?: string;
  openQuiz?: boolean;
  reviewQuestions?: QuizQuestion[];
  reviewTitle?: string;
  diagnostic?: boolean;
} | null;

const sourceLabels: Record<string, string> = {
  raw: "원본 자료",
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

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

const QuizText = ({ children }: { children?: string | null }) => {
  const text = (children ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  // 단일 '~'(예: 'p.8~p.9')를 취소선으로 오인하지 않도록 singleTilde:false.
  const cleaned = normalizeBoldSpacing(escapeStrayMultiplication(normalizeMathDelimiters(text)));
  return (
    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]} rehypePlugins={[rehypeKatex]} components={quizMarkdownComponents}>
      {cleaned}
    </ReactMarkdown>
  );
};

// 풀이 중 새로고침·이탈로 답안이 날아가지 않도록 진행 상태를 세션에 스냅샷한다.
// 과목 설정 화면에서 "이어서 풀기" 배너로 복구하며, 제출(결과 진입) 시 지운다.
type QuizDraft = {
  course: string;
  quizzes: QuizQuestion[];
  current: number;
  answers: Record<number, number | string>;
  subjectiveGrades: Record<number, SubjectiveGradeResult>;
  questionType: QuizQuestionType;
  difficulty: QuizDifficulty;
  examMode: boolean;
  remainingSeconds: number | null;
  quizStartedAt: number | null;
  openedQuizTitle: string;
  activeQuizSetId: string | null;
  selectedMaterialIds: string[];
  savedAt: number;
};

const QUIZ_DRAFT_KEY = "tongkk:quizDraft";
const QUIZ_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const readQuizDraft = (): QuizDraft | null => {
  try {
    const raw = sessionStorage.getItem(QUIZ_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as QuizDraft;
    if (!draft?.course || !Array.isArray(draft.quizzes) || draft.quizzes.length === 0) return null;
    if (Date.now() - (draft.savedAt || 0) > QUIZ_DRAFT_MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
};

const writeQuizDraft = (draft: QuizDraft) => {
  try {
    sessionStorage.setItem(QUIZ_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 저장 실패(용량 등) 시 복구만 못 할 뿐 풀이는 계속된다.
  }
};

const clearQuizDraft = () => {
  try {
    sessionStorage.removeItem(QUIZ_DRAFT_KEY);
  } catch {
    // ignore
  }
};

const isSupportedDocumentFile = (file: File) =>
  ["pdf", "ppt", "pptx", "docx", "txt", "md", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes((file.name.split(".").pop() || "").toLowerCase());

const getDocumentMaterialType = (file: File): CourseMaterial["type"] => {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) return "img";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  return "file";
};

// txt/md는 파일 내용이 곧 본문이므로 서버 변환 없이 그대로 읽는다.
const isPlainTextFile = (name: string) => ["txt", "md"].includes((name.split(".").pop() || "").toLowerCase());

const extractMarkdownFromMaterialFile = (file: File) =>
  isPlainTextFile(file.name) ? file.text() : extractMarkdownFromPDF(file);

const formatFileNames = (files: Pick<File, "name">[]) =>
  files.length <= 2 ? files.map(file => file.name).join(", ") : `${files[0].name} 외 ${files.length - 1}개`;

const sameMaterialIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

const sameMaterialNames = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].map(name => name.trim().toLowerCase()).sort()
    .every((name, index) => name === [...b].map(item => item.trim().toLowerCase()).sort()[index]);

const formatSeconds = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
};

function getRecommendedDifficulty(attempts: SavedQuizAttempt[]): QuizDifficulty | null {
  if (attempts.length === 0) return null;
  const recent = attempts.slice(0, 3);
  const average = recent.reduce((sum, attempt) => sum + attempt.scorePercent, 0) / recent.length;
  if (average >= 80) return "어려움";
  if (average >= 55) return "보통";
  return "쉬움";
}

const getDifficultyReason = (attempts: SavedQuizAttempt[]) => {
  if (attempts.length === 0) return "아직 풀이 기록이 없어 기본 난이도로 시작합니다.";
  const recent = attempts.slice(0, 3);
  const average = Math.round(recent.reduce((sum, attempt) => sum + attempt.scorePercent, 0) / recent.length);
  if (average >= 80) return `최근 평균 ${average}%라서 한 단계 높은 문제로 점검해도 좋습니다.`;
  if (average >= 55) return `최근 평균 ${average}%라서 현재 수준을 유지하며 빈틈을 줄이는 흐름이 좋습니다.`;
  return `최근 평균 ${average}%라서 쉬운 문제로 핵심 개념을 다시 잡는 편이 좋습니다.`;
};

const uniqueWeakTopics = (questions: QuizQuestion[]) =>
  Array.from(new Set(questions.map(question => inferWeakTopicFromQuestion(question.question, question.explanation)).filter(Boolean))).slice(0, 4);

const normalizeAnswer = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "").replace(/[.,:;!?()[\]{}'"`]/g, "");

const buildAnswersFromAttempt = (quizSet: SavedQuizSet, attempt: SavedQuizAttempt) => {
  const answers: Record<number, number | string> = {};
  const subjectiveGrades: Record<number, SubjectiveGradeResult> = {};

  quizSet.questions.forEach((question, index) => {
    const attemptAnswer = attempt.answers[index];
    if (!attemptAnswer) return;

    const type = question.type || quizSet.questionType;
    if (type === "객관식" || type === "OX") {
      const answerIndex = question.options?.findIndex(option => option === attemptAnswer.studentAnswer);
      if (answerIndex !== undefined && answerIndex >= 0) answers[index] = answerIndex;
      return;
    }

    if (typeof attemptAnswer.studentAnswer === "string") {
      answers[index] = attemptAnswer.studentAnswer;
    }

    if (type === "주관식") {
      subjectiveGrades[index] = {
        score: attemptAnswer.score ?? (attemptAnswer.isCorrect ? 100 : 0),
        isCorrect: attemptAnswer.isCorrect,
        feedback: attemptAnswer.feedback || (attemptAnswer.isCorrect ? "저장된 풀이 기록에서 정답으로 채점되었습니다." : "저장된 풀이 기록에서 오답으로 채점되었습니다."),
        referenceAnswer: String(attemptAnswer.correctAnswer || question.answerText || question.explanation),
      };
    }
  });

  return { answers, subjectiveGrades };
};

// 백엔드가 객관식 정답을 항상 0번(첫 보기)으로 내려보내므로, 렌더 전에 보기를 Fisher–Yates로 섞고
// answer 인덱스를 정답 보기의 새 위치로 재매핑한다. OX·단답형·주관식은 보기 순서를 그대로 둔다.
// type이 비어 있으면 동질 세트는 fallbackType(세트 단위 유형)으로, 혼합 세트(오답 다시 풀기)는
// 보기 개수로 객관식을 판별한다(객관식 4개 / OX 2개).
const shuffleQuizOptions = (questions: QuizQuestion[], fallbackType?: QuizQuestionType): QuizQuestion[] =>
  questions.map(quiz => {
    const { options, answer } = quiz;
    const type = quiz.type ?? fallbackType;
    if (typeof answer !== "number" || !options) return quiz;
    const isMultipleChoice = type === "객관식" ? options.length >= 2 : type === undefined && options.length >= 3;
    if (!isMultipleChoice) return quiz;

    // 보기 텍스트가 중복돼도 정답이 정확히 따라가도록 인덱스 순열을 섞는다.
    const order = options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const newAnswer = order.indexOf(answer);
    if (newAnswer < 0) return quiz;
    return { ...quiz, options: order.map(idx => options[idx]), answer: newAnswer };
  });

type HeaderProps = { label: string; onOpenSidebar: () => void; onHome: () => void; extra?: ReactNode };

const Header = ({ label, onOpenSidebar, onHome, extra }: HeaderProps) => (
  <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <button type="button" className="tongkk-hover-dim" onClick={onOpenSidebar} style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
        <SidebarIcon />
      </button>
      <button type="button" className="tongkk-hover-fade" onClick={onHome} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ {label}</span>
    </div>
    {extra}
  </div>
);

export default function Quiz() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { maybeShow: maybeShowTutorial, activeKey: activeTutorialKey } = useTutorial();
  const reviewState = location.state as QuizLocationState;
  const reviewQuestions = reviewState?.reviewQuestions || null;
  const hasReviewQuestions = Boolean(reviewQuestions && reviewQuestions.length > 0);
  const reviewActiveRef = useRef(hasReviewQuestions);
  const [sidebar, setSidebar] = useState(false);
  // 단독 진입(사이드바)이 사라져, 대시보드 모달 핸드오프(state.course)로만 들어온다.
  const initialHandoffCourse = hasReviewQuestions ? "" : (reviewState?.course || reviewState?.selectedCourse || "");
  const [view, setView] = useState<QuizView>(hasReviewQuestions ? "quiz" : (initialHandoffCourse ? "courseDetail" : "courseList"));

  // 과목 및 설정
  const [selectedCourse, setSelectedCourse] = useState(
    hasReviewQuestions ? (reviewState?.selectedCourse || reviewState?.course || "") : initialHandoffCourse,
  );
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("보통");
  const [questionType, setQuestionType] = useState<QuizQuestionType>("객관식");

  // 설정/풀이 화면에 처음 들어올 때 해당 튜토리얼을 1회 노출(본 적 있으면 자동 생략).
  // 오답 다시 풀기로 바로 풀이에 들어오면 view가 "quiz"라 설정 안내는 자연히 건너뛴다.
  useEffect(() => {
    if (view === "courseDetail") maybeShowTutorial("quiz-setup");
    else if (view === "quiz") maybeShowTutorial("quiz-solve");
  }, [view, maybeShowTutorial]);

  // 자료 관련
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  // 출제 범위·집중 내용 (요약과 동일한 마커 기반 페이지 선택 + 자유 텍스트).
  const [quizPageRange, setQuizPageRange] = useState("");
  const [quizFocusPrompt, setQuizFocusPrompt] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [materialNotice, setMaterialNotice] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 자료 소스
  const [savedSummaries, setSavedSummaries] = useState<SavedSummary[]>([]);
  const [materialSources, setMaterialSources] = useState<Record<string, QuizSource>>({});
  const pendingTemplateRef = useRef<SummaryTemplate | null>(null);
  const pendingMaterialIdsRef = useRef<string[] | null>(null);
  const pendingQuizSetIdRef = useRef<string | null>(null);
  const fromDashboardRef = useRef(false);
  // courseDetail(과목 세부)에 외부 라우트(자료 요약/대시보드)에서 직접 진입했는지 여부.
  // materialList(자료 목록)를 거쳐 들어왔다면 false로 두어 "돌아가기"가 자료 목록으로 가게 한다.
  const courseDetailFromRouteRef = useRef(false);
  // 대시보드 온보딩에서 넘어온 진단 퀴즈 모드. 다음 생성 1회에만 적용한다.
  const diagnosticPendingRef = useRef(false);
  const [openedQuizTitle, setOpenedQuizTitle] = useState(
    hasReviewQuestions ? (reviewState?.reviewTitle || "오답 다시 풀기") : "",
  );
  const [activeQuizSetId, setActiveQuizSetId] = useState<string | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  // 이 과목에서 이미 출제된 퀴즈 세트들(중복 출제 방지용 제외 목록 구성에 사용).
  const [priorQuizSets, setPriorQuizSets] = useState<SavedQuizSet[]>([]);

  // 퀴즈
  const [quizzes, setQuizzes] = useState<QuizQuestion[]>(() => hasReviewQuestions && reviewQuestions ? shuffleQuizOptions(reviewQuestions) : []);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number | string>>({});
  const [shortAnswerInput, setShortAnswerInput] = useState("");
  const [subjectiveGrades, setSubjectiveGrades] = useState<Record<number, SubjectiveGradeResult>>({});
  const [grading, setGrading] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examMode, setExamMode] = useState(false);
  const [examMinutes, setExamMinutes] = useState(10);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [quizStartedAt, setQuizStartedAt] = useState<number | null>(hasReviewQuestions ? Date.now() : null);
  const [timedOut, setTimedOut] = useState(false);
  const [attemptSavedKey, setAttemptSavedKey] = useState("");
  const [attemptSaveNotice, setAttemptSaveNotice] = useState("");
  const [reviewAttempt, setReviewAttempt] = useState<SavedQuizAttempt | null>(null);
  // 결과 화면의 '오답 복습'에서 특정 문항을 눌러 정답·오답이 표시된 풀이 화면을 다시 보는 읽기 전용 모드.
  const [reviewMode, setReviewMode] = useState(false);
  // 과목 오답 분석(오답 다시 풀기 결과 화면)
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  // 이어 풀 수 있는 풀이 스냅샷(과목 설정 화면 배너로 노출).
  const [resumableDraft, setResumableDraft] = useState<QuizDraft | null>(() => readQuizDraft());
  // 이어풀기 직후 과목 데이터 로드가 늦게 끝나도 복원된 풀이 상태를 덮어쓰지 않게 하는 가드.
  const resumedDraftRef = useRef(false);

  // Summary 페이지에서 navigate로 전달된 state 처리 (마운트 시 1회)
  useEffect(() => {
    if (reviewActiveRef.current) return; // 오답 다시 풀기: 초기 상태에서 이미 풀이 화면 구성
    const state = location.state as QuizLocationState;
    // 진단 퀴즈: 전 범위 기초 문제로 현재 수준을 확인하는 모드. 쉬움·5문항을 기본값으로 둔다.
    if (state?.diagnostic) {
      diagnosticPendingRef.current = true;
      setCount(5);
      setDifficulty("쉬움");
    }
    const course = state?.course || state?.selectedCourse;
    if (course) {
      fromDashboardRef.current = Boolean(state.fromDashboard);
      if (state.template) pendingTemplateRef.current = state.template;
      if (state.materialIds) pendingMaterialIdsRef.current = state.materialIds;
      if (state.openQuiz && state.quizSetId) pendingQuizSetIdRef.current = state.quizSetId;
      courseDetailFromRouteRef.current = true;
      setSelectedCourse(course);
      setView("courseDetail");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 과목 선택 시 Supabase에서 마크다운 + 요약본 로드
  useEffect(() => {
    let ignore = false;

    if (reviewActiveRef.current) return; // 오답 다시 풀기 진입 시에는 과목 로드로 풀이 상태를 덮어쓰지 않음

    if (!selectedCourse) {
      setMaterials([]);
      setSelectedMaterialIds([]);
      setSavedSummaries([]);
      setMaterialSources({});
      setUploadedFileName("");
      setExtractError("");
      setMaterialNotice("");
      setOpenedQuizTitle("");
      setActiveQuizSetId(null);
      setQuizAttempts([]);
      setPriorQuizSets([]);
      return;
    }

    const applyCourseMaterials = (
      courseMaterials: CourseMaterial[],
      summaries: SavedSummary[],
      quizSets: SavedQuizSet[],
      attempts: SavedQuizAttempt[],
    ) => {
      if (ignore) return;
      setMaterials(courseMaterials);
      setQuizAttempts(attempts);
      setPriorQuizSets(quizSets);

      // MINDMAP은 퀴즈 소스로 부적합 (JSON 구조)
      const usable = summaries.filter(s => s.template !== "MINDMAP");
      setSavedSummaries(usable);

      // 이어풀기로 복원된 풀이 상태(선택 자료·세트·난이도 등)를 로드 완료가 덮어쓰지 않게 한다.
      if (resumedDraftRef.current) return;

      const pendingMaterialIds = pendingMaterialIdsRef.current;
      pendingMaterialIdsRef.current = null;
      const validPendingIds = pendingMaterialIds?.filter(id => courseMaterials.some(material => material.id === id)) || [];
      const initialMaterialIds = validPendingIds.length > 0 ? validPendingIds : courseMaterials.map(material => material.id);
      setSelectedMaterialIds(initialMaterialIds);

      const initialMaterialNames = courseMaterials
        .filter(material => initialMaterialIds.includes(material.id))
        .map(material => material.name);
      const matchingSummaries = usable.filter(s =>
        sameMaterialIds(s.materialIds, initialMaterialIds) ||
        sameMaterialNames(s.materialNames, initialMaterialNames) ||
        (!s.materialIds && sameMaterialIds(initialMaterialIds, courseMaterials.map(material => material.id)))
      );
      const pt = pendingTemplateRef.current;
      pendingTemplateRef.current = null;
      const defaultSource: QuizSource =
        pt && matchingSummaries.some(s => s.template === pt)
          ? pt
          : matchingSummaries.some(s => s.template === "GENERAL")
            ? "GENERAL"
            : "raw";

      setMaterialSources(Object.fromEntries(courseMaterials.map(material => {
        const materialSummaries = usable
          .filter(s =>
            sameMaterialIds(s.materialIds, [material.id]) ||
            sameMaterialNames(s.materialNames, [material.name])
          )
          .sort((a, b) => {
            const aExact = sameMaterialIds(a.materialIds, [material.id]) || sameMaterialNames(a.materialNames, [material.name]);
            const bExact = sameMaterialIds(b.materialIds, [material.id]) || sameMaterialNames(b.materialNames, [material.name]);
            if (aExact !== bExact) return aExact ? -1 : 1;
            return b.createdAt - a.createdAt;
          });
        const source: QuizSource =
          pt && materialSummaries.some(s => s.template === pt)
            ? pt
            : materialSummaries.some(s => s.template === defaultSource)
              ? defaultSource
              : materialSummaries.some(s => s.template === "GENERAL")
                ? "GENERAL"
                : "raw";
        return [material.id, source];
      })));
      setUploadedFileName("");
      setExtractError("");
      setMaterialNotice("");

      const pendingQuizSetId = pendingQuizSetIdRef.current;
      if (pendingQuizSetId) {
        pendingQuizSetIdRef.current = null;
        const savedQuizSet = quizSets.find(item => item.id === pendingQuizSetId);
        if (savedQuizSet) {
          const latestAttempt = attempts.find(attempt => attempt.quizSetId === savedQuizSet.id);
          const shuffledQuestions = shuffleQuizOptions(savedQuizSet.questions, savedQuizSet.questionType);
          const restored = latestAttempt ? buildAnswersFromAttempt({ ...savedQuizSet, questions: shuffledQuestions }, latestAttempt) : null;
          setDifficulty(savedQuizSet.difficulty);
          setQuestionType(savedQuizSet.questionType);
          setCount(savedQuizSet.count);
          setSelectedMaterialIds(savedQuizSet.materialIds.filter(id => courseMaterials.some(material => material.id === id)));
          setQuizzes(shuffledQuestions);
          setCurrent(0);
          setAnswers(restored?.answers || {});
          setShortAnswerInput("");
          setShowExplanation(false);
          setOpenedQuizTitle(savedQuizSet.title);
          setActiveQuizSetId(savedQuizSet.id);
          setSubjectiveGrades(restored?.subjectiveGrades || {});
          setRemainingSeconds(null);
          setQuizStartedAt(latestAttempt ? null : Date.now());
          setTimedOut(latestAttempt?.timedOut || false);
          setAttemptSavedKey(latestAttempt ? `review:${latestAttempt.id}` : "");
          setAttemptSaveNotice(latestAttempt ? "저장된 풀이 기록을 불러왔습니다." : "");
          setReviewAttempt(latestAttempt || null);
          setView(latestAttempt ? "result" : "quiz");
        }
      } else {
        setOpenedQuizTitle("");
        setActiveQuizSetId(null);
        setReviewAttempt(null);
        const recommended = getRecommendedDifficulty(attempts);
        if (recommended) setDifficulty(recommended);
      }
    };

    Promise.all([
      loadCourseMaterialsFromServer(selectedCourse, { includeMarkdown: true }),
      loadSummariesFromServer(selectedCourse, { includeContent: true }),
      loadQuizSetsFromServer(selectedCourse, { includeQuestions: true }),
      loadQuizAttemptsFromServer(selectedCourse, { includeAnswers: true }),
    ])
      .then(([courseMaterials, summaries, quizSets, attempts]) => {
        applyCourseMaterials(courseMaterials, summaries, quizSets, attempts);
      })
      .catch(error => {
        if (!ignore) setExtractError(error instanceof Error ? error.message : "강의자료 불러오기 실패");
      });

    return () => {
      ignore = true;
    };
  }, [selectedCourse]);
  // spin 애니메이션 CSS 한 번만 주입
  useEffect(() => {
    const id = "tongkk-spin";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = "@keyframes spin { to { transform: rotate(360deg); }}";
      document.head.appendChild(style);
    }
    return () => { document.getElementById("tongkk-spin")?.remove(); };
  }, []);

  // 퀴즈 풀이/생성 중 브라우저 이탈 방지
  useEffect(() => {
    // 복습(읽기 전용) 화면은 잃을 진행 상태가 없으므로 이탈 경고에서 제외한다.
    if ((view !== "quiz" && view !== "generating") || reviewMode) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [view, reviewMode]);

  // 풀이 진행 상태를 세션에 스냅샷 — 새로고침·이탈 후 "이어서 풀기"로 복구한다.
  // 오답 다시 풀기(reviewActiveRef)는 원본 문항이 오답 노트에 남아 있어 제외한다.
  useEffect(() => {
    if (view !== "quiz" || reviewMode || reviewActiveRef.current || quizzes.length === 0 || !selectedCourse) return;
    writeQuizDraft({
      course: selectedCourse,
      quizzes,
      current,
      answers,
      subjectiveGrades,
      questionType,
      difficulty,
      examMode,
      remainingSeconds,
      quizStartedAt,
      openedQuizTitle,
      activeQuizSetId,
      selectedMaterialIds,
      savedAt: Date.now(),
    });
  }, [
    view, reviewMode, quizzes, current, answers, subjectiveGrades, questionType, difficulty,
    examMode, remainingSeconds, quizStartedAt, openedQuizTitle, activeQuizSetId, selectedMaterialIds, selectedCourse,
  ]);

  // 결과 화면에 도달하면 풀이가 끝난 것이므로 스냅샷을 지운다.
  useEffect(() => {
    if (view !== "result") return;
    clearQuizDraft();
    setResumableDraft(null);
  }, [view]);

  // 과목 설정 화면의 "이어서 풀기" — 스냅샷 상태를 그대로 복원해 풀이 화면으로 진입한다.
  const resumeDraft = () => {
    const draft = resumableDraft;
    if (!draft || draft.course !== selectedCourse) return;
    resumedDraftRef.current = true;
    const safeCurrent = Math.min(Math.max(draft.current, 0), draft.quizzes.length - 1);
    setQuizzes(draft.quizzes);
    setCurrent(safeCurrent);
    setAnswers(draft.answers || {});
    setSubjectiveGrades(draft.subjectiveGrades || {});
    setQuestionType(draft.questionType);
    setDifficulty(draft.difficulty);
    setExamMode(draft.examMode);
    setRemainingSeconds(draft.remainingSeconds);
    setQuizStartedAt(draft.quizStartedAt ?? Date.now());
    setOpenedQuizTitle(draft.openedQuizTitle);
    setActiveQuizSetId(draft.activeQuizSetId);
    if (draft.selectedMaterialIds.length > 0) setSelectedMaterialIds(draft.selectedMaterialIds);
    setShortAnswerInput("");
    setShowExplanation(draft.answers?.[safeCurrent] !== undefined && !draft.examMode);
    setTimedOut(false);
    setAttemptSavedKey("");
    setAttemptSaveNotice("");
    setReviewAttempt(null);
    setReviewMode(false);
    setError(null);
    setResumableDraft(null);
    setView("quiz");
  };

  const dismissDraft = () => {
    clearQuizDraft();
    setResumableDraft(null);
  };

  const handleCourseBack = () => {
    // 자료 목록(materialList)을 거쳐 들어온 경우 이전 화면인 자료 목록으로 돌아간다.
    if (!courseDetailFromRouteRef.current) {
      setView("materialList");
      return;
    }
    // 자료 요약/대시보드 등 외부 라우트에서 직접 진입한 경우에만 해당 라우트로 이동.
    navigate(pageRoutes["자료 요약"], {
      state: { selectedCourse, fromDashboard: fromDashboardRef.current },
    });
  };

  const handleFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList || isExtracting) return;
    if (!selectedCourse) return;

    const supportedFiles = Array.from(fileList).filter(isSupportedDocumentFile);
    if (supportedFiles.length === 0) {
      setMaterialNotice("PDF, PPT/PPTX, DOCX, TXT/MD, 이미지 파일만 업로드할 수 있습니다.");
      setUploadedFileName("");
      setExtractError("");
      return;
    }

    const existingIds = new Set(materials.map(material => material.id));
    const existingNames = new Set(materials.map(material => material.name.trim().toLowerCase()));
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const duplicateNames: string[] = [];
    const duplicateFiles: File[] = [];
    const newFiles = supportedFiles.filter(file => {
      const fileId = getFileMaterialId(file);
      const fileNameKey = file.name.trim().toLowerCase();
      const isDuplicate = existingIds.has(fileId) || existingNames.has(fileNameKey) || seenIds.has(fileId) || seenNames.has(fileNameKey);
      seenIds.add(fileId);
      seenNames.add(fileNameKey);
      if (isDuplicate) {
        duplicateNames.push(file.name);
        duplicateFiles.push(file);
      }
      return !isDuplicate;
    });

    if (duplicateNames.length > 0) {
      setMaterialNotice(`이미 등록된 파일입니다: ${Array.from(new Set(duplicateNames)).join(", ")}`);
    } else {
      setMaterialNotice("");
    }
    if (newFiles.length === 0) {
      let didAttachFile = false;
      const nextMaterials = [...materials];
      for (const file of duplicateFiles) {
        const fileId = getFileMaterialId(file);
        const fileNameKey = file.name.trim().toLowerCase();
        const index = nextMaterials.findIndex(material =>
          material.id === fileId || material.name.trim().toLowerCase() === fileNameKey
        );
        if (index < 0 || nextMaterials[index].filePath) continue;
        try {
          nextMaterials[index] = await uploadCourseMaterialFile(selectedCourse, nextMaterials[index], file);
          didAttachFile = true;
        } catch (err) {
          setExtractError(err instanceof Error ? `원본 파일 저장 실패: ${err.message}` : "원본 파일 저장 실패");
        }
      }
      if (didAttachFile) {
        await saveCourseMaterials(selectedCourse, nextMaterials);
        setMaterials(nextMaterials);
      }
      setUploadedFileName("");
      return;
    }

    setUploadedFileName(formatFileNames(newFiles));
    setIsExtracting(true);
    setExtractError("");
    const uploadedMaterials: CourseMaterial[] = [];
    const failedNames: string[] = [];

    try {
      for (const file of newFiles) {
        try {
          const [markdown, pageCount] = await Promise.all([
            extractMarkdownFromMaterialFile(file),
            getDocumentMaterialType(file) === "pdf" ? getPdfPageCount(file) : Promise.resolve(null),
          ]);
          const baseMaterial: CourseMaterial = {
            id: getFileMaterialId(file),
            name: file.name,
            size: file.size,
            type: getDocumentMaterialType(file),
            pages: pageCount,
            slides: null,
            markdown,
            updatedAt: Date.now(),
          };
          try {
            uploadedMaterials.push(await uploadCourseMaterialFile(selectedCourse, baseMaterial, file));
          } catch {
            uploadedMaterials.push(baseMaterial);
          }
        } catch {
          failedNames.push(file.name);
        }
      }

      if (uploadedMaterials.length > 0) {
        const nextMaterials = [...materials, ...uploadedMaterials];
        await saveCourseMaterials(selectedCourse, nextMaterials);
        setMaterials(nextMaterials);
        setSelectedMaterialIds(prev => Array.from(new Set([...prev, ...uploadedMaterials.map(material => material.id)])));
        setMaterialSources(prev => ({
          ...prev,
          ...Object.fromEntries(uploadedMaterials.map(material => [material.id, "raw" as QuizSource])),
        }));
      }
      if (failedNames.length > 0) {
        setExtractError(`${failedNames.join(", ")} 변환 실패`);
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const getMaterialSummaries = (material: CourseMaterial) =>
    savedSummaries
      .filter(s =>
        sameMaterialIds(s.materialIds, [material.id]) ||
        sameMaterialNames(s.materialNames, [material.name])
      )
      .sort((a, b) => {
        const aExact = sameMaterialIds(a.materialIds, [material.id]) || sameMaterialNames(a.materialNames, [material.name]);
        const bExact = sameMaterialIds(b.materialIds, [material.id]) || sameMaterialNames(b.materialNames, [material.name]);
        if (aExact !== bExact) return aExact ? -1 : 1;
        return b.createdAt - a.createdAt;
      });

  const getDefaultMaterialSource = (material: CourseMaterial): QuizSource =>
    getMaterialSummaries(material).some(s => s.template === "GENERAL") ? "GENERAL" : "raw";

  const getMaterialSource = (material: CourseMaterial): QuizSource =>
    materialSources[material.id] || getDefaultMaterialSource(material);

  const buildMaterialSourceMarkdown = (courseMaterials: CourseMaterial[]) => {
    const usedSummaryKeys = new Set<string>();

    return courseMaterials
      .map(material => {
        const source = getMaterialSource(material);
        const summary = source === "raw"
          ? null
          : getMaterialSummaries(material).find(s => s.template === source);
        const label = source === "raw" ? "원본 자료" : sourceLabels[source];

        if (summary) {
          const summaryKey = `${summary.template}:${summary.createdAt}:${(summary.materialIds || []).join("|")}`;
          if (usedSummaryKeys.has(summaryKey)) return "";
          usedSummaryKeys.add(summaryKey);

          const summaryMaterials = summary.materialIds
            ? materials.filter(item => summary.materialIds?.includes(item.id))
            : courseMaterials;
          const title = summaryMaterials.length > 1
            ? summaryMaterials.map(item => item.name).join(", ")
            : material.name;

          return `# ${title} (${label})\n\n${summary.content}`;
        }

        return `# ${material.name} (${label})\n\n${material.markdown}`;
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  };

  const selectedMaterials = materials.filter(material => selectedMaterialIds.includes(material.id));
  // 페이지 선택은 '실제로 출제에 보낼' 자료에 페이지 마커가 있을 때만 동작한다.
  // 자료 출처를 요약으로 고르면(요약엔 마커가 없음) 백엔드가 페이지 필터를 무시하므로,
  // 출처가 '원본'이면서 그 원본에 마커가 있는 경우에만 입력을 연다.
  const selectedHasPageMarkers = selectedMaterials.some(
    material => getMaterialSource(material) === "raw" && hasPageMarkers(material.markdown),
  );
  // 원본엔 마커가 있는데 출처를 요약으로 골라 페이지 선택을 못 쓰는 경우를 구분해 안내하기 위함.
  const selectedRawHasPageMarkers = selectedMaterials.some(material => hasPageMarkers(material.markdown));
  // 페이지 범위 힌트는 자료가 하나일 때만 명확하므로 그 경우에만 보여준다.
  const quizPageHint = selectedMaterials.length === 1 && selectedMaterials[0].pages
    ? `총 ${selectedMaterials[0].pages}p`
    : "";

  const generate = async () => {
    if (!selectedCourse.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setView("generating");
    setError(null);
    // 새 퀴즈를 만들면 이전 풀이 스냅샷 배너는 의미가 없어진다(스냅샷 자체는 새 풀이로 덮인다).
    setResumableDraft(null);
    const markdownToUse = buildMaterialSourceMarkdown(selectedMaterials);
    // 진단 모드는 대시보드에서 넘어온 첫 생성 1회에만 적용.
    const diagnostic = diagnosticPendingRef.current;
    diagnosticPendingRef.current = false;
    // 이미 풀었거나 출제된 문제(풀이 기록 + 저장된 퀴즈 세트 + 직전 퀴즈)를 모아 중복 출제를 막는다.
    const priorQuestions = Array.from(new Set([
      ...quizAttempts.flatMap(attempt => attempt.answers.map(answer => answer.question)),
      ...priorQuizSets.flatMap(set => set.questions.map(question => question.question)),
      ...quizzes.map(quiz => quiz.question),
    ].filter(Boolean)));
    // 정규화 키 집합. 백엔드가 제외 지시를 어겨도 생성 결과에서 과거 문제와 같은(거의 같은) 문항을 프런트에서 한 번 더 걸러낸다.
    const seenKeys = new Set(priorQuestions.map(normalizeAnswer));
    try {
      const collected: QuizQuestion[] = [];
      let lastGenerated: QuizQuestion[] = [];
      // 중복으로 문항이 모자라면 모자란 만큼 더 생성해 채운다(최대 3회). 같은 문제가 반복되지 않게 한다.
      for (let round = 0; round < 3 && collected.length < count; round++) {
        const excludeQuestions = Array.from(new Set([
          ...priorQuestions,
          ...collected.map(quiz => quiz.question),
        ])).slice(0, 80);
        const generated = await generateQuiz(selectedCourse, count - collected.length, difficulty, markdownToUse, controller.signal, questionType, excludeQuestions, diagnostic, selectedHasPageMarkers ? quizPageRange : "", quizFocusPrompt);
        lastGenerated = generated;
        for (const question of generated) {
          const key = normalizeAnswer(question.question || "");
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          collected.push(question);
          if (collected.length >= count) break;
        }
      }
      // 극단적으로 모두 걸러진 경우엔 빈 퀴즈를 피하려 마지막 생성분의 자체 중복만 제거해 사용한다.
      let deduped = collected;
      if (deduped.length === 0) {
        const selfSeen = new Set<string>();
        deduped = lastGenerated.filter(question => {
          const key = normalizeAnswer(question.question || "");
          if (!key || selfSeen.has(key)) return false;
          selfSeen.add(key);
          return true;
        });
      }
      const questions = shuffleQuizOptions(deduped, questionType);
      setQuizzes(questions);
      const savedQuizSet = await saveQuizSetToServer(selectedCourse, {
        title: `${selectedCourse} ${questionType} 퀴즈`,
        difficulty,
        questionType,
        count: questions.length,
        materialIds: selectedMaterialIds,
        questions,
      });
      setPriorQuizSets(prev => [savedQuizSet, ...prev]);
      setOpenedQuizTitle(savedQuizSet.title);
      setActiveQuizSetId(savedQuizSet.id);
      setCurrent(0);
      setAnswers({});
      setShortAnswerInput("");
      setSubjectiveGrades({});
      setShowExplanation(false);
      setRemainingSeconds(examMode ? examMinutes * 60 : null);
      setQuizStartedAt(Date.now());
      setTimedOut(false);
      setAttemptSavedKey("");
      setAttemptSaveNotice("");
      setReviewAttempt(null);
      setReviewMode(false);
      setView("quiz");
    } catch (err) {
      if (controller.signal.aborted) {
        setView("courseDetail");
        return;
      }
      setError(err instanceof Error ? err.message : "퀴즈 생성에 실패했습니다.");
      setView("courseDetail");
    }
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
  };

  const selectAnswer = (idx: number) => {
    if (reviewMode) return; // 복습 모드는 읽기 전용이라 답을 바꾸지 않는다.
    if (!examMode && answers[current] !== undefined) return;
    setAnswers(prev => ({ ...prev, [current]: idx }));
    setShowExplanation(!examMode);
  };

  const submitShortAnswer = () => {
    const value = shortAnswerInput.trim();
    if (!value || answers[current] !== undefined) return;
    setAnswers({ ...answers, [current]: value });
    setShowExplanation(!examMode);
  };

  const submitSubjectiveAnswer = async () => {
    const value = shortAnswerInput.trim();
    const currentQuiz = quizzes[current];
    if (!value || answers[current] !== undefined || !currentQuiz) return;
    setGrading(true);
    setError(null);
    try {
      const grade = await gradeSubjectiveAnswer(
        currentQuiz.question,
        currentQuiz.answerText || currentQuiz.explanation,
        value,
        buildMaterialSourceMarkdown(selectedMaterials),
      );
      setAnswers(prev => ({ ...prev, [current]: value }));
      setSubjectiveGrades(prev => ({ ...prev, [current]: grade }));
      setShowExplanation(!examMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "주관식 채점에 실패했습니다.");
    } finally {
      setGrading(false);
    }
  };

  // 활성 풀이: 미응답 상태로 다음으로 넘어가려 하면 한 번 경고하고, 확인하면 이동한다.
  // (다음 버튼·→ 방향키·단답형 Enter 이동 모두 이 경로를 거치므로, 안 푼 채 건너뛰면 항상 경고가 뜬다.)
  const goNextActive = () => {
    if (current >= quizzes.length - 1) return;
    if (answers[current] === undefined && !window.confirm("정답을 선택하지 않았습니다.\n그래도 다음 문제로 이동할까요?")) return;
    goToQuestion(current + 1);
  };

  // 퀴즈 제출: 아직 풀지 않은 문항이 있으면 번호를 알려주고, 해당 문항으로 이동할지 선택하게 한다(취소 시 그대로 제출).
  const submitQuiz = () => {
    const unanswered = quizzes.map((_, index) => index).filter(index => answers[index] === undefined);
    if (unanswered.length > 0) {
      const numbers = unanswered.map(index => index + 1).join(", ");
      if (window.confirm(`아직 풀지 않은 문제가 있습니다: ${numbers}번\n해당 문제로 이동할까요?\n(취소를 누르면 그대로 제출합니다.)`)) {
        goToQuestion(unanswered[0]);
        return;
      }
    }
    setView("result");
  };

  // 특정 문항으로 이동(복습/탐색용). 해설 표시는 모드와 응답 여부에 맞춰 갱신한다.
  const goToQuestion = (index: number) => {
    if (index < 0 || index >= quizzes.length) return;
    setCurrent(index);
    setShortAnswerInput("");
    setShowExplanation(reviewMode || (answers[index] !== undefined && !examMode));
  };

  // 결과 화면의 '오답 복습'에서 해당 문항의 풀이 화면(정답·오답 표시)으로 진입한다.
  const goToQuestionReview = (index: number) => {
    setReviewMode(true);
    setCurrent(index);
    setShortAnswerInput("");
    setShowExplanation(true);
    setView("quiz");
  };

  // 복습 화면에서 결과 화면으로 되돌아간다.
  const exitReviewToResult = () => {
    setReviewMode(false);
    setView("result");
  };

  const isQuestionCorrect = useCallback((quiz: QuizQuestion, index: number, answerValue: number | string | undefined) => {
    if (answerValue === undefined) return false;
    const type = quiz.type || questionType;
    if (type === "주관식") {
      return subjectiveGrades[index]?.isCorrect || false;
    }
    if (type === "단답형") {
      return typeof answerValue === "string" && typeof quiz.answerText === "string" && isShortAnswerCorrect(answerValue, quiz.answerText);
    }
    return typeof answerValue === "number" && quiz.answer === answerValue;
  }, [questionType, subjectiveGrades]);

  const correctCount = Object.entries(answers).filter(([k, v]) => {
    const quiz = quizzes[parseInt(k)];
    if (!quiz) return false;
    return isQuestionCorrect(quiz, parseInt(k), v);
  }).length;
  const scorePercent = quizzes.length > 0 ? Math.round((correctCount / quizzes.length) * 100) : 0;
  const wrongQuestions = quizzes.filter((quiz, index) => !isQuestionCorrect(quiz, index, answers[index]));
  const resultWeakTopics = uniqueWeakTopics(wrongQuestions);
  const recommendedDifficulty = getRecommendedDifficulty(quizAttempts);

  useEffect(() => {
    if (view !== "quiz" || !examMode || remainingSeconds === null || remainingSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === null) return prev;
        if (prev <= 1) {
          window.setTimeout(() => {
            setTimedOut(true);
            setShowExplanation(false);
            setView("result");
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [view, examMode, remainingSeconds]);


  // 키보드로 문항 이동(이슈 #61): 방향키(←/→)로 이전·다음 문제, 스페이스·엔터로 다음(마지막
  // 문항이면 제출). 단답형 입력칸에서 Enter는 (아직 제출 전이고 입력이 있으면) 먼저 제출해 정답을
  // 공개하고, 제출 뒤 입력칸이 disabled로 풀려 포커스를 잃은 다음 Enter부터 다음 문항으로 넘어간다.
  // 주관식 textarea·입력 중에는 가로채지 않아 타이핑/줄바꿈을 보존한다. 미응답 상태로 앞으로
  // 넘어가면 goNextActive가 경고창을 띄운다. 시간 종료(timedOut)·풀이 화면이 아닐 때·사이드바나
  // 튜토리얼 안내가 떠 있을 때는 동작하지 않고, 복습 모드에서는 이동만 허용한다.
  useEffect(() => {
    if (view !== "quiz" || timedOut) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return; // 한글 등 IME 조합 중에는 무시
      if (sidebar || activeTutorialKey) return; // 사이드바·튜토리얼 안내가 떠 있으면 뒤쪽 퀴즈를 건드리지 않는다.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (e.key === "ArrowLeft") {
        if (typing) return; // 입력 중에는 커서 이동을 보존
        e.preventDefault();
        goToQuestion(current - 1);
        return;
      }
      if (e.key === "ArrowRight") {
        if (typing) return;
        e.preventDefault();
        if (reviewMode) goToQuestion(current + 1); else goNextActive(); // 미응답이면 goNextActive가 경고
        return;
      }
      if (reviewMode) return; // 복습 모드는 이동만(선택·제출 없음)
      // 단답형 입력칸에서 Enter: 아직 제출 전이고 입력이 있으면 먼저 제출(정답 공개). 다음 Enter부터 이동.
      if (e.key === "Enter" && tag === "INPUT"
          && (quizzes[current]?.type || questionType) === "단답형"
          && answers[current] === undefined && shortAnswerInput.trim()) {
        e.preventDefault();
        submitShortAnswer();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        // 입력칸·버튼·링크에 포커스가 있으면 그 요소의 기본 동작(타이핑·클릭)에 맡긴다.
        if (typing || tag === "BUTTON" || tag === "A") return;
        e.preventDefault();
        if (current >= quizzes.length - 1) submitQuiz();
        else goNextActive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, timedOut, reviewMode, current, quizzes, questionType, answers, shortAnswerInput, goToQuestion, goNextActive, submitQuiz, submitShortAnswer, sidebar, activeTutorialKey]);

  useEffect(() => {
    if (view !== "result" || quizzes.length === 0 || !selectedCourse) return;
    if (reviewAttempt) return;
    const durationSeconds = quizStartedAt ? Math.max(0, Math.round((Date.now() - quizStartedAt) / 1000)) : null;
    const key = `${activeQuizSetId || openedQuizTitle}:${quizStartedAt || "no-start"}:${scorePercent}:${Object.keys(answers).length}:${timedOut}`;
    if (attemptSavedKey === key) return;

    setAttemptSavedKey(key);
    setAttemptSaveNotice("풀이 기록 저장 중...");
    const attemptAnswers: QuizAttemptAnswer[] = quizzes.map((quiz, index) => {
      const answerValue = answers[index];
      const type = quiz.type || questionType;
      const subjectiveGrade = subjectiveGrades[index];
      const correctAnswer = type === "객관식" || type === "OX"
        ? typeof quiz.answer === "number" ? quiz.options?.[quiz.answer] || quiz.answer : null
        : quiz.answerText || null;
      const studentAnswer = type === "객관식" || type === "OX"
        ? typeof answerValue === "number" ? quiz.options?.[answerValue] || answerValue : null
        : typeof answerValue === "string" ? answerValue : null;

      return {
        question: quiz.question,
        type,
        studentAnswer,
        correctAnswer,
        isCorrect: isQuestionCorrect(quiz, index, answerValue),
        score: subjectiveGrade?.score,
        feedback: subjectiveGrade?.feedback,
        explanation: quiz.explanation,
      };
    });
    saveQuizAttemptToServer(selectedCourse, {
      quizSetId: activeQuizSetId,
      difficulty,
      questionType,
      count: quizzes.length,
      correctCount,
      scorePercent,
      weakTopics: resultWeakTopics,
      answers: attemptAnswers,
      durationSeconds,
      timedOut,
      materialIds: selectedMaterialIds,
    })
      .then(savedAttempt => {
        setQuizAttempts(prev => [savedAttempt, ...prev]);
        setAttemptSaveNotice("풀이 기록이 저장되었습니다.");
      })
      .catch(err => {
        setAttemptSaveNotice(err instanceof Error ? `풀이 기록 저장 실패: ${err.message}` : "풀이 기록 저장에 실패했습니다.");
      });
  }, [
    view,
    quizzes,
    selectedCourse,
    quizStartedAt,
    activeQuizSetId,
    openedQuizTitle,
    scorePercent,
    answers,
    timedOut,
    attemptSavedKey,
    isQuestionCorrect,
    difficulty,
    questionType,
    correctCount,
    resultWeakTopics,
    selectedMaterialIds,
    subjectiveGrades,
    reviewAttempt,
  ]);

  const handleNav = (item: PageRouteLabel) => {
    if (view === "quiz" && !reviewMode) {
      // 일반 풀이는 스냅샷이 남아 "이어서 풀기"로 복구되지만, 오답 다시 풀기는 스냅샷 대상이 아니다.
      const message = reviewActiveRef.current
        ? "퀴즈 풀이 중입니다. 진행 상태가 저장되지 않습니다.\n페이지를 떠나시겠습니까?"
        : "퀴즈 풀이 중입니다. 나중에 이 과목 퀴즈 화면에서 이어서 풀 수 있어요.\n페이지를 떠나시겠습니까?";
      if (!window.confirm(message)) {
        setSidebar(false);
        return;
      }
    }
    navigate(pageRoutes[item]);
  };

  const sidebarEl = (
    <>
      {sidebar && <Sidebar active="퀴즈 생성" onNav={handleNav} onClose={() => setSidebar(false)} />}
    </>
  );

  // 단독 과목 선택/자료 목록 브라우징 제거: 핸드오프 없이 진입하면 대시보드로 보낸다.
  // 게스트도 마찬가지 — 새로고침으로 history state가 재생돼도 진입을 막는다.
  if (!user || view === "courseList" || view === "materialList") {
    return <Navigate to={pageRoutes["대시보드"]} replace />;
  }

  // ── 과목 세부 (자료 + 설정) ──
  if (view === "courseDetail") {
    const canGenerate = !isExtracting && selectedMaterials.length > 0;
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} extra={<TutorialHelpButton tutorialKey="quiz-setup" />} />
        <div className="app-container narrow">
          <button type="button" onClick={handleCourseBack} style={{
            background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
          }}>← 돌아가기</button>

          <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "var(--color-text-strong)" }}>{selectedCourse}</h2>

          {error && (
            <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "var(--color-tint-pink)", border: `1px solid ${PINK}`, fontSize: 13, color: PINK }}>
              {error}
            </div>
          )}

          {resumableDraft && resumableDraft.course === selectedCourse && (
            <Card style={{ padding: "16px 20px", marginBottom: 16, border: `1px solid ${CYAN}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ margin: "0 0 3px", fontSize: 14, fontWeight: 800, color: "var(--color-text-strong)" }}>풀던 퀴즈가 있어요</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-secondary)" }}>
                    {resumableDraft.openedQuizTitle || `${resumableDraft.course} 퀴즈`} · {Object.keys(resumableDraft.answers || {}).length}/{resumableDraft.quizzes.length}문항 응답
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={dismissDraft}
                    style={{
                      padding: "8px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                      background: "var(--color-card)", color: "var(--color-muted)", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >지우기</button>
                  <button
                    type="button"
                    onClick={resumeDraft}
                    style={{
                      padding: "8px 14px", borderRadius: 10, border: "none",
                      background: CYAN, color: "var(--color-on-brand)", fontSize: 13, fontWeight: 800, cursor: "pointer",
                    }}
                  >이어서 풀기</button>
                </div>
              </div>
            </Card>
          )}

          <Card style={{ padding: 20, marginBottom: 16, border: "1px solid var(--color-tint-cyan)", background: "color-mix(in srgb, var(--color-cyan) 6%, var(--color-card))" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)" }}>페이스메이커</h3>
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  {getDifficultyReason(quizAttempts)}
                </p>
              </div>
              {recommendedDifficulty && (
                <button
                  type="button"
                  onClick={() => setDifficulty(recommendedDifficulty)}
                  style={{
                    flexShrink: 0,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: CYAN,
                    color: "var(--color-on-brand)",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {recommendedDifficulty} 적용
                </button>
              )}
            </div>
            {quizAttempts[0] && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-muted)" }}>
                최근 점수 {quizAttempts[0].scorePercent}% · {quizAttempts[0].questionType} · {quizAttempts[0].difficulty}
              </div>
            )}
          </Card>

          {/* 강의자료 업로드 */}
          <Card style={{ padding: 24, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>강의자료</h3>

            <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff"
              onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
              style={{ display: "none" }} />

            {materials.length > 0 && (
              <div style={{
                padding: "12px 16px", borderRadius: 10, background: "var(--color-tint-cyan)",
                fontSize: 13, color: CYAN, marginBottom: 14, fontWeight: 800
              }}>
                저장된 강의자료 {materials.length}개 중 {selectedMaterials.length}개가 퀴즈에 반영됩니다
              </div>
            )}
            {materials.length === 0 && (
              <div style={{
                padding: "12px 16px", borderRadius: 10, background: "var(--color-surface)",
                fontSize: 13, color: "var(--color-muted)", marginBottom: 14
              }}>
                아직 저장된 자료가 없어요. 퀴즈를 만들려면 PDF·PPT·이미지·문서를 먼저 업로드하세요.
              </div>
            )}

            {materials.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 10 }}>
                  <button type="button" onClick={() => setSelectedMaterialIds(materials.map(material => material.id))} style={{ border: `1px solid ${BORDER_COLOR}`, background: "var(--color-card)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "var(--color-text-secondary)", cursor: "pointer" }}>전체 선택</button>
                  <button type="button" onClick={() => setSelectedMaterialIds([])} style={{ border: `1px solid ${BORDER_COLOR}`, background: "var(--color-card)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "var(--color-text-secondary)", cursor: "pointer" }}>전체 해제</button>
                </div>
                {materials.map(material => {
                  const isSelected = selectedMaterialIds.includes(material.id);
                  const materialSummaries = getMaterialSummaries(material);
                  const source = getMaterialSource(material);
                  const sourceOptions: { value: QuizSource; label: string }[] = [
                    { value: "raw", label: "원본" },
                    ...materialSummaries.reduce<{ value: QuizSource; label: string }[]>((options, summary) => {
                      if (options.some(option => option.value === summary.template)) return options;
                      return [...options, { value: summary.template, label: sourceLabels[summary.template] }];
                    }, []),
                  ];
                  return (
                    <div key={material.id} style={{
                      display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, alignItems: "center",
                      padding: "12px 14px", borderRadius: 10, marginBottom: 8,
                      background: isSelected ? "var(--color-tint-cyan)" : MUTED_SURFACE,
                      border: isSelected ? "1px solid color-mix(in srgb, var(--color-cyan) 35%, transparent)" : `1px solid ${BORDER_COLOR}`,
                    }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          style={{ accentColor: PINK }}
                          onChange={e => {
                            setSelectedMaterialIds(prev =>
                              e.target.checked
                                ? [...prev, material.id]
                                : prev.filter(id => id !== material.id)
                            );
                          }}
                        />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--color-text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {material.name}
                        </span>
                      </label>
                      <div style={{
                        display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 26,
                        opacity: isSelected ? 1 : 0.55
                      }}>
                        {sourceOptions.map(option => {
                          const isActiveSource = source === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={!isSelected}
                              onClick={() => setMaterialSources(prev => ({ ...prev, [material.id]: option.value }))}
                              style={{
                                border: isActiveSource ? "1px solid color-mix(in srgb, var(--color-pink) 24%, transparent)" : `1px solid ${BORDER_COLOR}`,
                                background: isActiveSource ? "color-mix(in srgb, var(--color-pink) 7%, transparent)" : CARD_BACKGROUND,
                                color: isActiveSource ? PINK : "var(--color-text-secondary)",
                                borderRadius: 999,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                lineHeight: 1,
                                cursor: isSelected ? "pointer" : "not-allowed",
                                boxShadow: "none",
                              }}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              className="tongkk-dropzone"
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "color-mix(in srgb, var(--color-cyan) 40%, transparent)" : BORDER_COLOR}`,
                borderRadius: 12, padding: "28px 20px", textAlign: "center",
                cursor: "pointer", background: dragOver ? "var(--color-tint-cyan)" : MUTED_SURFACE,
                transition: "all 0.2s", marginBottom: 12
              }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-muted)" }}>
                강의자료 파일을 여러 개 드래그하거나
              </p>
              <button type="button" style={{
                padding: "7px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                background: "var(--color-card)", fontSize: 13, cursor: "pointer", color: "var(--color-text)"
              }}>파일 선택</button>
            </div>

            {isExtracting && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 14, height: 14, border: `2px solid ${PINK}`, borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: PINK }}>파일 분석 중... ({uploadedFileName})</span>
              </div>
            )}
            {!isExtracting && uploadedFileName && !extractError && (
              <span style={{ fontSize: 13, color: "var(--color-success)" }}>{uploadedFileName} 분석 완료 — 퀴즈에 반영됩니다</span>
            )}
            {!isExtracting && materialNotice && (
              <span style={{ display: "block", marginTop: 8, fontSize: 13, color: CYAN }}>{materialNotice}</span>
            )}
            {!isExtracting && extractError && (
              <span style={{ fontSize: 13, color: "var(--color-danger)" }}>분석 실패: {extractError}</span>
            )}
          </Card>

          {/* 퀴즈 설정 */}
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>퀴즈 설정</h3>

            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", marginBottom: 8, display: "block" }}>문제 수</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {[5, 10, 15, 20].map(n => (
                <button type="button" key={n} onClick={() => setCount(n)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: count === n ? "1px solid color-mix(in srgb, var(--color-pink) 45%, transparent)" : "1px solid var(--color-border-soft)",
                  background: count === n ? "var(--color-tint-pink)" : "var(--color-card)",
                  color: count === n ? PINK : "var(--color-muted)", fontSize: 14, fontWeight: count === n ? 800 : 600, cursor: "pointer"
                }}>{n}문제</button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", marginBottom: 8, display: "block" }}>난이도</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {(["쉬움", "보통", "어려움"] as QuizDifficulty[]).map(d => (
                <button type="button" key={d} onClick={() => setDifficulty(d)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: difficulty === d ? "1px solid color-mix(in srgb, var(--color-pink) 45%, transparent)" : "1px solid var(--color-border-soft)",
                  background: difficulty === d ? "var(--color-tint-pink)" : "var(--color-card)",
                  color: difficulty === d ? PINK : "var(--color-muted)", fontSize: 14, fontWeight: difficulty === d ? 800 : 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", marginBottom: 8, display: "block" }}>문제 유형</label>
            <div className="option-grid-4" style={{ marginBottom: 20 }}>
              {(["객관식", "OX", "단답형", "주관식"] as QuizQuestionType[]).map(t => (
                <button type="button" key={t} onClick={() => setQuestionType(t)} style={{
                  padding: "10px 0", borderRadius: 10,
                  border: questionType === t ? "1px solid color-mix(in srgb, var(--color-pink) 45%, transparent)" : "1px solid var(--color-border-soft)",
                  background: questionType === t ? "var(--color-tint-pink)" : "var(--color-card)",
                  color: questionType === t ? PINK : "var(--color-muted)", fontSize: 14, fontWeight: questionType === t ? 800 : 600, cursor: "pointer"
                }}>{t}</button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "12px 14px", borderRadius: 12, background: "var(--color-surface)", border: "1px solid var(--color-border-soft)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700, color: "var(--color-text-strong)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={examMode}
                  onChange={e => setExamMode(e.target.checked)}
                />
                시험 모드
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-muted)", opacity: examMode ? 1 : 0.5 }}>시간 제한</span>
                {[5, 10, 20].map(minutes => (
                  <button
                    key={minutes}
                    type="button"
                    disabled={!examMode}
                    onClick={() => setExamMinutes(minutes)}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 9,
                      border: examMinutes === minutes ? `1px solid ${CYAN}` : "1px solid var(--color-border-soft)",
                      background: examMinutes === minutes ? "var(--color-tint-cyan)" : "var(--color-card)",
                      color: examMinutes === minutes ? CYAN : "var(--color-muted)",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: examMode ? "pointer" : "not-allowed",
                      opacity: examMode ? 1 : 0.5,
                    }}
                  >
                    {minutes}분
                  </button>
                ))}
              </div>
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", margin: "20px 0 8px", display: "block" }}>
              반영할 페이지 <span style={{ fontWeight: 500 }}>(선택 · 비우면 전체)</span>
            </label>
            {selectedHasPageMarkers ? (
              <input
                value={quizPageRange}
                onChange={e => setQuizPageRange(e.target.value)}
                placeholder={quizPageHint ? `예: 1-5, 8  (${quizPageHint})` : "예: 1-5, 8"}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)", marginBottom: 16 }}
              />
            ) : (
              <div style={{ padding: "10px 12px", borderRadius: 10, background: MUTED_SURFACE, fontSize: 12.5, lineHeight: 1.6, color: "var(--color-text-secondary)", marginBottom: 16 }}>
                {selectedMaterials.length === 0
                  ? "자료를 선택하면 페이지 범위를 지정할 수 있어요."
                  : selectedRawHasPageMarkers
                    ? "자료 출처를 '원본'으로 두면 페이지를 고를 수 있어요. (요약은 페이지 정보가 없어요)"
                    : "선택한 자료에는 페이지 정보가 없어 페이지 선택을 쓸 수 없어요. 파일을 다시 업로드하면 페이지를 고를 수 있어요."}
              </div>
            )}

            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-muted)", marginBottom: 8, display: "block" }}>
              집중할 내용 <span style={{ fontWeight: 500 }}>(선택)</span>
            </label>
            <textarea
              value={quizFocusPrompt}
              onChange={e => setQuizFocusPrompt(e.target.value)}
              placeholder="예: 핵심 정의와 비교 위주로 문제 내줘"
              rows={2}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 14, color: "var(--color-text-strong)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
            />
          </Card>

          {!isExtracting && selectedMaterials.length === 0 && (
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--color-muted)", textAlign: "center" }}>
              {materials.length === 0 ? "자료를 먼저 올려야 퀴즈를 만들 수 있어요." : "반영할 자료를 1개 이상 선택해주세요."}
            </p>
          )}
          <button type="button" onClick={generate} disabled={!canGenerate} style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: canGenerate ? PINK : "var(--color-border-soft)",
            color: canGenerate ? "var(--color-on-brand)" : "var(--color-muted)",
            fontSize: 16, fontWeight: 700,
            cursor: canGenerate ? "pointer" : "not-allowed"
          }}>
            {isExtracting ? "자료 분석 중..." : "퀴즈 생성하기"}
          </button>
        </div>
      </div>
    );
  }

  // ── 생성 중 ──
  if (view === "generating") {
    const sourceName = selectedMaterials.length > 0 ? `자료별 소스 ${selectedMaterials.length}개` : null;
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, border: "3px solid var(--color-border-soft)", borderTop: `3px solid ${PINK}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }}/>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-strong)" }}>AI가 퀴즈를 생성하고 있습니다...</p>
          <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
            {selectedCourse} · {count}문제 · {difficulty} · {questionType}{sourceName ? ` · ${sourceName}` : ""}
          </p>
          <button type="button" onClick={cancelGeneration} style={{
            marginTop: 20, padding: "10px 28px", borderRadius: 10,
            border: "1px solid var(--color-border-soft)", background: "var(--color-card)",
            fontSize: 14, fontWeight: 600, cursor: "pointer", color: "var(--color-muted)"
          }}>취소</button>
        </div>
      </div>
    );
  }

  // ── 결과 ──
  if (view === "result") {
    const nextDifficulty: QuizDifficulty = scorePercent >= 80 ? "어려움" : scorePercent >= 55 ? "보통" : "쉬움";
    const reviewMaterials = selectedMaterials.length > 0
      ? selectedMaterials
      : materials.filter(material => selectedMaterialIds.includes(material.id));
    const primaryReviewMaterial = reviewMaterials[0] || materials[0];
    const formatAnswerForReview = (
      quiz: QuizQuestion,
      answerValue: number | string | undefined,
      correct = false,
    ) => {
      const type = quiz.type || questionType;
      if (type === "객관식" || type === "OX") {
        if (correct && typeof quiz.answer === "number") {
          return quiz.options?.[quiz.answer] || `${quiz.answer + 1}번 선택지`;
        }
        if (typeof answerValue === "number") {
          return quiz.options?.[answerValue] || `${answerValue + 1}번 선택지`;
        }
        return "미응답";
      }
      if (correct) return quiz.answerText || quiz.explanation || "정답 정보 없음";
      return typeof answerValue === "string" && answerValue.trim() ? answerValue : "미응답";
    };
    const wrongReviewItems = wrongQuestions.map(quiz => {
      const questionIndex = quizzes.indexOf(quiz);
      const answerValue = answers[questionIndex];
      const type = quiz.type || questionType;
      const subjectiveGrade = subjectiveGrades[questionIndex];
      return {
        questionIndex,
        question: quiz.question,
        type,
        weakTopic: inferWeakTopicFromQuestion(quiz.question, quiz.explanation),
        studentAnswer: formatAnswerForReview(quiz, answerValue),
        correctAnswer: formatAnswerForReview(quiz, answerValue, true),
        explanation: subjectiveGrade?.feedback || quiz.explanation,
      };
    });
    const quizReviewContext = wrongReviewItems.length > 0
      ? [
          `[이번 퀴즈 오답 ${wrongReviewItems.length}문항]`,
          `과목: ${selectedCourse}`,
          `퀴즈: ${openedQuizTitle || `${selectedCourse} ${questionType} 퀴즈`}`,
          `점수: ${scorePercent}% (${correctCount}/${quizzes.length})`,
          resultWeakTopics.length > 0 ? `약점 후보: ${resultWeakTopics.join(", ")}` : "",
          "",
          ...wrongReviewItems.flatMap(item => [
            `${item.questionIndex + 1}. ${item.question}`,
            `- 유형: ${item.type}`,
            `- 약점 후보: ${item.weakTopic}`,
            `- 내 답: ${item.studentAnswer}`,
            `- 정답: ${item.correctAnswer}`,
            `- 해설/피드백: ${item.explanation}`,
            "",
          ]),
        ].filter(Boolean).join("\n")
      : "";
    // '오답 복습' 헤더의 'AI 튜터로 복습' 버튼이 보낼 질문. 이번 회차 오답 전체를 한 문제씩 다시 설명하도록 요청한다.
    const reviewTutorQuestion = [
      "이번 퀴즈에서 틀린 문제들을 한 문제씩 다시 설명해줘. 각 설명 뒤에는 내가 다시 풀어볼 수 있는 확인 질문을 이어서 내줘.",
      quizReviewContext,
    ].filter(Boolean).join("\n\n");
    const goToMaterialReview = (options?: { materialId?: string; tutorQuestion?: string }) => {
      const materialId = options?.materialId || primaryReviewMaterial?.id;
      if (!materialId) {
        navigate(pageRoutes["자료 요약"], {
          state: { selectedCourse, fromDashboard: fromDashboardRef.current },
        });
        return;
      }

      navigate(pageRoutes["자료 요약"], {
        state: {
          selectedCourse,
          viewMaterial: true,
          materialId,
          materialIds: selectedMaterialIds,
          materialDetailTab: "summary",
          fromDashboard: fromDashboardRef.current,
          tutorQuestion: options?.tutorQuestion,
          quizReviewContext,
          quizReviewTitle: `${openedQuizTitle || "퀴즈"} 오답 복습`,
        },
      });
    };
    const retryQuiz = () => {
      setCurrent(0);
      setAnswers({});
      setSubjectiveGrades({});
      setShortAnswerInput("");
      setShowExplanation(false);
      setRemainingSeconds(examMode ? examMinutes * 60 : null);
      setQuizStartedAt(Date.now());
      setTimedOut(false);
      setAttemptSavedKey("");
      setAttemptSaveNotice("");
      setReviewAttempt(null);
      setReviewMode(false);
      setDifficulty(nextDifficulty);
      setView("quiz");
    };
    const handleResultBack = () => {
      // 오답 다시 풀기(복습 노트)·저장된 풀이 바로 열기(자료 요약)는 courseDetail을 거치지 않고
      // 결과로 바로 들어왔으므로, 들어온 이전 화면(라우트)으로 되돌아간다.
      // (오답 복습 흐름은 과목 자료를 로드하지 않아 courseDetail이 빈 화면이 되므로 setView 금지)
      if (reviewActiveRef.current || reviewAttempt) {
        navigate(-1);
        return;
      }
      // 과목 설정(과목 세부) 화면에서 직접 만들어 푼 경우에는 그 설정 화면으로 돌아간다.
      setView("courseDetail");
    };
    const handleAnalyzeWrong = async () => {
      if (analyzing || !selectedCourse.trim()) return;
      // 이번에 다시 푼 문항 전체(정오답 포함)를 넘겨 약점을 분석한다. 백엔드가 오답을 중심으로 정리한다.
      const items: WrongAnalysisItem[] = quizzes.map((quiz, index) => {
        const answerValue = answers[index];
        return {
          question: quiz.question,
          type: quiz.type || questionType,
          studentAnswer: formatAnswerForReview(quiz, answerValue),
          correctAnswer: formatAnswerForReview(quiz, answerValue, true),
          explanation: subjectiveGrades[index]?.feedback || quiz.explanation,
          isCorrect: isQuestionCorrect(quiz, index, answerValue),
        };
      });
      if (items.length === 0) {
        setAnalyzeError("분석할 문항이 없습니다.");
        return;
      }
      setAnalyzing(true);
      setAnalyzeError("");
      try {
        const analysis = await analyzeWrongAnswers(selectedCourse, items);
        await saveWrongAnswerAnalysisToServer(selectedCourse, analysis);
        navigate(pageRoutes["오답 노트"]);
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : "오답 분석에 실패했습니다.");
      } finally {
        setAnalyzing(false);
      }
    };
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 결과" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 760, margin: "40px auto", textAlign: "center" }}>
          <div style={{ textAlign: "left", marginBottom: 16 }}>
            <button type="button" onClick={handleResultBack} style={{
              background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: 14, padding: 0
            }}>← 돌아가기</button>
          </div>
          <Card style={{ padding: 40 }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%", margin: "0 auto 20px",
              background: scorePercent >= 80 ? "var(--color-tint-cyan)" : scorePercent >= 50 ? "var(--color-tint-yellow)" : "var(--color-tint-pink)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, fontWeight: 800, color: scorePercent >= 80 ? CYAN : scorePercent >= 50 ? "var(--color-amber-deep)" : PINK
            }}>{scorePercent}%</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>
              {timedOut ? "시간이 종료되었습니다" : scorePercent >= 80 ? "훌륭해요!" : scorePercent >= 50 ? "좋은 시작이에요!" : "조금 더 노력해봐요!"}
            </h2>
            <p style={{ fontSize: 15, color: "var(--color-text-secondary)", margin: "0 0 28px" }}>{quizzes.length}문제 중 {correctCount}문제 정답</p>
            {attemptSaveNotice && (
              <p style={{ margin: "0 0 20px", fontSize: 12, color: attemptSaveNotice.includes("실패") ? PINK : "var(--color-muted)" }}>
                {attemptSaveNotice}
              </p>
            )}
            {reviewAttempt && (
              <div style={{
                margin: "0 0 24px",
                padding: 16,
                borderRadius: 14,
                background: "var(--color-surface)",
                border: `1px solid ${BORDER_COLOR}`,
                textAlign: "left",
              }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)" }}>분석 리포트</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <div style={{ padding: 12, borderRadius: 12, background: "var(--color-card)" }}>
                    <div style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 800, marginBottom: 4 }}>풀이 시간</div>
                    <div style={{ fontSize: 15, color: "var(--color-text-strong)", fontWeight: 850 }}>{reviewAttempt.durationSeconds === null ? "-" : formatSeconds(reviewAttempt.durationSeconds)}</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 12, background: "var(--color-card)" }}>
                    <div style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 800, marginBottom: 4 }}>오답</div>
                    <div style={{ fontSize: 15, color: PINK, fontWeight: 850 }}>{Math.max(0, reviewAttempt.count - reviewAttempt.correctCount)}문항</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 12, background: "var(--color-card)" }}>
                    <div style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 800, marginBottom: 4 }}>약점</div>
                    <div style={{ fontSize: 15, color: CYAN, fontWeight: 850 }}>{reviewAttempt.weakTopics.length || resultWeakTopics.length}개</div>
                  </div>
                </div>
              </div>
            )}

            {reviewMaterials.length > 1 && (
              <div style={{
                margin: "0 0 24px",
                padding: 18,
                borderRadius: 14,
                background: "var(--color-card)",
                border: `1px solid ${BORDER_COLOR}`,
                textAlign: "left",
              }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)" }}>
                  이 퀴즈에 사용한 자료
                </h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {reviewMaterials.map(material => (
                    <button
                      key={material.id}
                      type="button"
                      className="tongkk-hover-dim"
                      onClick={() => goToMaterialReview({ materialId: material.id })}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${BORDER_COLOR}`,
                        background: "var(--color-surface)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ minWidth: 0, color: "var(--color-text)", fontSize: 13, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {material.name}
                      </span>
                      <span className="tongkk-row-hint" style={{ flexShrink: 0, color: CYAN, fontSize: 12, fontWeight: 850 }}>
                        요약 탭 열기
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {wrongQuestions.length > 0 && (
              <div style={{
                margin: "0 0 24px",
                padding: 18,
                borderRadius: 14,
                background: "var(--color-card)",
                border: `1px solid ${BORDER_COLOR}`,
                textAlign: "left",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)" }}>
                    오답 복습
                  </h3>
                  <button
                    type="button"
                    onClick={() => goToMaterialReview({ tutorQuestion: reviewTutorQuestion })}
                    style={{
                      flexShrink: 0,
                      padding: "7px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: PINK,
                      color: "var(--color-on-brand)",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    AI 튜터로 복습
                  </button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {wrongQuestions.map((quiz, wrongIndex) => {
                    const questionIndex = quizzes.indexOf(quiz);
                    const attemptAnswer = reviewAttempt?.answers[questionIndex];
                    const type = quiz.type || questionType;
                    const userAnswer = attemptAnswer?.studentAnswer ??
                      (type === "객관식" || type === "OX"
                        ? typeof answers[questionIndex] === "number" ? quiz.options?.[answers[questionIndex] as number] : null
                        : answers[questionIndex]);
                    const correctAnswer = attemptAnswer?.correctAnswer ??
                      (type === "객관식" || type === "OX"
                        ? typeof quiz.answer === "number" ? quiz.options?.[quiz.answer] : null
                        : quiz.answerText);
                    return (
                      <button
                        key={`${quiz.question}-${wrongIndex}`}
                        type="button"
                        className="tongkk-hover-dim"
                        onClick={() => goToQuestionReview(questionIndex)}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: 14, borderRadius: 12, background: "var(--color-surface)",
                          border: "1px solid var(--color-border-soft)", cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                          <span style={{ minWidth: 0, fontSize: 13, color: "var(--color-text-strong)", fontWeight: 800, lineHeight: 1.5 }}>
                            Q{questionIndex + 1}. {quiz.question}
                          </span>
                          <span className="tongkk-row-hint" style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: CYAN }}>문제 보기 →</span>
                        </div>
                        <div style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                          <span>내 답: <strong style={{ color: PINK }}>{userAnswer ?? "미응답"}</strong></span>
                          <span>정답: <strong style={{ color: CYAN }}>{correctAnswer ?? "정답 정보 없음"}</strong></span>
                          <span>틀린 이유: {attemptAnswer?.feedback || quiz.explanation}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {analyzeError && (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: PINK }}>{analyzeError}</p>
            )}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => navigate(pageRoutes["오답 노트"])} disabled={analyzing} style={{
                padding: "12px 24px", borderRadius: 12, border: "1px solid var(--color-border-soft)",
                background: "var(--color-card)", fontSize: 14, fontWeight: 700,
                cursor: analyzing ? "default" : "pointer", color: "var(--color-text)", opacity: analyzing ? 0.6 : 1
              }}>오답 노트 보기</button>
              <button type="button" onClick={retryQuiz} disabled={analyzing} style={{
                padding: "12px 24px", borderRadius: 12, border: "1px solid var(--color-border-soft)",
                background: "var(--color-card)", fontSize: 14, fontWeight: 700,
                cursor: analyzing ? "default" : "pointer", color: "var(--color-text)", opacity: analyzing ? 0.6 : 1
              }}>다시 풀기</button>
              {reviewActiveRef.current ? (
                <button type="button" onClick={handleAnalyzeWrong} disabled={analyzing} style={{
                  padding: "12px 24px", borderRadius: 12, border: "none",
                  background: PINK, fontSize: 14, fontWeight: 600,
                  cursor: analyzing ? "default" : "pointer", color: "var(--color-on-brand)", opacity: analyzing ? 0.7 : 1
                }}>{analyzing ? "분석 중..." : "과목 오답 분석"}</button>
              ) : (
                <button type="button" onClick={() => setView("courseDetail")} style={{
                  padding: "12px 24px", borderRadius: 12, border: "none",
                  background: PINK, fontSize: 14, fontWeight: 600, cursor: "pointer", color: "var(--color-on-brand)"
                }}>새로 풀기</button>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ── 퀴즈 풀기 ──
  const q = quizzes[current];
  const selected = answers[current];
  const activeQuestionType = q?.type || questionType;
  const isShortAnswer = activeQuestionType === "단답형";
  const isSubjective = activeQuestionType === "주관식";
  const subjectiveGrade = subjectiveGrades[current];
  if (!q) {
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 600, margin: "40px auto" }}>
          <Card style={{ padding: 28, textAlign: "center" }}>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)" }}>표시할 퀴즈가 없습니다.</p>
            <button type="button" onClick={() => setView("courseDetail")} style={{
              padding: "10px 20px", borderRadius: 10, border: "none",
              background: PINK, color: "var(--color-on-brand)", fontSize: 14, fontWeight: 700, cursor: "pointer"
            }}>설정으로 돌아가기</button>
          </Card>
        </div>
      </div>
    );
  }
  // 오답 확인(복습) 화면 표시에 쓰는, 현재 문항을 맞혔는지 여부.
  const currentCorrect = isQuestionCorrect(q, current, selected);
  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebarEl}
      <Header label={openedQuizTitle || `${selectedCourse} 퀴즈`} onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")}
        extra={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {examMode && !reviewMode && remainingSeconds !== null && (
              <span style={{ fontSize: 14, fontWeight: 800, color: remainingSeconds <= 60 ? PINK : CYAN }}>
                {formatSeconds(remainingSeconds)}
              </span>
            )}
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-muted)" }}>{current + 1} / {quizzes.length}</span>
          </div>
        } />
      <div style={{ height: 3, background: "var(--color-border-soft)" }}>
        <div style={{ height: 3, background: PINK, width: `${((current + 1) / quizzes.length) * 100}%`, transition: "width 0.3s" }}/>
      </div>
      {!reviewMode && quizzes.length > 1 && (
        <div style={{ maxWidth: 700, margin: "18px auto 0", padding: "0 24px", display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
          {quizzes.map((_, i) => {
            const answered = answers[i] !== undefined;
            const isCurrent = i === current;
            return (
              <button
                key={i}
                type="button"
                className="tongkk-quiz-nav"
                onClick={() => goToQuestion(i)}
                aria-label={`${i + 1}번 문제, ${answered ? "응답함" : "미응답"}${isCurrent ? ", 현재 문제" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
                title={`${i + 1}번 · ${answered ? "응답함" : "미응답"}`}
                style={{
                  width: 32, height: 32, borderRadius: 9, fontSize: 12.5, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  border: isCurrent ? `2px solid ${PINK}` : `1.5px solid ${answered ? "var(--color-muted)" : "var(--color-border-soft)"}`,
                  background: answered ? "var(--color-muted-surface)" : "var(--color-card)",
                  color: isCurrent ? PINK : answered ? "var(--color-text-strong)" : "var(--color-muted)",
                  transition: "all 0.15s",
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ padding: 24, maxWidth: 700, margin: "30px auto", display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          onClick={() => goToQuestion(current - 1)}
          disabled={current === 0}
          aria-label="이전 문제"
          style={{
            flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            background: "none", border: "none", padding: "10px 6px",
            color: current === 0 ? "var(--color-border-soft)" : "var(--color-muted)",
            cursor: current === 0 ? "default" : "pointer",
          }}
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>‹</span>
          <span style={{ fontSize: 11, fontWeight: 800 }}>이전</span>
        </button>
        <Card style={{ flex: 1, minWidth: 0, padding: 28 }}>
          {reviewMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{
                flexShrink: 0, padding: "3px 10px", borderRadius: 999,
                background: currentCorrect ? "var(--color-tint-cyan)" : "var(--color-tint-pink)",
                color: currentCorrect ? CYAN : PINK, fontSize: 11, fontWeight: 850,
              }}>{currentCorrect ? "정답" : "오답"}</span>
              <span style={{ minWidth: 0, fontSize: 12, fontWeight: 800, color: "var(--color-text-secondary)" }}>오답 확인 · 내 답과 정답을 확인하세요</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: CYAN }}>Q{current + 1}</span>
            {/* 답한 직후(비-시험 모드) 모든 유형에 공통으로 정답/오답을 한눈에 보여주는 작은 배지. 복습 화면은 위에 별도 배지가 있으므로 제외. */}
            {!reviewMode && selected !== undefined && !examMode && (
              <span style={{
                flexShrink: 0, padding: "2px 9px", borderRadius: 999,
                background: currentCorrect ? "var(--color-tint-cyan)" : "var(--color-tint-pink)",
                color: currentCorrect ? CYAN : PINK, fontSize: 11, fontWeight: 850,
              }}>{currentCorrect ? "정답" : "오답"}</span>
            )}
          </div>
          <h3 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 600, color: "var(--color-text-strong)", lineHeight: 1.5 }}><QuizText>{q.question}</QuizText></h3>
          {reviewMode ? (
            <div style={{ display: "grid", gap: 10 }}>
              {isShortAnswer || isSubjective ? (
                <div style={{ display: "grid", gap: 8, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  <span>내 답: <span style={{ padding: "3px 10px", borderRadius: 8, background: "var(--color-muted-surface)", color: "var(--color-text)", fontWeight: 700 }}>{typeof selected === "string" && selected.trim() ? selected : "미응답"}</span></span>
                  {!currentCorrect && (
                    <span>정답: <strong style={{ color: PINK }}><QuizText>{isSubjective ? (subjectiveGrade?.referenceAnswer || q.answerText || q.explanation) : (q.answerText || "정답 정보 없음")}</QuizText></strong></span>
                  )}
                  {isSubjective && subjectiveGrade && (
                    <span><strong style={{ color: "var(--color-text)" }}>채점</strong> {subjectiveGrade.score}점 · <QuizText>{subjectiveGrade.feedback}</QuizText></span>
                  )}
                </div>
              ) : (
                (q.options || []).map((opt, i) => {
                  const isMyChoice = selected === i;
                  const showCorrect = q.answer === i && !currentCorrect;
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      padding: "12px 16px", borderRadius: 12,
                      background: showCorrect ? "var(--color-tint-pink)" : isMyChoice ? "var(--color-muted-surface)" : "var(--color-card)",
                      border: `1.5px solid ${showCorrect ? PINK : "var(--color-border-soft)"}`,
                    }}>
                      <span style={{ minWidth: 0, fontSize: 14, color: showCorrect ? PINK : "var(--color-text)", fontWeight: showCorrect || isMyChoice ? 700 : 400, lineHeight: 1.45, wordBreak: "break-word" }}>
                        <span style={{ marginRight: 10, fontWeight: 600 }}>{String.fromCharCode(65 + i)}.</span>
                        <QuizText>{opt}</QuizText>
                      </span>
                      {(isMyChoice || showCorrect) && (
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 850, color: showCorrect ? PINK : "var(--color-text-secondary)" }}>
                          {showCorrect ? "정답" : "내 답"}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : isShortAnswer || isSubjective ? (
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: isSubjective ? "flex-end" : "stretch" }}>
                {isSubjective ? (
                  <textarea
                    value={typeof selected === "string" ? selected : shortAnswerInput}
                    onChange={e => setShortAnswerInput(e.target.value)}
                    disabled={reviewMode || selected !== undefined || grading}
                    placeholder="근거와 함께 답안을 작성하세요"
                    rows={5}
                    style={{
                      flex: 1,
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: "1.5px solid var(--color-border-soft)",
                      background: selected !== undefined ? "var(--color-surface)" : "var(--color-card)",
                      fontSize: 14,
                      color: "var(--color-text)",
                      outline: "none",
                      resize: "vertical",
                      lineHeight: 1.6,
                      fontFamily: "inherit",
                    }}
                  />
                ) : (
                  <input
                    value={typeof selected === "string" ? selected : shortAnswerInput}
                    onChange={e => setShortAnswerInput(e.target.value)}
                    disabled={reviewMode || selected !== undefined}
                    placeholder="정답을 입력하세요"
                    style={{
                      flex: 1, padding: "14px 16px", borderRadius: 12, border: "1.5px solid var(--color-border-soft)",
                      background: selected !== undefined ? "var(--color-surface)" : "var(--color-card)", fontSize: 14, color: "var(--color-text)", outline: "none"
                    }}
                  />
                )}
                {!reviewMode && (
                  <button type="button"
                    onClick={isSubjective ? submitSubjectiveAnswer : submitShortAnswer}
                    disabled={!shortAnswerInput.trim() || selected !== undefined || grading}
                    style={{
                      padding: isSubjective ? "14px 20px" : "0 20px", borderRadius: 12, border: "none",
                      background: shortAnswerInput.trim() && selected === undefined && !grading ? PINK : "var(--color-border-soft)",
                      color: "var(--color-on-brand)", fontSize: 14, fontWeight: 700,
                      cursor: shortAnswerInput.trim() && selected === undefined && !grading ? "pointer" : "default"
                    }}
                  >{grading ? "채점 중..." : "제출"}</button>
                )}
              </div>
              {isShortAnswer && (reviewMode || (selected !== undefined && !examMode)) && (
                <div style={{
                  marginTop: 12, padding: "12px 16px", borderRadius: 12,
                  background: currentCorrect ? "var(--color-tint-cyan)" : "var(--color-tint-pink)",
                  color: currentCorrect ? CYAN : PINK,
                  fontSize: 13, fontWeight: 700
                }}>
                  정답: <QuizText>{q.answerText}</QuizText>
                </div>
              )}
              {isSubjective && subjectiveGrade && (reviewMode || (selected !== undefined && !examMode)) && (
                <div style={{
                  marginTop: 12,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: subjectiveGrade.isCorrect ? "var(--color-tint-cyan)" : "var(--color-tint-pink)",
                  color: subjectiveGrade.isCorrect ? CYAN : PINK,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  <strong>{subjectiveGrade.score}점</strong> · <QuizText>{subjectiveGrade.feedback}</QuizText>
                  <div style={{ marginTop: 8, color: "var(--color-text)" }}>
                    모범답안: <QuizText>{subjectiveGrade.referenceAnswer}</QuizText>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(q.options || []).map((opt, i) => {
                const isSelected = selected === i;
                const isCorrect = q.answer === i;
                const answered = selected !== undefined;
                const revealAnswer = answered && !examMode;
                let bg = "var(--color-surface)", border = "var(--color-border-soft)", color = "var(--color-text)";
                if (revealAnswer && isCorrect) { bg = "var(--color-tint-cyan)"; border = CYAN; color = CYAN; }
                else if (revealAnswer && isSelected && !isCorrect) { bg = "var(--color-tint-pink)"; border = PINK; color = PINK; }
                else if (isSelected) { bg = "var(--color-muted-surface)"; border = "var(--color-muted)"; color = "var(--color-text-strong)"; }
                return (
                  <button type="button" key={i} className={answered ? undefined : "tongkk-quiz-option"} onClick={() => selectAnswer(i)} style={{
                    padding: "14px 18px", borderRadius: 12, border: `1.5px solid ${border}`,
                    background: bg, textAlign: "left", fontSize: 14, color, cursor: answered ? "default" : "pointer",
                    fontWeight: isSelected || (revealAnswer && isCorrect) ? 600 : 400, transition: "all 0.2s"
                  }}>
                    <span style={{ marginRight: 10, fontWeight: 600 }}>{String.fromCharCode(65 + i)}.</span>
                    <QuizText>{opt}</QuizText>
                    {revealAnswer && isCorrect && <span style={{ float: "right" }}>O</span>}
                    {revealAnswer && isSelected && !isCorrect && <span style={{ float: "right" }}>X</span>}
                  </button>
                );
              })}
            </div>
          )}
          {showExplanation && (
            reviewMode ? (
              <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "var(--color-surface)", border: "1px solid var(--color-border-soft)", fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--color-text)" }}>해설</strong> <QuizText>{q.explanation}</QuizText>
              </div>
            ) : (
              <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: "var(--color-surface)", fontSize: 13, color: "var(--color-text)", lineHeight: 1.6 }}>
                <strong style={{ color: CYAN }}>해설:</strong> <QuizText>{q.explanation}</QuizText>
              </div>
            )
          )}
          {reviewMode ? (
            <button type="button" onClick={exitReviewToResult} style={{
              marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
              background: PINK, color: "var(--color-on-brand)", fontSize: 15, fontWeight: 700, cursor: "pointer"
            }}>결과로 돌아가기</button>
          ) : current < quizzes.length - 1 ? (
            <button type="button" onClick={goNextActive} style={{
              marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
              background: PINK, color: "var(--color-on-brand)", fontSize: 15, fontWeight: 700, cursor: "pointer"
            }}>다음</button>
          ) : (
            <button type="button" onClick={submitQuiz} style={{
              marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
              background: PINK, color: "var(--color-on-brand)", fontSize: 15, fontWeight: 700, cursor: "pointer"
            }}>결과 보기</button>
          )}
        </Card>
        <button
          type="button"
          onClick={reviewMode ? () => goToQuestion(current + 1) : goNextActive}
          disabled={current >= quizzes.length - 1}
          aria-label="다음 문제"
          style={{
            flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            background: "none", border: "none", padding: "10px 6px",
            color: current >= quizzes.length - 1 ? "var(--color-border-soft)" : "var(--color-muted)",
            cursor: current >= quizzes.length - 1 ? "default" : "pointer",
          }}
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>›</span>
          <span style={{ fontSize: 11, fontWeight: 800 }}>다음</span>
        </button>
      </div>
    </div>
  );
}
