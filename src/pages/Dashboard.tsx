import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import type { PageRouteLabel } from "../common";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import { loadSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadQuizAttemptsFromServer, type SavedQuizAttempt } from "../services/quizAttempts";
import { generateStudyPlan, type StudyPlanMode } from "../services/studyPlan";
import {
  paceProgressPct,
  paceRemaining,
  paceStatus,
  paceTodayTarget,
  type PacePlan,
  type PaceStatus,
} from "../services/pace";

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
  onOpenMaterial: (material: CourseMaterial) => void;
  onOpenSummary: (summary: SavedSummary) => void;
  onOpenQuiz: (quizSet: SavedQuizSet) => void;
};
type CustomCalendarProps = { value: string; onChange: (value: string) => void };
type DdayType = "assignment" | "event";
type AddDdayModalProps = { onClose: () => void; onAdd: (type: DdayType, subject: string, date: string) => void };
type AddPlanModalProps = { onClose: () => void; onAdd: (text: string) => void };
type AddPaceModalProps = {
  courses: string[];
  ddays: Dday[];
  onClose: () => void;
  onAdd: (course: string, ddayId: string, totalUnits: number, unitLabel: string, basis: PaceBasis) => void;
};
type Dday = { id?: string; type?: DdayType; subj: string; date: string };
type Plan = { id?: string; text: string; done: boolean; minutes?: number; sourceType?: DdayType | "carryover" };
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

const createClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ddayTypeLabels: Record<DdayType, string> = { assignment: "과제", event: "일정" };

const templateLabels: Record<SavedSummary["template"], string> = {
  GENERAL: "일반 요약",
  LECTURE_NOTE: "강의 노트",
  MINDMAP: "마인드맵",
  CHEAT_SHEET: "치트시트",
};

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));

const materialMeta = (material: CourseMaterial) => {
  if (material.pages) return `${material.pages}페이지`;
  if (material.slides) return `${material.slides}슬라이드`;
  return material.type.toUpperCase();
};

const preview = (summary: SavedSummary): string => {
  const { content, template } = summary;
  if (template === "MINDMAP") {
    try {
      const parsed = JSON.parse(content) as { root?: string };
      return parsed.root ? `${parsed.root} 마인드맵` : "마인드맵 요약";
    } catch {
      return "마인드맵 요약";
    }
  }
  return content
    .replace(/^#+\s*/gm, "")
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    .replace(/\|[^\n]*/g, "")
    .replace(/[-=]{2,}/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
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
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
        }}/>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleAdd} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
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
            border: isDuplicate ? "1px solid #E53E3E" : "1px solid #e0e0e0",
            fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: isDuplicate ? 8 : 16
          }}
        />
        {isDuplicate && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "#E53E3E" }}>이미 등록된 강의 이름입니다.</p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleSave} disabled={!canSave} style={{
            padding: "8px 18px", borderRadius: 10, border: "none",
            background: canSave ? PINK : "#ddd", color: "#fff",
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
      <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "#222" }}>강의를 삭제할까요?</h3>
      <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6, color: "#666" }}>
        {course}의 저장된 강의자료, 요약, 퀴즈도 함께 삭제됩니다.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
        <button onClick={() => { onDelete(course); onClose(); }} style={{
          padding: "8px 18px", borderRadius: 10, border: "none",
          background: "#E53E3E", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700
        }}>삭제</button>
      </div>
    </Card>
  </div>
);

const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const DAY_NAMES = ["일","월","화","수","목","금","토"];

const CustomCalendar = ({ value, onChange }: CustomCalendarProps) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const selected = value ? new Date(value + "T00:00:00") : null;
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)", borderRadius: 18, padding: "16px 12px", border: "1px solid rgba(255,255,255,0.8)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#aaa", padding: "4px 10px", borderRadius: 8 }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#222" }}>{viewYear}년 {MONTH_NAMES[viewMonth]}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#aaa", padding: "4px 10px", borderRadius: 8 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 600, padding: "4px 0",
            color: i === 0 ? "#FF6B6B" : i === 6 ? "#5B9CF6" : "#aaa" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = selected &&
            selected.getFullYear() === viewYear &&
            selected.getMonth() === viewMonth &&
            selected.getDate() === day;
          const isToday =
            today.getFullYear() === viewYear &&
            today.getMonth() === viewMonth &&
            today.getDate() === day;
          return (
            <button key={day} onClick={() => onChange(dateStr)} style={{
              width: "100%", aspectRatio: "1", borderRadius: "50%", border: "none",
              background: isSelected ? PINK : isToday ? "rgba(240,112,174,0.12)" : "transparent",
              color: isSelected ? "#fff" : isToday ? PINK : "#333",
              fontSize: 13, fontWeight: isSelected || isToday ? 700 : 400,
              cursor: "pointer", transition: "background 0.15s",
            }}>{day}</button>
          );
        })}
      </div>
    </div>
  );
};

