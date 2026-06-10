import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import type { PageRouteLabel } from "../common";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import { loadSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadQuizAttemptsFromServer } from "../services/quizAttempts";
import { generateStudyPlan, type StudyPlanMode } from "../services/studyPlan";
import {
  isPaceSprint,
  paceCatchUpTarget,
  paceDateKey,
  paceProgressPct,
  paceReadiness,
  paceRemaining,
  paceStatus,
  paceTodayTarget,
  readinessTier,
  type PacePlan,
  type PaceStatus,
} from "../services/pace";
import {
  createClientId,
  ddayTypeColors,
  ddayTypeLabels,
  formatDdayLabel,
  getDaysLeft,
  PACE_NO_DDAY_HORIZON_DAYS,
  type Dday,
  type DdayType,
  type Plan,
} from "../services/studyPlanner";
import { AddDdayModal, AddPlanModal } from "../components/PlannerModals";

type CourseModalProps = { onClose: () => void; onAdd: (name: string) => void };
type RenameCourseModalProps = { course: string; courses: string[]; onClose: () => void; onRename: (oldName: string, newName: string) => void };
type DeleteCourseModalProps = { course: string; onClose: () => void; onDelete: (name: string) => void };
type CourseDetailSection = "materials" | "summaries" | "quizzes";
type CourseDetailModalProps = {
  course: string;
  initialSection?: CourseDetailSection;
  onClose: () => void;
  onGoSummary: () => void;
  onGoQuiz: () => void;
  onOpenMaterial: (material: CourseMaterial, initialTab?: "original" | "summary" | "quiz") => void;
};
type PlanSource = {
  key: string;
  label: string;
  meta: string;
  kind: DdayType | "carryover";
  daysLeft?: number;
  dday?: Dday;
  plan?: Plan;
};

type CourseStats = {
  materials: number;
  summaries: number;
  quizzes: number;
  loading: boolean;
  error: string;
};

const defaultStats: CourseStats = { materials: 0, summaries: 0, quizzes: 0, loading: true, error: "" };

const materialMeta = (material: CourseMaterial) => {
  if (material.pages) return `${material.pages}페이지`;
  if (material.slides) return `${material.slides}슬라이드`;
  return material.type.toUpperCase();
};

const AddCourseModal = ({ onClose, onAdd }: CourseModalProps) => {
  const [name, setName] = useState("");
  const handleAdd = () => {
    const courseName = name.trim();
    if (!courseName) return;
    onAdd(courseName);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 추가</h3>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAdd(); }} placeholder="과목명 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleAdd} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "var(--color-on-brand)", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

const RenameCourseModal = ({ course, courses, onClose, onRename }: RenameCourseModalProps) => {
  const [name, setName] = useState(course);
  const trimmedName = name.trim();
  const isDuplicate = trimmedName !== course && courses.includes(trimmedName);
  const canSave = Boolean(trimmedName) && !isDuplicate;

  const handleSave = () => {
    if (!canSave) return;
    onRename(course, trimmedName);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>강의 이름 변경</h3>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10,
            border: isDuplicate ? "1px solid var(--color-danger)" : "1px solid var(--color-border-soft)",
            fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: isDuplicate ? 8 : 16
          }}
        />
        {isDuplicate && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--color-danger)" }}>이미 등록된 강의 이름입니다.</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleSave} disabled={!canSave} style={{
            padding: "8px 18px", borderRadius: 10, border: "none",
            background: canSave ? PINK : "var(--color-border-soft)", color: "var(--color-on-brand)",
            cursor: canSave ? "pointer" : "default", fontSize: 14, fontWeight: 600
          }}>저장</button>
        </div>
      </Card>
    </div>
  );
};

