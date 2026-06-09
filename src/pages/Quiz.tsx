import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, pageRoutes, SidebarIcon, Sidebar, Card, type PageRouteLabel } from "../common";
import { useCourses } from "../CourseContext";
import {
  generateQuiz,
  gradeSubjectiveAnswer,
  type QuizQuestion,
  type QuizDifficulty,
  type QuizQuestionType,
  type SubjectiveGradeResult,
  type SummaryTemplate,
} from "../services/gpt";
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
} | null;

const sourceLabels: Record<string, string> = {
  raw: "원본 자료",
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

const isSupportedDocumentFile = (file: File) =>
  ["pdf", "ppt", "pptx", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes((file.name.split(".").pop() || "").toLowerCase());

const getDocumentMaterialType = (file: File): CourseMaterial["type"] =>
  file.name.toLowerCase().endsWith(".pdf")
    ? "pdf"
    : ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes((file.name.split(".").pop() || "").toLowerCase())
      ? "img"
      : "ppt";

const extractMarkdownFromMaterialFile = (file: File) => extractMarkdownFromPDF(file);

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
  <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <button onClick={onOpenSidebar} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
        <SidebarIcon />
      </button>
      <button onClick={onHome} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      <span style={{ color: "#bbb", fontSize: 14 }}>/ {label}</span>
    </div>
    {extra}
  </div>
);

export default function Quiz() {
  const navigate = useNavigate();
  const location = useLocation();
  const { courses } = useCourses();
  const reviewState = location.state as QuizLocationState;
  const reviewQuestions = reviewState?.reviewQuestions || null;
  const hasReviewQuestions = Boolean(reviewQuestions && reviewQuestions.length > 0);
  const reviewActiveRef = useRef(hasReviewQuestions);
  const [sidebar, setSidebar] = useState(false);
  const [view, setView] = useState<QuizView>(hasReviewQuestions ? "quiz" : "courseList");

  // 과목 및 설정
  const [selectedCourse, setSelectedCourse] = useState(
    hasReviewQuestions ? (reviewState?.selectedCourse || reviewState?.course || "") : "",
  );
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("보통");
  const [questionType, setQuestionType] = useState<QuizQuestionType>("객관식");

  // 자료 관련
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
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
  const [openedQuizTitle, setOpenedQuizTitle] = useState(
    hasReviewQuestions ? (reviewState?.reviewTitle || "오답 다시 풀기") : "",
  );
  const [activeQuizSetId, setActiveQuizSetId] = useState<string | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [courseQuizSets, setCourseQuizSets] = useState<SavedQuizSet[]>([]);

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

  // Summary 페이지에서 navigate로 전달된 state 처리 (마운트 시 1회)
  useEffect(() => {
    if (reviewActiveRef.current) return; // 오답 다시 풀기: 초기 상태에서 이미 풀이 화면 구성
    const state = location.state as QuizLocationState;
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
      setCourseQuizSets(quizSets);

      // MINDMAP은 퀴즈 소스로 부적합 (JSON 구조)
      const usable = summaries.filter(s => s.template !== "MINDMAP");
      setSavedSummaries(usable);

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
      loadCourseMaterialsFromServer(selectedCourse),
      loadSummariesFromServer(selectedCourse),
      loadQuizSetsFromServer(selectedCourse),
      loadQuizAttemptsFromServer(selectedCourse),
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
    if (view !== "quiz" && view !== "generating") return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [view]);

  const handleCourseSelect = (course: string) => {
    setSelectedCourse(course);
    setCourseQuizSets([]);
    setView("materialList");
  };

  const openExistingQuizSet = (quizSet: SavedQuizSet) => {
    const attempts = quizAttempts.filter(a => a.quizSetId === quizSet.id);
    const latestAttempt = attempts[0] || null;
    const shuffledQuestions = shuffleQuizOptions(quizSet.questions, quizSet.questionType);
    const restored = latestAttempt ? buildAnswersFromAttempt({ ...quizSet, questions: shuffledQuestions }, latestAttempt) : null;
    setDifficulty(quizSet.difficulty);
    setQuestionType(quizSet.questionType);
    setCount(quizSet.count);
    setSelectedMaterialIds(quizSet.materialIds.filter(id => materials.some(m => m.id === id)));
    setQuizzes(shuffledQuestions);
    setCurrent(0);
    setAnswers(restored?.answers || {});
    setShortAnswerInput("");
    setShowExplanation(false);
    setOpenedQuizTitle(quizSet.title);
    setActiveQuizSetId(quizSet.id);
    setSubjectiveGrades(restored?.subjectiveGrades || {});
    setRemainingSeconds(null);
    setQuizStartedAt(latestAttempt ? null : Date.now());
    setTimedOut(latestAttempt?.timedOut || false);
    setAttemptSavedKey(latestAttempt ? `review:${latestAttempt.id}` : "");
    setAttemptSaveNotice(latestAttempt ? "저장된 풀이 기록을 불러왔습니다." : "");
    setReviewAttempt(latestAttempt);
    setView(latestAttempt ? "result" : "quiz");
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
      setMaterialNotice("PDF, PPT, PPTX, 이미지 파일만 업로드할 수 있습니다.");
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

  const generate = async () => {
    if (!selectedCourse.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setView("generating");
    setError(null);
    const markdownToUse = buildMaterialSourceMarkdown(selectedMaterials);
    try {
      const generated = await generateQuiz(selectedCourse, count, difficulty, markdownToUse, controller.signal, questionType);
      const questions = shuffleQuizOptions(generated, questionType);
      setQuizzes(questions);
      const savedQuizSet = await saveQuizSetToServer(selectedCourse, {
        title: `${selectedCourse} ${questionType} 퀴즈`,
        difficulty,
        questionType,
        count: questions.length,
        materialIds: selectedMaterialIds,
        questions,
      });
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

  const next = () => {
    if (current < quizzes.length - 1) {
      setCurrent(current + 1);
      setShowExplanation(false);
      setShortAnswerInput("");
    }
    else setView("result");
  };

  const isQuestionCorrect = useCallback((quiz: QuizQuestion, index: number, answerValue: number | string | undefined) => {
    if (answerValue === undefined) return false;
    const type = quiz.type || questionType;
    if (type === "주관식") {
      return subjectiveGrades[index]?.isCorrect || false;
    }
    if (type === "단답형") {
      return typeof answerValue === "string" && typeof quiz.answerText === "string" && normalizeAnswer(answerValue) === normalizeAnswer(quiz.answerText);
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
    if (view === "quiz") {
      if (!window.confirm("퀴즈 풀이 중입니다. 진행 상태가 저장되지 않습니다.\n페이지를 떠나시겠습니까?")) {
        setSidebar(false);
        return;
      }
    }
    navigate(pageRoutes[item]);
  };

  const sidebarEl = (
    <>
      {sidebar && <Sidebar active="퀴즈 생성" onNav={handleNav} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
    </>
  );

  // ── 과목 카드 리스트 ──
  if (view === "courseList") {
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#222" }}>과목 선택</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#999" }}>퀴즈를 만들 과목을 선택하세요</p>
          </div>

          {courses.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {courses.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => handleCourseSelect(c)}
                    style={{
                      minHeight: 170, padding: 22, borderRadius: 14, border: "1px solid #eeeeee",
                      background: CARD_BACKGROUND, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", color: "#222",
                      cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column",
                      justifyContent: "space-between", transition: "border 0.15s, box-shadow 0.15s",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{c}</span>
                    </div>
                    <span style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: "#aaa" }}>
                      선택하기
                    </span>
                  </button>
              ))}
            </div>
          ) : (
            <Card style={{ padding: 40, textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "#aaa", margin: 0 }}>등록된 과목이 없습니다. 대시보드에서 과목을 추가해주세요.</p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // ── 자료 목록 (퀴즈 현황) ──
  if (view === "materialList") {
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <button onClick={() => setView("courseList")} style={{
              background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, padding: 0
            }}>← 돌아가기</button>
            <button
              onClick={() => { courseDetailFromRouteRef.current = false; setView("courseDetail"); }}
              style={{
                padding: "9px 18px", borderRadius: 10, border: "none",
                background: CYAN, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer"
              }}
            >+ 새 퀴즈 만들기</button>
          </div>
          <h2 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 700, color: "#222" }}>{selectedCourse}</h2>
          {materials.length === 0 ? (
            <Card style={{ padding: 40, textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "#aaa", margin: 0 }}>아직 자료가 없습니다. 퀴즈를 만들려면 자료를 먼저 업로드하세요.</p>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...materials]
                .sort((a, b) => {
                  const aCount = courseQuizSets.filter(q => q.materialIds?.includes(a.id)).length;
                  const bCount = courseQuizSets.filter(q => q.materialIds?.includes(b.id)).length;
                  return bCount - aCount;
                })
                .map(material => {
                  const materialQuizSets = courseQuizSets
                    .filter(q => q.materialIds?.includes(material.id))
                    .sort((a, b) => b.createdAt - a.createdAt);
                  const hasQuiz = materialQuizSets.length > 0;
                  const latestAttempt = hasQuiz
                    ? quizAttempts.find(a => a.quizSetId === materialQuizSets[0].id)
                    : null;
                  return (
                    <Card key={material.id} style={{ padding: "16px 20px", opacity: hasQuiz ? 1 : 0.55 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: hasQuiz ? 12 : 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#222" }}>{material.name}</span>
                        {hasQuiz ? (
                          <span style={{
                            background: `${CYAN}22`, color: CYAN,
                            borderRadius: 20, padding: "3px 12px",
                            fontSize: 12, fontWeight: 700, flexShrink: 0
                          }}>
                            퀴즈 {materialQuizSets.length}개
                            {latestAttempt && ` · 최근 ${latestAttempt.scorePercent}%`}
                          </span>
                        ) : (
                          <span style={{ color: "#bbb", fontSize: 12, flexShrink: 0 }}>퀴즈 없음</span>
                        )}
                      </div>
                      {hasQuiz && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {materialQuizSets.map(quizSet => {
                            const attempt = quizAttempts.find(a => a.quizSetId === quizSet.id);
                            return (
                              <button
                                key={quizSet.id}
                                onClick={() => openExistingQuizSet(quizSet)}
                                style={{
                                  display: "flex", alignItems: "center", justifyContent: "space-between",
                                  padding: "10px 14px", borderRadius: 10,
                                  border: `1px solid ${BORDER_COLOR}`, background: "#fafafa",
                                  cursor: "pointer", textAlign: "left", width: "100%"
                                }}
                              >
                                <span style={{ fontSize: 13, color: "#444", fontWeight: 600 }}>
                                  {quizSet.title || `${quizSet.questionType} · ${quizSet.difficulty} · ${quizSet.count}문제`}
                                </span>
                                <span style={{ fontSize: 12, color: "#aaa", flexShrink: 0, marginLeft: 12 }}>
                                  {attempt ? `${attempt.scorePercent}% · ${attempt.questionType}` : "미응시"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 과목 세부 (자료 + 설정) ──
  if (view === "courseDetail") {
    const canGenerate = !isExtracting;
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
          <button onClick={handleCourseBack} style={{
            background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
          }}>← 돌아가기</button>

          <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "#222" }}>{selectedCourse}</h2>

          {error && (
            <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#FFF0F6", border: `1px solid ${PINK}`, fontSize: 13, color: PINK }}>
              {error}
            </div>
          )}

          <Card style={{ padding: 20, marginBottom: 16, border: "1px solid #E8FAFE", background: "#F7FDFF" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
              <div>
                <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800, color: "#222" }}>페이스메이커</h3>
                <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.6 }}>
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
                    color: "#fff",
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
              <div style={{ marginTop: 12, fontSize: 12, color: "#888" }}>
                최근 점수 {quizAttempts[0].scorePercent}% · {quizAttempts[0].questionType} · {quizAttempts[0].difficulty}
              </div>
            )}
          </Card>

          {/* 강의자료 업로드 */}
          <Card style={{ padding: 24, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#222" }}>강의자료</h3>

            <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff"
              onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
              style={{ display: "none" }} />

            {materials.length > 0 && (
              <div style={{
                padding: "12px 16px", borderRadius: 10, background: "#E8FAFE",
                fontSize: 13, color: CYAN, marginBottom: 14, fontWeight: 800
              }}>
                저장된 강의자료 {materials.length}개 중 {selectedMaterials.length}개가 퀴즈에 반영됩니다
              </div>
            )}
            {materials.length === 0 && (
              <div style={{
                padding: "12px 16px", borderRadius: 10, background: "#fafafa",
                fontSize: 13, color: "#aaa", marginBottom: 14
              }}>
                저장된 자료가 없습니다. PDF나 이미지를 업로드하거나 과목명으로만 퀴즈를 생성할 수 있습니다.
              </div>
            )}

            {materials.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 10 }}>
                  <button type="button" onClick={() => setSelectedMaterialIds(materials.map(material => material.id))} style={{ border: `1px solid ${BORDER_COLOR}`, background: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "#777", cursor: "pointer" }}>전체 선택</button>
                  <button type="button" onClick={() => setSelectedMaterialIds([])} style={{ border: `1px solid ${BORDER_COLOR}`, background: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontWeight: 800, color: "#777", cursor: "pointer" }}>전체 해제</button>
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
                      background: isSelected ? "#f8fbff" : MUTED_SURFACE,
                      border: isSelected ? "1px solid #cfd8e6" : `1px solid ${BORDER_COLOR}`,
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
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                                border: isActiveSource ? "1px solid rgba(240, 112, 174, 0.24)" : `1px solid ${BORDER_COLOR}`,
                                background: isActiveSource ? "rgba(240, 112, 174, 0.07)" : CARD_BACKGROUND,
                                color: isActiveSource ? PINK : "#777",
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
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "#cfd8e6" : BORDER_COLOR}`,
                borderRadius: 12, padding: "28px 20px", textAlign: "center",
                cursor: "pointer", background: dragOver ? "#f8fbff" : MUTED_SURFACE,
                transition: "all 0.2s", marginBottom: 12
              }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 14, color: "#888" }}>
                강의자료 파일을 여러 개 드래그하거나
              </p>
              <button style={{
                padding: "7px 18px", borderRadius: 10, border: "1px solid #ddd",
                background: "#fff", fontSize: 13, cursor: "pointer", color: "#555"
              }}>파일 선택</button>
            </div>

            {isExtracting && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 14, height: 14, border: `2px solid ${PINK}`, borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: PINK }}>파일 분석 중... ({uploadedFileName})</span>
              </div>
            )}
            {!isExtracting && uploadedFileName && !extractError && (
              <span style={{ fontSize: 13, color: "#4CAF50" }}>{uploadedFileName} 분석 완료 — 퀴즈에 반영됩니다</span>
            )}
            {!isExtracting && materialNotice && (
              <span style={{ display: "block", marginTop: 8, fontSize: 13, color: CYAN }}>{materialNotice}</span>
            )}
            {!isExtracting && extractError && (
              <span style={{ fontSize: 13, color: "#E53E3E" }}>분석 실패: {extractError}</span>
            )}
          </Card>

          {/* 퀴즈 설정 */}
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "#222" }}>퀴즈 설정</h3>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8, display: "block" }}>문제 수</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {[5, 10, 15, 20].map(n => (
                <button key={n} onClick={() => setCount(n)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: count === n ? "1px solid #d9d9d9" : "1px solid #eaeaea",
                  background: count === n ? "#efefef" : "#fafafa",
                  color: count === n ? "#666" : "#888", fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{n}문제</button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8, display: "block" }}>난이도</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {(["쉬움", "보통", "어려움"] as QuizDifficulty[]).map(d => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: difficulty === d ? "1px solid #d9d9d9" : "1px solid #eaeaea",
                  background: difficulty === d ? "#efefef" : "#fafafa",
                  color: difficulty === d ? "#666" : "#888", fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8, display: "block" }}>문제 유형</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 20 }}>
              {(["객관식", "OX", "단답형", "주관식"] as QuizQuestionType[]).map(t => (
                <button key={t} onClick={() => setQuestionType(t)} style={{
                  padding: "10px 0", borderRadius: 10,
                  border: questionType === t ? "1px solid #d9d9d9" : "1px solid #eaeaea",
                  background: questionType === t ? "#efefef" : "#fafafa",
                  color: questionType === t ? "#666" : "#888", fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{t}</button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#888", marginBottom: 8, display: "block" }}>시험 모드</label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, background: "#fafafa", border: "1px solid #f0f0f0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700, color: "#333", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={examMode}
                  onChange={e => setExamMode(e.target.checked)}
                />
                시간 제한 켜기
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {[5, 10, 20].map(minutes => (
                  <button
                    key={minutes}
                    type="button"
                    disabled={!examMode}
                    onClick={() => setExamMinutes(minutes)}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 9,
                      border: examMinutes === minutes ? `1px solid ${CYAN}` : "1px solid #e5e5e5",
                      background: examMinutes === minutes ? "#E8FAFE" : "#fff",
                      color: examMinutes === minutes ? CYAN : "#888",
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
          </Card>

          <button onClick={generate} disabled={!canGenerate} style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: canGenerate ? PINK : "#e0e0e0",
            color: canGenerate ? "#fff" : "#bbb",
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
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, border: "3px solid #f0f0f0", borderTop: `3px solid ${PINK}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }}/>
          <p style={{ fontSize: 16, fontWeight: 600, color: "#333" }}>AI가 퀴즈를 생성하고 있습니다...</p>
          <p style={{ fontSize: 13, color: "#999" }}>
            {selectedCourse} · {count}문제 · {difficulty} · {questionType}{sourceName ? ` · ${sourceName}` : ""}
          </p>
          <button onClick={cancelGeneration} style={{
            marginTop: 20, padding: "10px 28px", borderRadius: 10,
            border: "1px solid #e0e0e0", background: "#fff",
            fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#999"
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
    const primaryWeakTopic = resultWeakTopics[0] || "틀린 문제";
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
    const makeTutorQuestion = (topic: string) => [
      `${topic} 부분을 중심으로 이번 퀴즈에서 틀린 문제들을 한 문제씩 다시 설명해줘. 설명 뒤에는 내가 다시 풀어볼 수 있는 확인 질문을 이어서 내줘.`,
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
      setDifficulty(nextDifficulty);
      setView("quiz");
    };
    return (
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 결과" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 760, margin: "40px auto", textAlign: "center" }}>
          <Card style={{ padding: 40 }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%", margin: "0 auto 20px",
              background: scorePercent >= 80 ? "#E8FAFE" : scorePercent >= 50 ? "#FFF8E8" : "#FFF0F6",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, fontWeight: 800, color: scorePercent >= 80 ? CYAN : scorePercent >= 50 ? "#E8A800" : PINK
            }}>{scorePercent}%</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>
              {timedOut ? "시간이 종료되었습니다" : scorePercent >= 80 ? "훌륭해요!" : scorePercent >= 50 ? "좋은 시작이에요!" : "조금 더 노력해봐요!"}
            </h2>
            <p style={{ fontSize: 15, color: "#666", margin: "0 0 28px" }}>{quizzes.length}문제 중 {correctCount}문제 정답</p>
            {attemptSaveNotice && (
              <p style={{ margin: "0 0 20px", fontSize: 12, color: attemptSaveNotice.includes("실패") ? PINK : "#999" }}>
                {attemptSaveNotice}
              </p>
            )}
            {reviewAttempt && (
              <div style={{
                margin: "0 0 24px",
                padding: 16,
                borderRadius: 14,
                background: "#fafafa",
                border: `1px solid ${BORDER_COLOR}`,
                textAlign: "left",
              }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: "#222" }}>분석 리포트</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <div style={{ padding: 12, borderRadius: 12, background: "#fff" }}>
                    <div style={{ fontSize: 11, color: "#999", fontWeight: 800, marginBottom: 4 }}>풀이 시간</div>
                    <div style={{ fontSize: 15, color: "#333", fontWeight: 850 }}>{reviewAttempt.durationSeconds === null ? "-" : formatSeconds(reviewAttempt.durationSeconds)}</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 12, background: "#fff" }}>
                    <div style={{ fontSize: 11, color: "#999", fontWeight: 800, marginBottom: 4 }}>오답</div>
                    <div style={{ fontSize: 15, color: PINK, fontWeight: 850 }}>{Math.max(0, reviewAttempt.count - reviewAttempt.correctCount)}문항</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 12, background: "#fff" }}>
                    <div style={{ fontSize: 11, color: "#999", fontWeight: 800, marginBottom: 4 }}>약점</div>
                    <div style={{ fontSize: 15, color: CYAN, fontWeight: 850 }}>{reviewAttempt.weakTopics.length || resultWeakTopics.length}개</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{
              margin: "0 0 24px",
              padding: 18,
              borderRadius: 14,
              background: "#F7FDFF",
              border: "1px solid #E8FAFE",
              textAlign: "left",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#222" }}>개인 맞춤 복습</h3>
                <span style={{ fontSize: 12, fontWeight: 800, color: CYAN }}>다음 추천: {nextDifficulty}</span>
              </div>
              {resultWeakTopics.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {resultWeakTopics.map(topic => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => goToMaterialReview({ tutorQuestion: makeTutorQuestion(topic) })}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #E8FAFE",
                        background: "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ minWidth: 0, fontSize: 13, color: "#555", lineHeight: 1.5 }}>
                        약점 후보: <strong>{topic}</strong>
                      </span>
                      <span style={{
                        flexShrink: 0,
                        padding: "7px 10px",
                        borderRadius: 9,
                        background: "#FFF0F6",
                        color: PINK,
                        fontSize: 12,
                        fontWeight: 800,
                      }}>
                        요약과 튜터로 보기
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.6 }}>
                  이번 회차에서는 뚜렷한 약점 문항이 없습니다. 다음에는 {nextDifficulty} 난이도로 실전 감각을 이어가세요.
                </p>
              )}
            </div>

            {reviewMaterials.length > 1 && (
              <div style={{
                margin: "0 0 24px",
                padding: 18,
                borderRadius: 14,
                background: "#fff",
                border: `1px solid ${BORDER_COLOR}`,
                textAlign: "left",
              }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: "#222" }}>
                  이 퀴즈에 사용한 자료
                </h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {reviewMaterials.map(material => (
                    <button
                      key={material.id}
                      type="button"
                      onClick={() => goToMaterialReview({ materialId: material.id })}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${BORDER_COLOR}`,
                        background: "#fafafa",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ minWidth: 0, color: "#444", fontSize: 13, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {material.name}
                      </span>
                      <span style={{ flexShrink: 0, color: CYAN, fontSize: 12, fontWeight: 850 }}>
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
                background: "#fff",
                border: `1px solid ${BORDER_COLOR}`,
                textAlign: "left",
              }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: "#222" }}>
                  오답 복습
                </h3>
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
                      <div key={`${quiz.question}-${wrongIndex}`} style={{ padding: 14, borderRadius: 12, background: "#fafafa", border: "1px solid #f0f0f0" }}>
                        <div style={{ marginBottom: 8, fontSize: 13, color: "#333", fontWeight: 800, lineHeight: 1.5 }}>
                          Q{questionIndex + 1}. {quiz.question}
                        </div>
                        <div style={{ display: "grid", gap: 5, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                          <span>내 답: <strong style={{ color: PINK }}>{userAnswer ?? "미응답"}</strong></span>
                          <span>정답: <strong style={{ color: CYAN }}>{correctAnswer ?? "정답 정보 없음"}</strong></span>
                          <span>틀린 이유: {attemptAnswer?.feedback || quiz.explanation}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button onClick={() => goToMaterialReview()} style={{
                padding: "12px 24px", borderRadius: 12, border: "1px solid #f3c3da",
                background: "#FFF0F6", fontSize: 14, fontWeight: 700, cursor: "pointer", color: PINK
              }}>약점 요약 보기</button>
              <button onClick={() => goToMaterialReview({ tutorQuestion: makeTutorQuestion(primaryWeakTopic) })} style={{
                padding: "12px 24px", borderRadius: 12, border: "1px solid #e0e0e0",
                background: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", color: "#555"
              }}>AI 튜터로 복습</button>
              <button onClick={retryQuiz} style={{
                padding: "12px 24px", borderRadius: 12, border: "none",
                background: PINK, fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#fff"
              }}>다시 풀기</button>
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
      <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")} />
        <div style={{ padding: 24, maxWidth: 600, margin: "40px auto" }}>
          <Card style={{ padding: 28, textAlign: "center" }}>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#666" }}>표시할 퀴즈가 없습니다.</p>
            <button onClick={() => setView("courseDetail")} style={{
              padding: "10px 20px", borderRadius: 10, border: "none",
              background: PINK, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer"
            }}>설정으로 돌아가기</button>
          </Card>
        </div>
      </div>
    );
  }
  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebarEl}
      <Header label={openedQuizTitle || `${selectedCourse} 퀴즈`} onOpenSidebar={() => setSidebar(true)} onHome={() => navigate("/")}
        extra={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {examMode && remainingSeconds !== null && (
              <span style={{ fontSize: 14, fontWeight: 800, color: remainingSeconds <= 60 ? PINK : CYAN }}>
                {formatSeconds(remainingSeconds)}
              </span>
            )}
            <span style={{ fontSize: 14, fontWeight: 600, color: "#999" }}>{current + 1} / {quizzes.length}</span>
          </div>
        } />
      <div style={{ height: 3, background: "#f0f0f0" }}>
        <div style={{ height: 3, background: PINK, width: `${((current + 1) / quizzes.length) * 100}%`, transition: "width 0.3s" }}/>
      </div>
      <div style={{ padding: 24, maxWidth: 600, margin: "30px auto" }}>
        <Card style={{ padding: 28 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: CYAN, marginBottom: 10, display: "block" }}>Q{current + 1}</span>
          <h3 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 600, color: "#222", lineHeight: 1.5 }}>{q.question}</h3>
          {isShortAnswer || isSubjective ? (
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: isSubjective ? "flex-end" : "stretch" }}>
                {isSubjective ? (
                  <textarea
                    value={typeof selected === "string" ? selected : shortAnswerInput}
                    onChange={e => setShortAnswerInput(e.target.value)}
                    disabled={selected !== undefined || grading}
                    placeholder="근거와 함께 답안을 작성하세요"
                    rows={5}
                    style={{
                      flex: 1,
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: "1.5px solid #f0f0f0",
                      background: selected !== undefined ? "#fafafa" : "#fff",
                      fontSize: 14,
                      color: "#444",
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
                    onKeyDown={e => { if (e.key === "Enter") submitShortAnswer(); }}
                    disabled={selected !== undefined}
                    placeholder="정답을 입력하세요"
                    style={{
                      flex: 1, padding: "14px 16px", borderRadius: 12, border: "1.5px solid #f0f0f0",
                      background: selected !== undefined ? "#fafafa" : "#fff", fontSize: 14, color: "#444", outline: "none"
                    }}
                  />
                )}
                <button
                  onClick={isSubjective ? submitSubjectiveAnswer : submitShortAnswer}
                  disabled={!shortAnswerInput.trim() || selected !== undefined || grading}
                  style={{
                    padding: isSubjective ? "14px 20px" : "0 20px", borderRadius: 12, border: "none",
                    background: shortAnswerInput.trim() && selected === undefined && !grading ? PINK : "#e0e0e0",
                    color: "#fff", fontSize: 14, fontWeight: 700,
                    cursor: shortAnswerInput.trim() && selected === undefined && !grading ? "pointer" : "default"
                  }}
                >{grading ? "채점 중..." : "제출"}</button>
              </div>
              {selected !== undefined && isShortAnswer && !examMode && (
                <div style={{
                  marginTop: 12, padding: "12px 16px", borderRadius: 12,
                  background: normalizeAnswer(String(selected)) === normalizeAnswer(q.answerText || "") ? "#E8FAFE" : "#FFF0F6",
                  color: normalizeAnswer(String(selected)) === normalizeAnswer(q.answerText || "") ? CYAN : PINK,
                  fontSize: 13, fontWeight: 700
                }}>
                  정답: {q.answerText}
                </div>
              )}
              {selected !== undefined && isSubjective && subjectiveGrade && !examMode && (
                <div style={{
                  marginTop: 12,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: subjectiveGrade.isCorrect ? "#E8FAFE" : "#FFF0F6",
                  color: subjectiveGrade.isCorrect ? CYAN : PINK,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  <strong>{subjectiveGrade.score}점</strong> · {subjectiveGrade.feedback}
                  <div style={{ marginTop: 8, color: "#555" }}>
                    모범답안: {subjectiveGrade.referenceAnswer}
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
                let bg = "#fafafa", border = "#f0f0f0", color = "#444";
                if (answered) {
                  if (revealAnswer && isCorrect) { bg = "#E8FAFE"; border = CYAN; color = CYAN; }
                  else if (revealAnswer && isSelected && !isCorrect) { bg = "#FFF0F6"; border = PINK; color = PINK; }
                  else if (isSelected) { bg = "#f3f3f3"; border = "#d8d8d8"; color = "#333"; }
                }
                return (
                  <button key={i} onClick={() => selectAnswer(i)} style={{
                    padding: "14px 18px", borderRadius: 12, border: `1.5px solid ${border}`,
                    background: bg, textAlign: "left", fontSize: 14, color, cursor: answered ? "default" : "pointer",
                    fontWeight: isSelected || (revealAnswer && isCorrect) ? 600 : 400, transition: "all 0.2s"
                  }}>
                    <span style={{ marginRight: 10, fontWeight: 600 }}>{String.fromCharCode(65 + i)}.</span>
                    {opt}
                    {revealAnswer && isCorrect && <span style={{ float: "right" }}>O</span>}
                    {revealAnswer && isSelected && !isCorrect && <span style={{ float: "right" }}>X</span>}
                  </button>
                );
              })}
            </div>
          )}
          {showExplanation && (
            <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: "#FAFAFA", fontSize: 13, color: "#555", lineHeight: 1.6 }}>
              <strong style={{ color: CYAN }}>해설:</strong> {q.explanation}
            </div>
          )}
          {selected !== undefined && (
            <button onClick={next} style={{
              marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
              background: PINK, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer"
            }}>{current < quizzes.length - 1 ? "다음 문제" : "결과 보기"}</button>
          )}
        </Card>
      </div>
    </div>
  );
}