const AddDdayModal = ({ onClose, onAdd }: AddDdayModalProps) => {
  const [type, setType] = useState<DdayType>("assignment");
  const [subj, setSubj] = useState("");
  const [date, setDate] = useState("");
  const title = type === "assignment" ? "과제 추가" : "일정 추가";
  const placeholder = type === "assignment" ? "과제명" : "일정명";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", borderRadius: 22, padding: 28, boxShadow: "0 8px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.9)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>D-day 추가</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {(["assignment", "event"] as const).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              style={{
                padding: "9px 0",
                borderRadius: 10,
                border: type === item ? `1px solid ${PINK}` : "1px solid #e0e0e0",
                background: type === item ? "#FFF0F6" : "rgba(255,255,255,0.8)",
                color: type === item ? PINK : "#666",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {ddayTypeLabels[item]}
            </button>
          ))}
        </div>
        <input value={subj} onChange={e => setSubj(e.target.value)} placeholder={placeholder} aria-label={title} style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 14,
          background: "rgba(255,255,255,0.8)"
        }}/>
        {date && (
          <div style={{ marginBottom: 10, fontSize: 13, color: PINK, fontWeight: 600, textAlign: "center" }}>
            선택된 날짜: {date}
          </div>
        )}
        <CustomCalendar value={date} onChange={setDate} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { if (subj.trim() && date) { onAdd(type, subj.trim(), date); onClose(); }}} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </div>
    </div>
  );
};

const AddPlanModal = ({ onClose, onAdd }: AddPlanModalProps) => {
  const [txt, setTxt] = useState("");
  const handleAdd = () => {
    const planText = txt.trim();
    if (!planText) return;
    onAdd(planText);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 340 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600 }}>학습 계획 추가</h3>
        <input
          value={txt}
          onChange={e => setTxt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          placeholder="학습 계획을 입력하세요"
          autoFocus
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
            fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16
          }}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleAdd} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: CYAN, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>추가</button>
        </div>
      </Card>
    </div>
  );
};

type PaceBasis = "pages" | "quiz" | "materials" | "manual";
type CourseContentMetrics = {
  materialCount: number;
  pageUnits: number;
  pageUnitLabel: "페이지" | "슬라이드";
  quizQuestions: number;
};
const emptyMetrics: CourseContentMetrics = { materialCount: 0, pageUnits: 0, pageUnitLabel: "페이지", quizQuestions: 0 };
// 과목이 이미 보유한 실제 콘텐츠에서 "분량" 후보들을 뽑는다(페이지 합계 우선, 없으면 슬라이드 / 퀴즈 문항 / 자료 개수).
const computeCourseMetrics = (materials: CourseMaterial[], quizSets: SavedQuizSet[]): CourseContentMetrics => {
  const pageSum = materials.reduce((sum, material) => sum + (material.pages ?? 0), 0);
  const slideSum = materials.reduce((sum, material) => sum + (material.slides ?? 0), 0);
  const usePages = pageSum > 0;
  return {
    materialCount: materials.length,
    pageUnits: usePages ? pageSum : slideSum,
    pageUnitLabel: usePages ? "페이지" : "슬라이드",
    quizQuestions: quizSets.reduce((sum, quizSet) => sum + (quizSet.count ?? 0), 0),
  };
};