const DeleteCourseModal = ({ course, onClose, onDelete }: DeleteCourseModalProps) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <Card style={{ padding: 28, width: 360 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>강의를 삭제할까요?</h3>
      <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
        {course}의 저장된 강의자료, 요약, 퀴즈도 함께 삭제됩니다.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
        <button onClick={() => { onDelete(course); onClose(); }} style={{
          padding: "8px 18px", borderRadius: 10, border: "none",
          background: "var(--color-danger)", color: "var(--color-on-brand)", cursor: "pointer", fontSize: 14, fontWeight: 700
        }}>삭제</button>
      </div>
    </Card>
  </div>
);

const CourseDetailModal = ({
  course,
  onClose,
  onGoSummary,
  onGoQuiz,
  onOpenMaterial,
}: CourseDetailModalProps) => {
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    const loadCourseDetail = async () => {
      setLoading(true);
      setError("");
      try {
        const [nextMaterials, nextSummaries, nextQuizSets] = await Promise.all([
          loadCourseMaterialsFromServer(course),
          loadSummariesFromServer(course),
          loadQuizSetsFromServer(course),
        ]);
        if (ignore) return;
        setMaterials(nextMaterials);
        setSummaries(nextSummaries);
        setQuizSets(nextQuizSets);
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "강의 상세 정보를 불러오지 못했습니다.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void loadCourseDetail();
    return () => {
      ignore = true;
    };
  }, [course]);

  const emptyText = loading ? "불러오는 중..." : "아직 자료가 없습니다";
  const summaryCountFor = (materialId: string) => summaries.filter(s => s.materialIds?.includes(materialId)).length;
  const quizCountFor = (materialId: string) => quizSets.filter(q => q.materialIds?.includes(materialId)).length;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 220,
      background: "rgba(0,0,0,0.32)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <Card style={{
        width: "min(900px, 100%)",
        maxHeight: "calc(100vh - 56px)",
        overflowY: "auto",
        padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 850, color: "var(--color-text-strong)" }}>{course}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>강의자료 목록입니다. 자료를 눌러 상세를 보거나, 아래 버튼으로 새 요약·퀴즈를 만드세요.</p>
          </div>
          <button onClick={onClose} aria-label="강의 상세 닫기" style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            border: "none",
            background: "var(--color-surface)",
            color: "var(--color-muted)",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: "32px",
            padding: 0,
            flexShrink: 0,
          }}>×</button>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "var(--color-tint-pink)", color: "var(--color-danger)", fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ border: "1px solid var(--color-border-soft)", borderRadius: 14, background: "var(--color-card)", minHeight: 320, padding: 18 }}>
          {materials.length === 0 ? (
            <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "var(--color-muted)" }}>{emptyText}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {materials.map((material, index) => {
                const summaryCount = summaryCountFor(material.id);
                const quizCount = quizCountFor(material.id);
                return (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => onOpenMaterial(material)}
                    style={{
                      width: "100%",
                      padding: "14px 0",
                      border: "none",
                      borderBottom: index < materials.length - 1 ? "1px solid #f3f3f3" : "none",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ minWidth: 0, fontSize: 15, fontWeight: 800, color: "var(--color-text-strong)", lineHeight: 1.45, wordBreak: "break-word" }}>
                        {material.name}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "#c4c4c4" }}>
                        {materialMeta(material)}
                      </span>
                    </span>
                    <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, fontSize: 12, fontWeight: 800 }}>
                      <span style={{ color: summaryCount > 0 ? PINK : "#ccc" }}>요약 {summaryCount}</span>
                      <span style={{ color: quizCount > 0 ? CYAN : "#ccc" }}>퀴즈 {quizCount}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onGoSummary} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "var(--color-tint-pink)",
            color: PINK,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>요약 새로 생성</button>
          <button onClick={onGoQuiz} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "var(--color-tint-cyan)",
            color: CYAN,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>퀴즈 새로 생성</button>
        </div>
      </Card>
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { courses, addCourse, renameCourse, deleteCourse } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const page: PageRouteLabel = "대시보드";
  const [ddays, setDdays] = useState<Dday[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dashboardStateLoaded, setDashboardStateLoaded] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showAddDday, setShowAddDday] = useState(false);
  const [showAllDdays, setShowAllDdays] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showStudyPlanOptions, setShowStudyPlanOptions] = useState(false);
  const [showPlanSourcePicker, setShowPlanSourcePicker] = useState(false);
  const [pendingStudyPlanMode, setPendingStudyPlanMode] = useState<StudyPlanMode>("balanced");
  const [selectedPlanSourceKeys, setSelectedPlanSourceKeys] = useState<string[]>([]);
  const [planSourceMessage, setPlanSourceMessage] = useState("");
  const [studyPlanMessage, setStudyPlanMessage] = useState("");
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);
  const [studyPlanError, setStudyPlanError] = useState("");
  const [editingPlanKey, setEditingPlanKey] = useState<string | null>(null);
  const [editingPlanText, setEditingPlanText] = useState("");
  const [openCourseMenu, setOpenCourseMenu] = useState<string | null>(null);
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<string | null>(null);
  const [detailCourse, setDetailCourse] = useState<string | null>(null);
  const [detailSection, setDetailSection] = useState<CourseDetailSection | undefined>(undefined);
  const [courseStats, setCourseStats] = useState<Record<string, CourseStats>>({});
  // 페이스 플랜은 학습 캘린더에서 관리한다. 대시보드는 "오늘 추천 과목" 계산을 위해 읽기 전용으로만 로드.
  const [pacePlans, setPacePlans] = useState<PacePlan[]>([]);
  // 퀴즈 기준 플랜의 진행도를 파생 계산하기 위한 과목별 응시 기록 {count, createdAt}.
  const [courseQuizAttempts, setCourseQuizAttempts] = useState<Record<string, { count: number; createdAt: number; scorePercent: number }[]>>({});

  useEffect(() => {
    let ignore = false;
    if (courses.length === 0) {
      setCourseStats({});
      return () => { ignore = true; };
    }
    setCourseStats(prev => {
      const next: Record<string, CourseStats> = {};
      courses.forEach(course => { next[course] = prev[course] || { ...defaultStats }; });
      return next;
    });
    const loadStats = async () => {
      await Promise.all(courses.map(async course => {
        try {
          const [materials, summaries, quizSets] = await Promise.all([
            loadCourseMaterialsFromServer(course),
            loadSummariesFromServer(course),
            loadQuizSetsFromServer(course),
          ]);
          if (ignore) return;
          setCourseStats(prev => ({ ...prev, [course]: { materials: materials.length, summaries: summaries.length, quizzes: quizSets.length, loading: false, error: "" } }));
        } catch (err) {
          if (ignore) return;
          setCourseStats(prev => ({ ...prev, [course]: { ...(prev[course] || defaultStats), loading: false, error: err instanceof Error ? err.message : "오류" } }));
        }
      }));
    };
    void loadStats();
    return () => { ignore = true; };
  }, [courses]);

  const openCourseDetail = (course: string, section?: CourseDetailSection) => {
    setDetailSection(section);
    setDetailCourse(course);
  };

  useEffect(() => {
    let ignore = false;
    Promise.all([
      loadDashboardState<Dday[]>("ddays", []),
      loadDashboardState<Plan[]>("plans", []),
    ])
      .then(([nextDdays, nextPlans]) => {
        if (ignore) return;
        setDdays(nextDdays.map(item => ({ ...item, type: item.type || "assignment" })));
        setPlans(nextPlans);
        setDashboardStateLoaded(true);
      })
      .catch(error => {
        console.warn("대시보드 상태 불러오기 실패", error);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!dashboardStateLoaded) return;
    saveDashboardState("ddays", ddays).catch(console.warn);
  }, [dashboardStateLoaded, ddays]);

  useEffect(() => {
    if (!dashboardStateLoaded) return;
    saveDashboardState("plans", plans).catch(console.warn);
  }, [dashboardStateLoaded, plans]);

  useEffect(() => {
    let ignore = false;
    loadDashboardState<PacePlan[]>("pacePlans", [])
      .then(next => {
        if (ignore) return;
        setPacePlans(next);
      })
      .catch(error => console.warn("페이스 플랜 불러오기 실패", error));
    return () => { ignore = true; };
  }, []);

  // 페이스 플랜 과목의 응시 기록을 불러와 자동 진행도(퀴즈 기준)와 시험 준비도(최근 점수) 계산에 사용.
  // 과목 집합이 바뀔 때만 재조회하도록 안정 키에 의존(수동 플랜 변경 시 불필요한 재조회 방지).
  const paceCoursesKey = JSON.stringify(
    Array.from(new Set(pacePlans.map(plan => plan.course))).sort()
  );
  useEffect(() => {
    const paceCourses: string[] = JSON.parse(paceCoursesKey);
    if (paceCourses.length === 0) { setCourseQuizAttempts({}); return; }
    let ignore = false;
    Promise.all(paceCourses.map(async course => {
      const attempts = await loadQuizAttemptsFromServer(course);
      const mapped = attempts
        .map(attempt => ({ count: attempt.count, createdAt: attempt.createdAt, scorePercent: attempt.scorePercent }))
        .sort((a, b) => b.createdAt - a.createdAt); // 최근 응시가 앞 — 준비도 가중치(최근일수록 ↑)용
      return [course, mapped] as const;
    }))
      .then(entries => { if (!ignore) setCourseQuizAttempts(Object.fromEntries(entries)); })
      .catch(error => console.warn("페이스 퀴즈 진행 불러오기 실패", error));
    return () => { ignore = true; };
  }, [paceCoursesKey]);


  useEffect(() => {
    if (!openCourseMenu) return;
    const closeMenu = () => setOpenCourseMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openCourseMenu]);

  const sortedDdays = [...ddays].sort((a, b) => getDaysLeft(a.date) - getDaysLeft(b.date));
  const displayDdays = showAllDdays ? sortedDdays : sortedDdays.slice(0, 3);
  const incompletePlans = plans.filter(plan => !plan.done);
  const makeDdaySourceKey = (dday: Dday, index: number) => `dday-${dday.id || `${dday.subj}-${dday.date}-${index}`}`;
  const makePlanSourceKey = (plan: Plan, index: number) => `plan-${plan.id || `${plan.text}-${index}`}`;
  const planSources: PlanSource[] = [
    ...sortedDdays.map((dday, index) => {
      const daysLeft = getDaysLeft(dday.date);
      const type = dday.type || "assignment";
      return {
        key: makeDdaySourceKey(dday, index),
        label: dday.subj,
        meta: `${ddayTypeLabels[type]} ${formatDdayLabel(daysLeft)}`,
        kind: type,
        daysLeft,
        dday,
      };
    }),
    ...incompletePlans.map((plan, index) => ({
      key: makePlanSourceKey(plan, index),
      label: plan.text,
      meta: "미완료",
      kind: "carryover" as const,
      plan,
    })),
  ];
  const canGenerateStudyPlan = planSources.length > 0;
  const selectedPlanSources = planSources.filter(source => selectedPlanSourceKeys.includes(source.key));
  const carryoverPlanSources = planSources.filter(source => source.kind === "carryover");
  const ddayPlanSources = planSources.filter(source => source.kind !== "carryover");

  const summarizePlanSources = (sources: PlanSource[], mode: StudyPlanMode) => {
    const carryoverCount = sources.filter(source => source.kind === "carryover").length;
    const assignmentCount = sources.filter(source => source.kind === "assignment").length;
    const examCount = sources.filter(source => source.kind === "exam").length;
    const eventCount = sources.filter(source => source.kind === "event").length;
    const parts = [
      carryoverCount ? `미완료 계획 ${carryoverCount}개` : "",
      assignmentCount ? `가까운 과제 ${assignmentCount}개` : "",
      examCount ? `가까운 시험 ${examCount}개` : "",
      eventCount ? `가까운 일정 ${eventCount}개` : "",
    ].filter(Boolean);
    if (parts.length === 0) return "자동으로 고른 항목이 없어요. 반영할 항목을 선택해 주세요.";
    if (mode === "lighter") return `${parts.join("와 ")}만 가볍게 반영할게요.`;
    if (mode === "harder") return `${parts.join("와 ")}를 조금 빡세게 반영할게요.`;
    if (mode === "assignment") return `과제 중심으로 ${parts.join("와 ")}를 골라뒀어요.`;
    if (mode === "event") return `일정 위주로 ${parts.join("와 ")}를 골라뒀어요.`;
    return `${parts.join("와 ")}를 반영할게요.`;
  };

  const getRecommendedPlanSourceKeys = (mode: StudyPlanMode) => {
    const carryoverLimit = mode === "harder" ? 5 : mode === "lighter" ? 1 : mode === "event" ? 1 : 2;
    const ddayLimit = mode === "harder" ? 5 : mode === "lighter" ? 1 : 3;
    const carryoverSources = planSources
      .filter(source => source.kind === "carryover")
      .slice(0, carryoverLimit);
    // 과제·시험은 마감 전 미리 준비하는 "마감형"으로 함께 보고, 일정(event)은 당일 위주로 본다.
    const isDeadlineKind = (kind: PlanSource["kind"]) => kind === "assignment" || kind === "exam";
    const ddaySources = planSources
      .filter(source => {
        const daysLeft = source.daysLeft ?? 999;
        if (mode === "assignment") return source.kind === "assignment" && daysLeft <= 10;
        if (mode === "event") return source.kind === "event" && daysLeft <= 7;
        if (mode === "lighter") return isDeadlineKind(source.kind) ? daysLeft <= 3 : daysLeft <= 1;
        if (mode === "harder") return isDeadlineKind(source.kind) ? daysLeft <= 14 : daysLeft <= 2;
        return isDeadlineKind(source.kind) ? daysLeft <= 7 : daysLeft <= 1;
      })
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, ddayLimit);
    return [...carryoverSources, ...ddaySources].map(source => source.key);
  };

  const openPlanSourcePicker = (mode: StudyPlanMode) => {
    if (!canGenerateStudyPlan) return;
    const recommendedKeys = getRecommendedPlanSourceKeys(mode);
    const recommendedSources = planSources.filter(source => recommendedKeys.includes(source.key));
    setPendingStudyPlanMode(mode);
    setSelectedPlanSourceKeys(recommendedKeys);
    setPlanSourceMessage(summarizePlanSources(recommendedSources, mode));
    setStudyPlanError("");
    setShowPlanSourcePicker(true);
  };

  const requestStudyPlan = async () => {
    if (selectedPlanSources.length === 0 || studyPlanLoading) return;
    setStudyPlanLoading(true);
    setStudyPlanError("");
    try {
      const selectedDdays = selectedPlanSources
        .map(source => source.dday)
        .filter((dday): dday is Dday => Boolean(dday))
        // study-plan API는 assignment/event만 알아서, 시험은 마감형 과제로 매핑해 보낸다.
        .map(dday => ({ ...dday, type: dday.type === "exam" ? ("assignment" as const) : dday.type }));
      const selectedIncompletePlans = selectedPlanSources
        .map(source => source.plan)
        .filter((plan): plan is Plan => Boolean(plan));
      const result = await generateStudyPlan(selectedDdays, selectedIncompletePlans, pendingStudyPlanMode);
      setStudyPlanMessage(result.message);
      setPlans(result.items.map(item => ({
        id: createClientId(),
        text: `${item.text} ${item.minutes}분`,
        done: false,
        minutes: item.minutes,
        sourceType: item.sourceType,
      })));
      setShowPlanSourcePicker(false);
    } catch (err) {
      setStudyPlanError(err instanceof Error ? err.message : "학습 계획 생성 실패");
    } finally {
      setStudyPlanLoading(false);
    }
  };

  const deleteDday = (target: Dday) => {
    setDdays(prev => {
      if (target.id) return prev.filter(item => item.id !== target.id);
      const targetIndex = prev.findIndex(item => item.subj === target.subj && item.date === target.date);
      if (targetIndex < 0) return prev;
      return prev.filter((_, index) => index !== targetIndex);
    });
  };

  const deletePlan = (target: Plan, targetIndex: number) => {
    setPlans(prev => prev.filter((item, index) =>
      target.id ? item.id !== target.id : index !== targetIndex
    ));
  };

  const togglePlanSource = (sourceKey: string) => {
    setSelectedPlanSourceKeys(prev =>
      prev.includes(sourceKey)
        ? prev.filter(key => key !== sourceKey)
        : [...prev, sourceKey]
    );
  };

  const startEditPlan = (plan: Plan, index: number) => {
    setEditingPlanKey(plan.id || `index-${index}`);
    setEditingPlanText(plan.text);
  };

  const finishEditPlan = (target: Plan, targetIndex: number) => {
    const nextText = editingPlanText.trim();
    setEditingPlanKey(null);
    setEditingPlanText("");
    if (!nextText) return;
    setPlans(prev => prev.map((item, index) => {
      const isTarget = target.id ? item.id === target.id : index === targetIndex;
      return isTarget ? { ...item, text: nextText } : item;
    }));
  };

  const pacePlanViews = pacePlans.map(plan => {
    const dday = ddays.find(item => item.id === plan.ddayId);
    const daysLeft = dday ? getDaysLeft(dday.date) : PACE_NO_DDAY_HORIZON_DAYS;
    // 퀴즈 기준 플랜은 생성 이후 같은 과목 응시 문항수를 진행도로 파생, 그 외는 저장된 doneUnits 사용.
    const auto = plan.basis === "quiz";
    const attempts = courseQuizAttempts[plan.course] ?? [];
    const autoDone = auto
      ? attempts
          .filter(attempt => attempt.createdAt >= plan.createdAt)
          .reduce((sum, attempt) => sum + attempt.count, 0)
      : 0;
    const doneUnits = auto ? Math.min(plan.totalUnits, autoDone) : plan.doneUnits;
    const view: PacePlan = { ...plan, doneUnits };
    const status: PaceStatus = dday ? paceStatus(view, dday.date) : "on";
    // 따라잡기: 연결된 D-day가 있으면 밀린 만큼 오늘 목표를 올려준다(없으면 기본 목표).
    const todayTarget = dday ? paceCatchUpTarget(view, dday.date, daysLeft) : paceTodayTarget(view, daysLeft);
    // 시험 준비도: 진도 + 최근 퀴즈 점수(없으면 진도로 대체). 막판 스퍼트: 연결 D-day가 D-3 이내.
    const readiness = paceReadiness(view, attempts.map(attempt => attempt.scorePercent));
    const sprint = dday ? isPaceSprint(daysLeft) : false;
    return {
      plan,
      dday,
      daysLeft,
      status,
      auto,
      doneUnits,
      totalUnits: plan.totalUnits,
      unitLabel: plan.unitLabel ?? "개",
      remaining: paceRemaining(view),
      progress: paceProgressPct(view),
      todayTarget,
      readiness,
      tier: readinessTier(readiness),
      hasScores: attempts.length > 0,
      sprint,
    };
  });
  const activePaceViews = pacePlanViews.filter(view => view.remaining > 0);
  const todayStr = paceDateKey(new Date());
  // 오늘의 학습계획에는 날짜가 없거나(레거시=오늘) 오늘인 항목만 노출, 나머지는 캘린더에서.
  const todayPlanEntries = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => !plan.date || plan.date === todayStr);
  const statusRank: Record<PaceStatus, number> = { behind: 0, slightly: 1, on: 2 };
  // 오늘 바로 시작할 추천 과목 — 가장 급한(밀린·임박) 진행 중 플랜 하나.
  const stepView = [...activePaceViews]
    .sort((a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      a.daysLeft - b.daysLeft ||
      a.progress - b.progress
    )[0] ?? null;
  const recommendedCourse = stepView?.plan.course ?? null;
  const startHint = !stepView
    ? "추천할 과목이 아직 없어요."
    : stepView.status !== "on"
      ? `조금 밀렸어요. ${stepView.plan.course}부터 시작해요.`
      : stepView.dday
        ? `오늘 추천: ${stepView.plan.course} · ${formatDdayLabel(stepView.daysLeft)}`
        : `오늘 추천: ${stepView.plan.course}`;

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={(item) => { navigate(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      {showAddCourse && <AddCourseModal onClose={() => setShowAddCourse(false)} onAdd={addCourse} />}
      {renamingCourse && <RenameCourseModal course={renamingCourse} courses={courses} onClose={() => setRenamingCourse(null)} onRename={renameCourse} />}
      {deletingCourse && <DeleteCourseModal course={deletingCourse} onClose={() => setDeletingCourse(null)} onDelete={deleteCourse} />}
      {detailCourse && (
        <CourseDetailModal
          course={detailCourse}
          initialSection={detailSection}
          onClose={() => {
            setDetailCourse(null);
            setDetailSection(undefined);
          }}
          onGoSummary={() => {
            navigate(pageRoutes["자료 요약"], { state: { selectedCourse: detailCourse, fromDashboard: true } });
          }}
          onGoQuiz={() => {
            navigate(pageRoutes["퀴즈 생성"], { state: { course: detailCourse, fromDashboard: true } });
          }}
          onOpenMaterial={(material, initialTab) => {
            navigate(pageRoutes["자료 요약"], {
              state: { selectedCourse: detailCourse, materialId: material.id, viewMaterial: true, materialDetailTab: initialTab, fromDashboard: true },
            });
          }}
        />
      )}
      {showAddDday && <AddDdayModal onClose={() => setShowAddDday(false)} onAdd={(type, s, d) => setDdays(prev => [...prev, { id: createClientId(), type, subj: s, date: d }])} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={t => setPlans(prev => [...prev, { id: createClientId(), text: t, done: false }])} />}

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto", zoom: 0.85 }}>
        <Card className="mb-5 border border-cyan/30 bg-cyan/5 p-5">
          <h2 className="m-0 text-xl font-extrabold leading-7 text-[#222] dark:text-slate-100">
            공부 시작하기
          </h2>
          <p className="m-0 mt-2 text-sm font-bold leading-5 text-muted">
            {startHint}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate(pageRoutes["오답 노트"])}
              className="flex flex-col items-start gap-1 rounded-[14px] border border-pink bg-white px-5 py-4 text-left cursor-pointer hover:bg-pink/5 dark:bg-slate-900"
            >
              <span className="text-base font-extrabold text-pink">오답 다시 풀기</span>
              <span className="text-xs font-semibold text-pink/80">틀린 문제부터 확인</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(
                pageRoutes["자료 요약"],
                recommendedCourse ? { state: { selectedCourse: recommendedCourse, fromDashboard: true } } : undefined,
              )}
              className="flex flex-col items-start gap-1 rounded-[14px] border border-cyan bg-white px-5 py-4 text-left cursor-pointer hover:bg-cyan/5 dark:bg-slate-900"
            >
              <span className="text-base font-extrabold text-cyan">자료 복습하기</span>
              <span className="text-xs font-semibold text-cyan/80">요약과 자료 보기</span>
            </button>
          </div>
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
          {/* 강의 목록 카드 그리드 */}
          <div>
            {courses.length === 0 ? (
              <div style={{
                minHeight: 300, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--color-text-secondary)",
              }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 850, color: "var(--color-text-strong)" }}>아직 등록된 강의가 없습니다.</h2>
                <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-muted)" }}>강의를 추가하면 자료, 요약, 퀴즈를 관리할 수 있어요.</p>
                <button onClick={() => setShowAddCourse(true)} style={{
                  padding: "11px 18px", borderRadius: 10, border: "none", background: PINK,
                  color: "var(--color-on-brand)", fontSize: 14, fontWeight: 850, cursor: "pointer",
                  boxShadow: "0 10px 24px rgba(240,112,174,0.22)",
                }}>+ 강의 추가하기</button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                {courses.map(course => {
                  const stats = courseStats[course] || defaultStats;
                  const statsLabel = stats.loading
                    ? "자료 - · 요약 - · 퀴즈 -"
                    : `자료 ${stats.materials} · 요약 ${stats.summaries} · 퀴즈 ${stats.quizzes}`;
                  return (
                    <Card
                      key={course}
                      role="button"
                      tabIndex={0}
                      onClick={() => openCourseDetail(course)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCourseDetail(course); } }}
                      style={{
                        minHeight: 120, padding: 20, cursor: "pointer", position: "relative",
                        display: "flex", flexDirection: "column", justifyContent: "space-between",
                        transition: "transform 0.15s ease, box-shadow 0.15s ease",
                      }}
                    >
                      <div>
                        <h2 style={{ margin: "0 34px 10px 0", fontSize: 17, fontWeight: 850, color: "var(--color-text-strong)", lineHeight: 1.35, wordBreak: "break-word" }}>
                          {course}
                        </h2>
                        <p style={{ margin: 0, fontSize: 13, color: stats.error ? "var(--color-danger)" : "var(--color-text-secondary)", fontWeight: 700 }}>
                          {stats.error ? "정보를 불러오지 못했습니다" : statsLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`${course} 관리 메뉴`}
                        onClick={e => { e.stopPropagation(); setOpenCourseMenu(prev => prev === course ? null : course); }}
                        style={{
                          position: "absolute", top: 14, right: 14,
                          width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-border-soft)",
                          background: openCourseMenu === course ? "var(--color-surface)" : "var(--color-card)",
                          color: "var(--color-muted)", cursor: "pointer", fontSize: 18, lineHeight: "26px", padding: 0,
                        }}
                      >...</button>
                      {openCourseMenu === course && (
                        <div onClick={e => e.stopPropagation()} style={{
                          position: "absolute", right: 14, top: 48, width: 128, padding: 6,
                          borderRadius: 12, border: "1px solid var(--color-border-soft)", background: "var(--color-card)",
                          boxShadow: "0 12px 28px rgba(0,0,0,0.12)", zIndex: 20,
                        }}>
                          <button type="button" onClick={() => { setOpenCourseMenu(null); setRenamingCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "var(--color-card)", color: "var(--color-text-strong)", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600 }}>이름 변경</button>
                          <button type="button" onClick={() => { setOpenCourseMenu(null); setDeletingCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "var(--color-card)", color: "var(--color-danger)", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 700 }}>삭제</button>
                        </div>
                      )}
                    </Card>
                  );
                })}
                <button onClick={() => setShowAddCourse(true)} style={{
                  minHeight: 120, borderRadius: 18, border: "1px dashed #d8dde8",
                  background: "var(--color-card)", color: PINK, fontSize: 15, fontWeight: 850, cursor: "pointer",
                }}>+ 강의 추가하기</button>
              </div>
            )}
          </div>

          {/* D-day + 학습 계획 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* D-day */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: PINK }}>D-day</h3>
                <button onClick={() => setShowAddDday(true)} style={{
                  background: "none", border: "none", fontSize: 20, color: PINK, cursor: "pointer", lineHeight: 1
                }}>+</button>
              </div>
              {sortedDdays.length === 0 ? (
                <p style={{ color: "var(--color-muted)", fontSize: 13, textAlign: "center", padding: "10px 0" }}>설정된 D-day가 없습니다</p>
              ) : (
                <>
                  {displayDdays.map((d, i) => {
                    const left = getDaysLeft(d.date);
                    const type = d.type || "assignment";
                    return (
                      <div key={d.id || `${d.subj}-${d.date}-${i}`} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 0", borderBottom: i < displayDdays.length - 1 ? "1px solid #f5f5f5" : "none"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{
                            flexShrink: 0, padding: "3px 7px", borderRadius: 999,
                            background: ddayTypeColors[type].soft,
                            color: ddayTypeColors[type].solid,
                            fontSize: 11, fontWeight: 800,
                          }}>{ddayTypeLabels[type]}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-strong)", wordBreak: "break-word" }}>{d.subj}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: left <= 7 ? PINK : CYAN }}>
                            {left > 0 ? `D-${left}` : left === 0 ? "D-Day!" : `D+${Math.abs(left)}`}
                          </span>
                          <button
                            onClick={() => deleteDday(d)}
                            aria-label={`${d.subj} D-day 삭제`}
                            title="삭제"
                            style={{
                              width: 24, height: 24, borderRadius: 8, border: "1px solid var(--color-border-soft)",
                              background: "var(--color-card)", color: "var(--color-muted)", cursor: "pointer", fontSize: 15,
                              lineHeight: "22px", padding: 0,
                            }}
                          >×</button>
                        </div>
                      </div>
                    );
                  })}
                  {sortedDdays.length > 3 && (
                    <button onClick={() => setShowAllDdays(!showAllDdays)} style={{
                      marginTop: 10, padding: "6px 0", width: "100%", background: "none",
                      border: "none", color: PINK, fontSize: 13, cursor: "pointer", fontWeight: 500
                    }}>{showAllDdays ? "접기" : `더보기 (${sortedDdays.length - 3}개)`}</button>
                  )}
                </>
              )}
            </Card>

            {/* 오늘의 학습계획 */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>오늘의 학습계획</h3>
                <button
                  type="button"
                  onClick={() => navigate(pageRoutes["학습 캘린더"])}
                  aria-label="학습 캘린더 열기"
                  title="학습 캘린더"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-border-soft)",
                    background: "var(--color-card)", color: "var(--color-text-secondary)", cursor: "pointer", padding: 0,
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                  </svg>
                </button>
              </div>
              {studyPlanMessage ? (
                <p style={{ margin: "0 0 12px", color: "var(--color-text)", fontSize: 13, lineHeight: 1.6 }}>{studyPlanMessage}</p>
              ) : (
                <p style={{ margin: "0 0 12px", color: "var(--color-muted)", fontSize: 13, lineHeight: 1.6 }}>
                  D-day와 미완료 항목을 보고 오늘 할 일을 자동으로 쪼개드릴게요.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: showStudyPlanOptions ? 8 : 14 }}>
                <div style={{ display: "flex", gap: 4, minWidth: 0, flex: 1 }}>
                  <button
                    type="button"
                    onClick={() => openPlanSourcePicker(plans.length ? "reroll" : "balanced")}
                    disabled={!canGenerateStudyPlan || studyPlanLoading}
                    style={{
                      flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
                      border: `1px solid ${!canGenerateStudyPlan || studyPlanLoading ? "var(--color-border-soft)" : CYAN}`,
                      background: "var(--color-card)",
                      color: !canGenerateStudyPlan || studyPlanLoading ? "var(--color-muted)" : CYAN,
                      cursor: !canGenerateStudyPlan || studyPlanLoading ? "default" : "pointer",
                      fontSize: 13, fontWeight: 800,
                    }}
                  >
                    {studyPlanLoading ? "생성 중..." : "AI가 짜기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStudyPlanOptions(prev => !prev)}
                    aria-label="AI 계획 옵션 열기"
                    title="AI 계획 옵션"
                    style={{
                      width: 30, flexShrink: 0, borderRadius: 8,
                      border: "1px solid #eaf7fa", background: "var(--color-card)",
                      color: CYAN, cursor: "pointer", fontSize: 13, fontWeight: 800, padding: 0,
                    }}
                  >
                    {showStudyPlanOptions ? "⌃" : "⌄"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddPlan(true)}
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${CYAN}`, background: "var(--color-card)",
                    color: CYAN, cursor: "pointer", fontSize: 13, fontWeight: 800,
                  }}
                >
                  직접 추가하기
                </button>
              </div>
              {showStudyPlanOptions && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {([
                    { label: "더 가볍게", mode: "lighter" },
                    { label: "더 빡세게", mode: "harder" },
                    { label: "과제 위주", mode: "assignment" },
                    { label: "일정 위주", mode: "event" },
                  ] as const).map(action => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => openPlanSourcePicker(action.mode)}
                      disabled={!canGenerateStudyPlan || studyPlanLoading}
                      style={{
                        padding: "6px 9px", borderRadius: 8, border: "1px solid #f0f0f0",
                        background: !canGenerateStudyPlan || studyPlanLoading ? "var(--color-surface)" : "var(--color-card)",
                        color: !canGenerateStudyPlan || studyPlanLoading ? "var(--color-muted)" : "var(--color-text-secondary)",
                        cursor: !canGenerateStudyPlan || studyPlanLoading ? "default" : "pointer",
                        fontSize: 12, fontWeight: 700,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              {showPlanSourcePicker && (
                <div style={{
                  marginBottom: 14, padding: 12, borderRadius: 12,
                  border: "1px solid #eef7f9", background: "#fbfeff",
                }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.55, color: "var(--color-text)" }}>
                    {planSourceMessage}
                  </p>
                  {([
                    { title: "남아있는 학습계획", sources: carryoverPlanSources },
                    { title: "D-day", sources: ddayPlanSources },
                  ] as const).map(group => (
                    group.sources.length > 0 && (
                      <div key={group.title} style={{ marginBottom: 12 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, color: "var(--color-muted)" }}>{group.title}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {group.sources.map(source => {
                            const selected = selectedPlanSourceKeys.includes(source.key);
                            const accent = source.kind === "carryover" ? "var(--color-text-secondary)" : ddayTypeColors[source.kind].solid;
                            return (
                              <button
                                key={source.key}
                                type="button"
                                onClick={() => togglePlanSource(source.key)}
                                style={{
                                  maxWidth: "100%", padding: "6px 9px", borderRadius: 999,
                                  border: `1px solid ${selected ? accent : "var(--color-border-soft)"}`,
                                  background: selected ? (source.kind === "carryover" ? "var(--color-surface)" : ddayTypeColors[source.kind].soft) : "var(--color-card)",
                                  color: selected ? accent : "var(--color-text-secondary)",
                                  cursor: "pointer", fontSize: 12, fontWeight: selected ? 800 : 650,
                                  textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}
                              >
                                {selected ? "✓ " : ""}{source.label} {source.meta}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )
                  ))}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => setShowPlanSourcePicker(false)}
                      style={{
                        padding: "7px 11px", borderRadius: 8, border: "1px solid var(--color-border-soft)",
                        background: "var(--color-card)", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 750,
                      }}
                    >취소</button>
                    <button
                      type="button"
                      onClick={requestStudyPlan}
                      disabled={selectedPlanSources.length === 0 || studyPlanLoading}
                      style={{
                        padding: "7px 11px", borderRadius: 8, border: "none",
                        background: selectedPlanSources.length === 0 || studyPlanLoading ? "var(--color-border-soft)" : CYAN,
                        color: "var(--color-on-brand)",
                        cursor: selectedPlanSources.length === 0 || studyPlanLoading ? "default" : "pointer",
                        fontSize: 12, fontWeight: 800,
                      }}
                    >
                      {studyPlanLoading ? "생성 중..." : "이대로 짜기"}
                    </button>
                  </div>
                </div>
              )}
              {studyPlanError && (
                <p style={{ margin: "0 0 12px", padding: 10, borderRadius: 9, background: "var(--color-tint-pink)", color: "var(--color-danger)", fontSize: 12, lineHeight: 1.5 }}>
                  {studyPlanError}
                </p>
              )}
              {!canGenerateStudyPlan && (
                <p style={{ color: "var(--color-muted)", fontSize: 13, textAlign: "center", padding: "6px 0 12px", margin: 0 }}>
                  먼저 D-day에 과제나 일정을 추가해보세요
                </p>
              )}
              {todayPlanEntries.length === 0 ? (
                <p style={{ color: "var(--color-muted)", fontSize: 13, textAlign: "center", padding: "6px 0", margin: 0 }}>아직 생성된 계획이 없습니다</p>
              ) : (
                <>
                  {todayPlanEntries.map(({ plan: p, index: i }, idx) => {
                    const planKey = p.id || `index-${i}`;
                    const isEditing = editingPlanKey === planKey;
                    const showTopBorder = idx > 0;
                    return (
                      <div key={p.id || `${p.text}-${i}`} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                        borderTop: showTopBorder ? "1px solid #f5f5f5" : "none"
                      }}>
                        <button onClick={() => {
                          setPlans(prev => prev.map((item, index) => index === i ? { ...item, done: !item.done } : item));
                        }} style={{
                          width: 22, height: 22, borderRadius: "50%", border: `2px solid ${p.done ? CYAN : "var(--color-border-soft)"}`,
                          background: p.done ? CYAN : "var(--color-card)", cursor: "pointer", display: "flex",
                          alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0
                        }}>
                          {p.done && <span style={{ color: "var(--color-on-brand)", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✔</span>}
                        </button>
                        {isEditing ? (
                          <input
                            value={editingPlanText}
                            onChange={e => setEditingPlanText(e.target.value)}
                            onBlur={() => finishEditPlan(p, i)}
                            onKeyDown={e => {
                              if (e.key === "Enter") finishEditPlan(p, i);
                              if (e.key === "Escape") {
                                setEditingPlanKey(null);
                                setEditingPlanText("");
                              }
                            }}
                            autoFocus
                            style={{
                              flex: 1, minWidth: 0, padding: "7px 9px", borderRadius: 8,
                              border: `1px solid ${CYAN}`, outline: "none", fontSize: 14,
                              color: "var(--color-text-strong)", boxSizing: "border-box",
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditPlan(p, i)}
                            title="클릭해서 수정"
                            style={{
                              flex: 1, minWidth: 0, border: "none", background: "none",
                              padding: 0, cursor: "text", textAlign: "left", fontSize: 14,
                              color: p.done ? "var(--color-muted)" : "var(--color-text)",
                              textDecoration: p.done ? "line-through" : "none",
                              lineHeight: 1.45, wordBreak: "break-word",
                            }}
                          >
                            {p.text}
                          </button>
                        )}
                        <button
                          onClick={() => deletePlan(p, i)}
                          aria-label={`${p.text} 학습 계획 삭제`}
                          title="삭제"
                          style={{
                            width: 24, height: 24, borderRadius: 8, border: "1px solid var(--color-border-soft)",
                            background: "var(--color-card)", color: "var(--color-muted)", cursor: "pointer", fontSize: 15,
                            lineHeight: "22px", padding: 0, flexShrink: 0,
                          }}
                        >×</button>
                      </div>
                    );
                  })}
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