const AddPaceModal = ({ courses, ddays, onClose, onAdd }: AddPaceModalProps) => {
  const getModalDaysLeft = (dateStr: string) => {
    const target = new Date(dateStr);
    const today = new Date();
    target.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / 86400000);
  };
  const selectableDdays = [...ddays]
    .filter(dday => Boolean(dday.id))
    .sort((a, b) => getModalDaysLeft(a.date) - getModalDaysLeft(b.date));
  const [course, setCourse] = useState(courses[0] ?? "");
  // 기본은 "연결 안 함"(14일 기준). 마감일은 과목과 무관할 수 있어 사용자가 직접 고르게 둔다.
  const [ddayId, setDdayId] = useState("");
  const [basis, setBasis] = useState<PaceBasis>("pages");
  const [manualUnits, setManualUnits] = useState("");
  const [metrics, setMetrics] = useState<CourseContentMetrics>(emptyMetrics);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const metricsCache = useRef<Record<string, CourseContentMetrics>>({});

  // 과목을 고르면 그 과목의 실제 자료·퀴즈 분량을 불러와 기준 후보로 쓴다.
  useEffect(() => {
    if (!course) { setMetrics(emptyMetrics); return; }
    const applyMetrics = (next: CourseContentMetrics) => {
      setMetrics(next);
      // 현재 고른 기준에 값이 없으면 값이 있는 기준으로 똑똑하게 자동 전환.
      setBasis(prev => {
        if (prev === "manual") return prev;
        const value: Record<Exclude<PaceBasis, "manual">, number> = {
          pages: next.pageUnits,
          quiz: next.quizQuestions,
          materials: next.materialCount,
        };
        if (value[prev] > 0) return prev;
        if (next.pageUnits > 0) return "pages";
        if (next.quizQuestions > 0) return "quiz";
        if (next.materialCount > 0) return "materials";
        return "manual";
      });
    };
    const cached = metricsCache.current[course];
    if (cached) { applyMetrics(cached); setMetricsError(""); setMetricsLoading(false); return; }
    let ignore = false;
    setMetricsLoading(true);
    setMetricsError("");
    Promise.all([loadCourseMaterialsFromServer(course), loadQuizSetsFromServer(course)])
      .then(([materials, quizSets]) => {
        if (ignore) return;
        const next = computeCourseMetrics(materials, quizSets);
        metricsCache.current[course] = next;
        applyMetrics(next);
      })
      .catch(err => {
        if (ignore) return;
        setMetricsError(err instanceof Error ? err.message : "강의 콘텐츠를 불러오지 못했어요.");
        setMetrics(emptyMetrics);
        // 콘텐츠를 못 불러오면 비활성 카드만 남으니, 바로 쓸 수 있는 직접 입력으로 폴백.
        setBasis("manual");
      })
      .finally(() => { if (!ignore) setMetricsLoading(false); });
    return () => { ignore = true; };
  }, [course]);

  const basisOptions = [
    { key: "pages" as const, title: "강의자료 분량", value: metrics.pageUnits, unitLabel: metrics.pageUnitLabel, hint: metrics.pageUnits > 0 ? `총 ${metrics.pageUnits}${metrics.pageUnitLabel}` : "페이지 정보 없음" },
    { key: "quiz" as const, title: "퀴즈 문항", value: metrics.quizQuestions, unitLabel: "문항", hint: metrics.quizQuestions > 0 ? `총 ${metrics.quizQuestions}문항` : "저장된 퀴즈 없음" },
    { key: "materials" as const, title: "강의자료 개수", value: metrics.materialCount, unitLabel: "개", hint: metrics.materialCount > 0 ? `${metrics.materialCount}개` : "자료 없음" },
  ];

  const manualTotal = Math.floor(Number(manualUnits));
  const manualValid = Number.isFinite(manualTotal) && manualTotal > 0;
  const activeBasis = basisOptions.find(option => option.key === basis);
  const total = basis === "manual" ? (manualValid ? manualTotal : 0) : (activeBasis?.value ?? 0);
  const unitLabel = basis === "manual" ? "개" : (activeBasis?.unitLabel ?? "개");
  const canAdd = Boolean(course) && total > 0;

  // 하루 권장량 미리보기: 연결된 D-day(없으면 14일 기준)로 총량을 나눠 보여준다.
  const connectedDday = ddayId ? selectableDdays.find(dday => dday.id === ddayId) : undefined;
  const rawDaysLeft = connectedDday ? getModalDaysLeft(connectedDday.date) : null;
  const previewDaysLeft = rawDaysLeft !== null ? Math.max(rawDaysLeft, 1) : PACE_NO_DDAY_HORIZON_DAYS;
  const perDay = total > 0 ? Math.max(1, Math.ceil(total / Math.max(previewDaysLeft, 1))) : 0;
  const previewText = total <= 0
    ? "기준을 선택하면 하루 권장량을 알려드려요."
    : rawDaysLeft === null
      ? `${PACE_NO_DDAY_HORIZON_DAYS}일 기준 → 하루 약 ${perDay}${unitLabel}`
      : rawDaysLeft > 0
        ? `마감까지 ${rawDaysLeft}일 → 하루 약 ${perDay}${unitLabel}`
        : `마감 임박 → 남은 ${total}${unitLabel} 마무리`;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(course, ddayId, total, unitLabel, basis);
    onClose();
  };
  const fieldClass = "w-full px-3.5 py-3 rounded-[10px] border border-border bg-white text-sm text-[#222] outline-none box-border transition focus:border-cyan focus:ring-3 focus:ring-cyan/10 dark:bg-slate-800 dark:text-slate-100";
  const labelClass = "block mb-2 text-xs font-extrabold text-[#667085] dark:text-slate-300";
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 px-4 py-6">
      <Card className="w-[min(430px,100%)] overflow-hidden">
        <div className="border-b border-border bg-white px-6 py-5 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="mb-2 inline-flex rounded-full bg-cyan/10 px-2.5 py-1 text-[11px] font-extrabold text-cyan">
                PACE PLAN
              </span>
              <h3 className="m-0 text-[19px] font-extrabold text-[#222] dark:text-slate-100">페이스 플랜 만들기</h3>
              <p className="m-0 mt-1 text-sm leading-6 text-muted">
                마감일과 분량을 연결해서 오늘 할 양을 계산해요.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="페이스 플랜 닫기"
              className="h-9 w-9 shrink-0 rounded-[10px] border border-border bg-white text-lg leading-none text-muted cursor-pointer hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
            >×</button>
          </div>
        </div>
        <div className="px-6 py-5">
          {courses.length === 0 ? (
            <div className="mb-5 rounded-[12px] border border-border bg-slate-50 px-4 py-4 dark:bg-slate-800/60">
              <p className="m-0 text-sm leading-6 text-muted">
                먼저 강의를 추가하면 분량을 페이스선으로 묶을 수 있어요.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className={labelClass}>과목</label>
                <select value={course} onChange={e => setCourse(e.target.value)} className={fieldClass}>
                  {courses.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <label className={labelClass}>연결할 D-day</label>
                {selectableDdays.length > 0 ? (
                  <select value={ddayId} onChange={e => setDdayId(e.target.value)} className={fieldClass}>
                    <option value="">연결 안 함</option>
                    {selectableDdays.map(dday => {
                      const left = getModalDaysLeft(dday.date);
                      const label = left > 0 ? `D-${left}` : left === 0 ? "D-Day" : `D+${Math.abs(left)}`;
                      return <option key={dday.id} value={dday.id}>{dday.subj} · {label} ({dday.date})</option>;
                    })}
                  </select>
                ) : (
                  <div className="rounded-[10px] border border-dashed border-border bg-slate-50 px-3.5 py-3 text-sm text-muted dark:bg-slate-800/60">
                    D-day 없이 14일 기준 페이스로 시작합니다.
                  </div>
                )}
              </div>
              <div className="mb-4">
                <label className={labelClass}>무엇을 기준으로 끝낼까요?</label>
                {metricsLoading ? (
                  <div className="rounded-[10px] border border-border bg-slate-50 px-3.5 py-4 text-sm text-muted dark:bg-slate-800/60">
                    강의 콘텐츠 분량을 불러오는 중…
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {basisOptions.map(option => {
                      const selected = basis === option.key;
                      const disabled = option.value <= 0;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          aria-pressed={selected}
                          disabled={disabled}
                          onClick={() => setBasis(option.key)}
                          className={`flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3 text-left transition ${
                            disabled
                              ? "border-border bg-slate-50 cursor-default dark:bg-slate-800/40"
                              : selected
                                ? "border-cyan bg-cyan/10 cursor-pointer"
                                : "border-border bg-white cursor-pointer hover:bg-slate-50 dark:bg-slate-800"
                          }`}
                        >
                          <span className={`text-sm font-bold ${disabled ? "text-slate-300 dark:text-slate-600" : selected ? "text-cyan" : "text-[#344054] dark:text-slate-200"}`}>
                            {option.title}
                          </span>
                          <span className={`shrink-0 text-sm font-extrabold ${disabled ? "text-slate-300 dark:text-slate-600" : selected ? "text-cyan" : "text-[#667085] dark:text-slate-300"}`}>
                            {option.hint}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      aria-pressed={basis === "manual"}
                      onClick={() => setBasis("manual")}
                      className={`flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3 text-left transition cursor-pointer ${
                        basis === "manual"
                          ? "border-cyan bg-cyan/10"
                          : "border-border bg-white hover:bg-slate-50 dark:bg-slate-800"
                      }`}
                    >
                      <span className={`text-sm font-bold ${basis === "manual" ? "text-cyan" : "text-[#344054] dark:text-slate-200"}`}>직접 입력</span>
                      <span className="shrink-0 text-xs font-semibold text-muted">숫자로 직접 지정</span>
                    </button>
                  </div>
                )}
                {metricsError && <p className="m-0 mt-2 text-xs text-pink">{metricsError}</p>}
              </div>
              {basis === "manual" && (
                <div className="mb-4">
                  <label className={labelClass}>총 분량 (개)</label>
                  <input
                    value={manualUnits}
                    onChange={e => setManualUnits(e.target.value.replace(/[^0-9]/g, ""))}
                    onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                    inputMode="numeric"
                    placeholder="전체 학습량을 숫자로 입력 (예: 120)"
                    className={fieldClass}
                  />
                </div>
              )}
              <div className="mb-5 flex items-center justify-between gap-3 rounded-[12px] bg-pink/10 px-4 py-3">
                <span className="shrink-0 text-xs font-bold text-[#667085] dark:text-slate-300">하루 권장 학습량</span>
                <span className="text-right text-sm font-extrabold text-pink">{previewText}</span>
              </div>
            </>
          )}
          <div className="flex gap-2.5 justify-end">
            <button onClick={onClose} className="px-4 py-2.5 rounded-[10px] border border-border bg-white text-sm font-bold text-[#555] cursor-pointer hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200">취소</button>
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className={`px-5 py-2.5 rounded-[10px] border-none text-sm font-extrabold text-white ${canAdd ? "bg-pink cursor-pointer hover:brightness-95" : "bg-slate-300 cursor-default"}`}
            >
              만들기
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
};


// D-day를 연결하지 않은 플랜은 마감일이 없으므로, 남은 분량을 이 기간에 나눠 꾸준히 진행하는 페이스로 계산한다.
const PACE_NO_DDAY_HORIZON_DAYS = 14;


const CourseDetailModal = ({
  course,
  initialSection = "materials",
  onClose,
  onGoSummary,
  onGoQuiz,
  onOpenMaterial,
  onOpenSummary,
  onOpenQuiz,
}: CourseDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<CourseDetailSection>(initialSection);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [quizSets, setQuizSets] = useState<SavedQuizSet[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setActiveTab(initialSection);
  }, [initialSection]);

  useEffect(() => {
    let ignore = false;
    const loadCourseDetail = async () => {
      setLoading(true);
      setError("");
      try {
        const [nextMaterials, nextSummaries, nextQuizSets, nextQuizAttempts] = await Promise.all([
          loadCourseMaterialsFromServer(course),
          loadSummariesFromServer(course),
          loadQuizSetsFromServer(course),
          loadQuizAttemptsFromServer(course),
        ]);
        if (ignore) return;
        setMaterials(nextMaterials);
        setSummaries(nextSummaries);
        setQuizSets(nextQuizSets);
        setQuizAttempts(nextQuizAttempts);
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

  const emptyText = loading ? "불러오는 중..." : "아직 기록이 없습니다";
  const tabCount = {
    materials: materials.length,
    summaries: summaries.length,
    quizzes: quizSets.length,
  };
  const tabs: Array<{ key: CourseDetailSection; label: string; accent: string }> = [
    { key: "materials", label: "자료", accent: "#555" },
    { key: "summaries", label: "요약", accent: PINK },
    { key: "quizzes", label: "퀴즈", accent: CYAN },
  ];

  const tabButtonStyle = (tab: CourseDetailSection, accent: string) => {
    const selected = activeTab === tab;
    return {
      padding: "10px 16px",
      borderRadius: 999,
      border: selected ? `1px solid ${accent}` : "1px solid #eeeeee",
      background: selected ? (tab === "quizzes" ? "#E8FAFE" : tab === "summaries" ? "#FFF0F6" : "#f8f8f8") : "#fff",
      color: selected ? accent : "#777",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: selected ? 850 : 700,
    };
  };

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
            <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 850, color: "#222" }}>{course}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#888" }}>탭을 선택해 강의별 자료, 요약, 퀴즈 내역을 확인하세요.</p>
          </div>
          <button onClick={onClose} aria-label="강의 상세 닫기" style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            border: "none",
            background: "#fafafa",
            color: "#999",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: "32px",
            padding: 0,
            flexShrink: 0,
          }}>×</button>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: "#FFF5F5", color: "#E53E3E", fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {tabs.map(tab => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} style={tabButtonStyle(tab.key, tab.accent)}>
              {tab.label} {tabCount[tab.key] > 0 ? tabCount[tab.key] : ""}
            </button>
          ))}
        </div>

        <div style={{ border: "1px solid #eeeeee", borderRadius: 14, background: "#fff", minHeight: 320, padding: 18 }}>
          {activeTab === "materials" && (
            materials.length === 0 ? (
              <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "#aaa" }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {materials.map((material, index) => (
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
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#333", lineHeight: 1.45, wordBreak: "break-word" }}>
                      {material.name}
                    </div>
                    <div style={{ marginTop: 5, fontSize: 12, color: "#999" }}>
                      {materialMeta(material)} · 수정일 {formatDate(material.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}

          {activeTab === "summaries" && (
            summaries.length === 0 ? (
              <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "#aaa" }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {summaries.map((summary, index) => {
                  const sourceMaterials = (summary.materialIds || [])
                    .map(id => materials.find(m => m.id === id))
                    .filter(Boolean) as typeof materials;
                  return (
                  <button
                    key={summary.id || `${summary.template}-${index}`}
                    type="button"
                    onClick={() => onOpenSummary(summary)}
                    style={{
                      width: "100%",
                      padding: "14px 0",
                      border: "none",
                      borderBottom: index < summaries.length - 1 ? "1px solid #f3f3f3" : "none",
                      background: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 850, color: PINK }}>{templateLabels[summary.template]}</span>
                      <span style={{ fontSize: 12, color: "#aaa", flexShrink: 0 }}>생성일 {formatDate(summary.createdAt)}</span>
                    </div>
                    {sourceMaterials.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                        {sourceMaterials.map(m => (
                          <span key={m.id} style={{
                            fontSize: 11,
                            color: "#333",
                            background: "#f2f2f2",
                            border: "1px solid #ddd",
                            borderRadius: 4,
                            padding: "1px 6px",
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>{m.name}</span>
                        ))}
                      </div>
                    )}
                    <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.55, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preview(summary) || "요약 내용 없음"}
                    </p>
                  </button>
                  );
                })}
              </div>
            )
          )}

          {activeTab === "quizzes" && (
            quizSets.length === 0 ? (
              <p style={{ margin: 0, minHeight: 280, display: "grid", placeItems: "center", fontSize: 13, color: "#aaa" }}>{emptyText}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {quizSets.map((quizSet, index) => {
                  const latestAttempt = quizAttempts.find(attempt => attempt.quizSetId === quizSet.id);
                  return (
                    <button
                      key={quizSet.id}
                      type="button"
                      onClick={() => onOpenQuiz(quizSet)}
                      style={{
                        width: "100%",
                        padding: "14px 0",
                        border: "none",
                        borderBottom: index < quizSets.length - 1 ? "1px solid #f3f3f3" : "none",
                        background: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#333", lineHeight: 1.45, wordBreak: "break-word" }}>
                        {quizSet.title}
                      </div>
                      <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "#999" }}>
                          {quizSet.questionType} · {quizSet.difficulty} · {quizSet.count}문항
                        </span>
                        {latestAttempt ? (
                          <span style={{ flexShrink: 0, fontSize: 12, color: latestAttempt.scorePercent < 70 ? PINK : CYAN, fontWeight: 850 }}>
                            최근 점수 {latestAttempt.scorePercent}%
                          </span>
                        ) : (
                          <span style={{ flexShrink: 0, fontSize: 12, color: "#aaa", fontWeight: 800 }}>
                            풀이 전
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onGoSummary} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "#FFF0F6",
            color: PINK,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>자료 요약으로</button>
          <button onClick={onGoQuiz} style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: "#E8FAFE",
            color: CYAN,
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}>퀴즈 생성으로</button>
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
  const [pacePlans, setPacePlans] = useState<PacePlan[]>([]);
  const [pacePlansLoaded, setPacePlansLoaded] = useState(false);
  // 퀴즈 기준 플랜의 진행도를 파생 계산하기 위한 과목별 응시 기록 {count, createdAt}.
  const [courseQuizAttempts, setCourseQuizAttempts] = useState<Record<string, { count: number; createdAt: number }[]>>({});
  const [showAddPace, setShowAddPace] = useState(false);

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
        setPacePlansLoaded(true);
      })
      .catch(error => console.warn("페이스 플랜 불러오기 실패", error));
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!pacePlansLoaded) return;
    saveDashboardState("pacePlans", pacePlans).catch(console.warn);
  }, [pacePlansLoaded, pacePlans]);

  // 퀴즈 기준 플랜이 있는 과목의 응시 기록을 불러와 진행도(자동) 계산에 사용.
  // 과목 집합이 바뀔 때만 재조회하도록 안정 키에 의존(수동 플랜 변경 시 불필요한 재조회 방지).
  const quizCoursesKey = JSON.stringify(
    Array.from(new Set(pacePlans.filter(plan => plan.basis === "quiz").map(plan => plan.course))).sort()
  );
  useEffect(() => {
    const quizCourses: string[] = JSON.parse(quizCoursesKey);
    if (quizCourses.length === 0) { setCourseQuizAttempts({}); return; }
    let ignore = false;
    Promise.all(quizCourses.map(async course => {
      const attempts = await loadQuizAttemptsFromServer(course);
      return [course, attempts.map(attempt => ({ count: attempt.count, createdAt: attempt.createdAt }))] as const;
    }))
      .then(entries => { if (!ignore) setCourseQuizAttempts(Object.fromEntries(entries)); })
      .catch(error => console.warn("페이스 퀴즈 진행 불러오기 실패", error));
    return () => { ignore = true; };
  }, [quizCoursesKey]);


  useEffect(() => {
    if (!openCourseMenu) return;
    const closeMenu = () => setOpenCourseMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openCourseMenu]);

  const getDaysLeft = (dateStr: string) => {
    const t = new Date(dateStr); const n = new Date();
    t.setHours(0,0,0,0); n.setHours(0,0,0,0);
    return Math.ceil((t.getTime() - n.getTime()) / 86400000);
  };

  const sortedDdays = [...ddays].sort((a, b) => getDaysLeft(a.date) - getDaysLeft(b.date));
  const displayDdays = showAllDdays ? sortedDdays : sortedDdays.slice(0, 3);
  const incompletePlans = plans.filter(plan => !plan.done);
  const makeDdaySourceKey = (dday: Dday, index: number) => `dday-${dday.id || `${dday.subj}-${dday.date}-${index}`}`;
  const makePlanSourceKey = (plan: Plan, index: number) => `plan-${plan.id || `${plan.text}-${index}`}`;
  const formatDdayLabel = (daysLeft: number) => daysLeft > 0 ? `D-${daysLeft}` : daysLeft === 0 ? "D-Day" : `D+${Math.abs(daysLeft)}`;
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
    const eventCount = sources.filter(source => source.kind === "event").length;
    const parts = [
      carryoverCount ? `미완료 계획 ${carryoverCount}개` : "",
      assignmentCount ? `가까운 과제 ${assignmentCount}개` : "",
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
    const ddaySources = planSources
      .filter(source => {
        const daysLeft = source.daysLeft ?? 999;
        if (mode === "assignment") return source.kind === "assignment" && daysLeft <= 10;
        if (mode === "event") return source.kind === "event" && daysLeft <= 7;
        if (mode === "lighter") return source.kind === "assignment" ? daysLeft <= 3 : daysLeft <= 1;
        if (mode === "harder") return source.kind === "assignment" ? daysLeft <= 14 : daysLeft <= 2;
        return source.kind === "assignment" ? daysLeft <= 7 : daysLeft <= 1;
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
        .filter((dday): dday is Dday => Boolean(dday));
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
    const autoDone = auto
      ? (courseQuizAttempts[plan.course] ?? [])
          .filter(attempt => attempt.createdAt >= plan.createdAt)
          .reduce((sum, attempt) => sum + attempt.count, 0)
      : 0;
    const doneUnits = auto ? Math.min(plan.totalUnits, autoDone) : plan.doneUnits;
    const view: PacePlan = { ...plan, doneUnits };
    const status: PaceStatus = dday ? paceStatus(view, dday.date) : "on";
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
      todayTarget: paceTodayTarget(view, daysLeft),
    };
  });
  const activePaceViews = pacePlanViews.filter(view => view.remaining > 0);
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

  const addPacePlan = (course: string, ddayId: string, totalUnits: number, unitLabel?: string, basis?: PaceBasis) => {
    setPacePlans(prev => [
      ...prev,
      { id: createClientId(), course, ddayId, totalUnits, doneUnits: 0, createdAt: Date.now(), unitLabel, basis },
    ]);
  };

  const deletePacePlan = (planId: string) => {
    setPacePlans(prev => prev.filter(plan => plan.id !== planId));
  };

  // 수동 기준(페이지·자료·직접) 플랜: 오늘 권장량만큼 진행도를 올린다(상한 totalUnits).
  const completePaceStepManual = (planId: string, amount: number) => {
    setPacePlans(prev => prev.map(plan => {
      if (plan.id !== planId) return plan;
      const nextDone = Math.min(plan.totalUnits, plan.doneUnits + amount);
      return { ...plan, doneUnits: nextDone, lastActivityAt: Date.now() };
    }));
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={(item) => { navigate(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
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
          onOpenMaterial={(material) => {
            navigate(pageRoutes["자료 요약"], {
              state: { selectedCourse: detailCourse, materialId: material.id, viewMaterial: true, fromDashboard: true },
            });
          }}
          onOpenSummary={(summary) => {
            navigate(pageRoutes["자료 요약"], {
              state: {
                selectedCourse: detailCourse,
                summaryId: summary.id,
                summaryTemplate: summary.template,
                summaryContent: summary.content,
                summaryCreatedAt: summary.createdAt,
                materialIds: summary.materialIds || [],
                openSummary: true,
                fromDashboard: true,
              },
            });
          }}
          onOpenQuiz={(quizSet) => {
            navigate(pageRoutes["퀴즈 생성"], {
              state: { course: detailCourse, quizSetId: quizSet.id, openQuiz: true, fromDashboard: true },
            });
          }}
        />
      )}
      {showAddDday && <AddDdayModal onClose={() => setShowAddDday(false)} onAdd={(type, s, d) => setDdays(prev => [...prev, { id: createClientId(), type, subj: s, date: d }])} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={t => setPlans(prev => [...prev, { id: createClientId(), text: t, done: false }])} />}
      {showAddPace && <AddPaceModal courses={courses} ddays={ddays} onClose={() => setShowAddPace(false)} onAdd={addPacePlan} />}

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
        <Card className="mb-5 border border-cyan/30 bg-cyan/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-xl font-extrabold leading-7 text-[#222] dark:text-slate-100">
              공부 시작하기
            </h2>
            <button
              type="button"
              onClick={() => setShowAddPace(true)}
              className="rounded-full border border-pink/40 bg-white px-3 py-1.5 text-xs font-extrabold text-pink cursor-pointer hover:bg-pink/5 dark:bg-slate-900"
            >
              {pacePlanViews.length > 0 ? "페이스 플랜 추가" : "페이스 플랜 만들기"}
            </button>
          </div>
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
        {pacePlanViews.length > 0 && (
          <div className="mb-5 flex flex-col gap-2">
            {pacePlanViews.map(view => {
              const done = view.remaining <= 0;
              return (
                <Card key={view.plan.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-extrabold text-[#222] dark:text-slate-100">{view.plan.course}</span>
                      {view.dday && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-[#555] dark:bg-slate-700 dark:text-slate-200">
                          {formatDdayLabel(view.daysLeft)}
                        </span>
                      )}
                      {done ? (
                        <span className="rounded-full bg-cyan px-2 py-0.5 text-[11px] font-bold text-white">완료</span>
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{ background: view.status === "behind" ? PINK : view.status === "slightly" ? "#f59e0b" : CYAN }}
                        >
                          {view.status === "behind" ? "따라잡는 중" : view.status === "slightly" ? "조금 뒤처짐" : "정상 페이스"}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className="h-1.5 rounded-full bg-cyan" style={{ width: `${view.progress}%` }} />
                      </div>
                      <span className="shrink-0 text-xs font-bold text-muted">{view.doneUnits}/{view.totalUnits}{view.unitLabel}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!done && (
                      <>
                        <span className="text-xs font-bold text-[#344054] dark:text-slate-300">오늘 {view.todayTarget}{view.unitLabel}</span>
                        {view.auto ? (
                          <span className="rounded-[8px] bg-cyan/10 px-2.5 py-1.5 text-xs font-bold text-cyan">퀴즈 풀면 자동</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => completePaceStepManual(view.plan.id, view.todayTarget)}
                            className="rounded-[8px] border border-cyan bg-white px-2.5 py-1.5 text-xs font-extrabold text-cyan cursor-pointer hover:bg-cyan/5 dark:bg-slate-900"
                          >+오늘 완료</button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => deletePacePlan(view.plan.id)}
                      aria-label={`${view.plan.course} 페이스 플랜 삭제`}
                      className="h-7 w-7 shrink-0 rounded-[8px] border border-border bg-white text-muted cursor-pointer hover:bg-slate-50 dark:bg-slate-800"
                    >×</button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
          {/* 강의 목록 카드 그리드 */}
          <div>
            {courses.length === 0 ? (
              <div style={{
                minHeight: 300, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", textAlign: "center", color: "#777",
              }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 850, color: "#222" }}>아직 등록된 강의가 없습니다.</h2>
                <p style={{ margin: "0 0 20px", fontSize: 14, color: "#888" }}>강의를 추가하면 자료, 요약, 퀴즈를 관리할 수 있어요.</p>
                <button onClick={() => setShowAddCourse(true)} style={{
                  padding: "11px 18px", borderRadius: 10, border: "none", background: PINK,
                  color: "#fff", fontSize: 14, fontWeight: 850, cursor: "pointer",
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
                        <h2 style={{ margin: "0 34px 10px 0", fontSize: 17, fontWeight: 850, color: "#222", lineHeight: 1.35, wordBreak: "break-word" }}>
                          {course}
                        </h2>
                        <p style={{ margin: 0, fontSize: 13, color: stats.error ? "#E53E3E" : "#777", fontWeight: 700 }}>
                          {stats.error ? "정보를 불러오지 못했습니다" : statsLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`${course} 관리 메뉴`}
                        onClick={e => { e.stopPropagation(); setOpenCourseMenu(prev => prev === course ? null : course); }}
                        style={{
                          position: "absolute", top: 14, right: 14,
                          width: 30, height: 30, borderRadius: 9, border: "1px solid #eeeeee",
                          background: openCourseMenu === course ? "#fafafa" : "#fff",
                          color: "#999", cursor: "pointer", fontSize: 18, lineHeight: "26px", padding: 0,
                        }}
                      >...</button>
                      {openCourseMenu === course && (
                        <div onClick={e => e.stopPropagation()} style={{
                          position: "absolute", right: 14, top: 48, width: 128, padding: 6,
                          borderRadius: 12, border: "1px solid #eeeeee", background: "#fff",
                          boxShadow: "0 12px 28px rgba(0,0,0,0.12)", zIndex: 20,
                        }}>
                          <button type="button" onClick={() => { setOpenCourseMenu(null); setRenamingCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "#fff", color: "#333", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600 }}>이름 변경</button>
                          <button type="button" onClick={() => { setOpenCourseMenu(null); setDeletingCourse(course); }} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", background: "#fff", color: "#E53E3E", cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 700 }}>삭제</button>
                        </div>
                      )}
                    </Card>
                  );
                })}
                <button onClick={() => setShowAddCourse(true)} style={{
                  minHeight: 120, borderRadius: 18, border: "1px dashed #d8dde8",
                  background: "#fbfcfe", color: PINK, fontSize: 15, fontWeight: 850, cursor: "pointer",
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
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "10px 0" }}>설정된 D-day가 없습니다</p>
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
                            background: type === "assignment" ? "#FFF0F6" : "#E8FAFE",
                            color: type === "assignment" ? PINK : CYAN,
                            fontSize: 11, fontWeight: 800,
                          }}>{ddayTypeLabels[type]}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: "#333", wordBreak: "break-word" }}>{d.subj}</span>
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
                              width: 24, height: 24, borderRadius: 8, border: "1px solid #eeeeee",
                              background: "#fff", color: "#bbb", cursor: "pointer", fontSize: 15,
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
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>오늘의 학습계획</h3>
              </div>
              {studyPlanMessage ? (
                <p style={{ margin: "0 0 12px", color: "#555", fontSize: 13, lineHeight: 1.6 }}>{studyPlanMessage}</p>
              ) : (
                <p style={{ margin: "0 0 12px", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
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
                      border: `1px solid ${!canGenerateStudyPlan || studyPlanLoading ? "#e5e5e5" : CYAN}`,
                      background: "#fff",
                      color: !canGenerateStudyPlan || studyPlanLoading ? "#aaa" : CYAN,
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
                      border: "1px solid #eaf7fa", background: "#fff",
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
                    border: `1px solid ${CYAN}`, background: "#fff",
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
                        background: !canGenerateStudyPlan || studyPlanLoading ? "#f2f2f2" : "#fff",
                        color: !canGenerateStudyPlan || studyPlanLoading ? "#aaa" : "#666",
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
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.55, color: "#555" }}>
                    {planSourceMessage}
                  </p>
                  {([
                    { title: "남아있는 학습계획", sources: carryoverPlanSources },
                    { title: "D-day", sources: ddayPlanSources },
                  ] as const).map(group => (
                    group.sources.length > 0 && (
                      <div key={group.title} style={{ marginBottom: 12 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 850, color: "#999" }}>{group.title}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {group.sources.map(source => {
                            const selected = selectedPlanSourceKeys.includes(source.key);
                            const accent = source.kind === "event" ? CYAN : source.kind === "assignment" ? PINK : "#777";
                            return (
                              <button
                                key={source.key}
                                type="button"
                                onClick={() => togglePlanSource(source.key)}
                                style={{
                                  maxWidth: "100%", padding: "6px 9px", borderRadius: 999,
                                  border: `1px solid ${selected ? accent : "#eeeeee"}`,
                                  background: selected ? (source.kind === "event" ? "#E8FAFE" : source.kind === "assignment" ? "#FFF0F6" : "#f7f7f7") : "#fff",
                                  color: selected ? accent : "#777",
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
                        padding: "7px 11px", borderRadius: 8, border: "1px solid #eeeeee",
                        background: "#fff", color: "#777", cursor: "pointer", fontSize: 12, fontWeight: 750,
                      }}
                    >취소</button>
                    <button
                      type="button"
                      onClick={requestStudyPlan}
                      disabled={selectedPlanSources.length === 0 || studyPlanLoading}
                      style={{
                        padding: "7px 11px", borderRadius: 8, border: "none",
                        background: selectedPlanSources.length === 0 || studyPlanLoading ? "#ddd" : CYAN,
                        color: "#fff",
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
                <p style={{ margin: "0 0 12px", padding: 10, borderRadius: 9, background: "#FFF5F5", color: "#E53E3E", fontSize: 12, lineHeight: 1.5 }}>
                  {studyPlanError}
                </p>
              )}
              {!canGenerateStudyPlan && (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "6px 0 12px", margin: 0 }}>
                  먼저 D-day에 과제나 일정을 추가해보세요
                </p>
              )}
              {plans.length === 0 ? (
                <p style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "6px 0", margin: 0 }}>아직 생성된 계획이 없습니다</p>
              ) : (
                plans.map((p, i) => {
                  const planKey = p.id || `index-${i}`;
                  const isEditing = editingPlanKey === planKey;
                  return (
                    <div key={p.id || `${p.text}-${i}`} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                      borderBottom: i < plans.length - 1 ? "1px solid #f5f5f5" : "none"
                    }}>
                      <button onClick={() => {
                        setPlans(prev => prev.map((item, index) => index === i ? { ...item, done: !item.done } : item));
                      }} style={{
                        width: 22, height: 22, borderRadius: "50%", border: `2px solid ${p.done ? CYAN : "#ddd"}`,
                        background: p.done ? CYAN : "#fff", cursor: "pointer", display: "flex",
                        alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0
                      }}>
                        {p.done && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✔</span>}
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
                            color: "#333", boxSizing: "border-box",
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
                            color: p.done ? "#bbb" : "#444",
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
                          width: 24, height: 24, borderRadius: 8, border: "1px solid #eeeeee",
                          background: "#fff", color: "#bbb", cursor: "pointer", fontSize: 15,
                          lineHeight: "22px", padding: 0, flexShrink: 0,
                        }}
                      >×</button>
                    </div>
                  );
                })
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
