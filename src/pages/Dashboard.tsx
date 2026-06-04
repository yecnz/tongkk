import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import type { PageRouteLabel } from "../common";
import { loadDashboardState, removeDashboardState, saveDashboardState } from "../services/dashboardState";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import { loadSummariesFromServer, type SavedSummary } from "../services/summaries";
import { loadQuizSetsFromServer, type SavedQuizSet } from "../services/quizSets";
import { loadAllQuizAttemptsFromServer, loadQuizAttemptsFromServer, type SavedQuizAttempt } from "../services/quizAttempts";
import { generateStudyPlan, type StudyPlanMode } from "../services/studyPlan";
import {
  isPaceSprint,
  paceCatchUpTarget,
  paceGapDays,
  paceProgressPct,
  paceReadiness,
  paceRecoveryTarget,
  paceRemaining,
  paceStatus,
  paceStreak,
  paceTodayTarget,
  paceWeeklyGoal,
  paceWeekStats,
  readinessTier,
  type PaceLog,
  type PacePlan,
  type PaceStatus,
} from "../services/pace";
import { AITutorDrawer } from "../components/AITutorDrawer";

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
  onAdd: (course: string, ddayId: string, totalUnits: number) => void;
};
type PacerSession = {
  course: string;
  taskLabel: string;
  durationMin: number;
  startedAt: number;
  planId: string;
  creditUnits: number;
  daysLeft: number | null;
  paceStatus: PaceStatus;
};
type PacerStartModalProps = {
  defaultCourse: string;
  defaultTask: string;
  onClose: () => void;
  onStart: (taskLabel: string, durationMin: number) => void;
};
type PacerOverlayProps = {
  session: PacerSession;
  helpOpen: boolean;
  onStuck: () => void;
  onCredit: () => void;
  onClose: () => void;
  onAbandon: () => void;
  onRestart: () => void;
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
const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const BUDGET_OPTIONS = [10, 30, 60, 120] as const;
const FULL_DAY_BUDGET = 120;
// 시간 예산에 맞춰 오늘치 분량을 리사이즈 (10분 이하는 새 학습 빼고 약점 복습만)
const resizeTargetByBudget = (target: number, budget: number) => {
  if (budget <= 10) return 0;
  return Math.max(1, Math.round(target * Math.min(budget / FULL_DAY_BUDGET, 1)));
};
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

const AddPaceModal = ({ courses, ddays, onClose, onAdd }: AddPaceModalProps) => {
  const selectableDdays = ddays.filter(dday => Boolean(dday.id));
  const [course, setCourse] = useState(courses[0] ?? "");
  const [ddayId, setDdayId] = useState("");
  const [units, setUnits] = useState("");
  const total = Math.floor(Number(units));
  const canAdd = Boolean(course) && Number.isFinite(total) && total > 0;
  const unitPresets = [30, 60, 120] as const;
  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(course, ddayId, total);
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
                    {selectableDdays.map(dday => (
                      <option key={dday.id} value={dday.id}>{dday.subj} ({dday.date})</option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-[10px] border border-dashed border-border bg-slate-50 px-3.5 py-3 text-sm text-muted dark:bg-slate-800/60">
                    D-day 없이 14일 기준 페이스로 시작합니다.
                  </div>
                )}
              </div>
              <div className="mb-3">
                <label className={labelClass}>총 분량 (개)</label>
                <input
                  value={units}
                  onChange={e => setUnits(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                  inputMode="numeric"
                  placeholder="전체 학습량을 숫자로 입력 (예: 120)"
                  className={fieldClass}
                />
              </div>
              <div className="mb-5 grid grid-cols-3 gap-2">
                {unitPresets.map(preset => {
                  const selected = total === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setUnits(String(preset))}
                      className="rounded-[10px] border border-border bg-white px-3 py-2 text-sm font-bold text-[#667085] cursor-pointer hover:bg-slate-50 aria-pressed:border-cyan aria-pressed:bg-cyan/10 aria-pressed:text-cyan dark:bg-slate-800 dark:text-slate-200"
                    >
                      총 {preset}개
                    </button>
                  );
                })}
              </div>
              <div className="mb-5 flex items-center justify-between rounded-[12px] bg-pink/10 px-4 py-3">
                <span className="text-xs font-bold text-[#667085] dark:text-slate-300">생성할 플랜의 총 학습량</span>
                <span className="text-sm font-extrabold text-pink">{canAdd ? `총 ${total}개` : "총 학습량을 입력하세요"}</span>
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

const PACER_DURATIONS = [15, 25, 50] as const;

// D-day를 연결하지 않은 플랜은 마감일이 없으므로, 남은 분량을 이 기간에 나눠 꾸준히 진행하는 페이스로 계산한다.
const PACE_NO_DDAY_HORIZON_DAYS = 14;

const PacerStartModal = ({ defaultCourse, defaultTask, onClose, onStart }: PacerStartModalProps) => {
  const [task, setTask] = useState(defaultTask);
  const [duration, setDuration] = useState<number>(25);
  const handleStart = () => {
    const label = task.trim() || defaultTask;
    onStart(label, duration);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30">
      <Card className="w-[340px] p-7">
        <h3 className="m-0 mb-1 text-[17px] font-bold text-[#222] dark:text-slate-100">집중 타이머 시작</h3>
        <p className="m-0 mb-4 text-sm text-muted">{defaultCourse} · 정한 시간 동안 학습하고 오늘 목표에 반영해요.</p>
        <label className="block mb-1.5 text-xs font-bold text-muted">할 일</label>
        <input
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="무엇에 집중할까요?"
          className="w-full mb-4 px-3.5 py-2.5 rounded-[10px] border border-border bg-white text-sm text-[#333] outline-none box-border dark:bg-slate-800 dark:text-slate-100"
        />
        <label className="block mb-1.5 text-xs font-bold text-muted">집중 시간</label>
        <div className="flex gap-2 mb-5">
          {PACER_DURATIONS.map(minutes => {
            const selected = duration === minutes;
            return (
              <button
                key={minutes}
                type="button"
                aria-pressed={selected}
                onClick={() => setDuration(minutes)}
                className="flex-1 py-2 rounded-[10px] border border-border text-sm font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 aria-pressed:bg-cyan aria-pressed:text-white aria-pressed:border-cyan"
              >{minutes}분</button>
            );
          })}
        </div>
        <div className="flex gap-2.5 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-[10px] border border-border bg-white text-sm text-[#555] cursor-pointer dark:bg-slate-800 dark:text-slate-200">취소</button>
          <button onClick={handleStart} className="px-4 py-2 rounded-[10px] border-none bg-cyan text-white text-sm font-semibold cursor-pointer hover:brightness-95">시작</button>
        </div>
      </Card>
    </div>
  );
};

const PACER_RING_RADIUS = 96;
const PACER_RING_CIRC = 2 * Math.PI * PACER_RING_RADIUS;

const paceChip: Record<PaceStatus, { label: string; color: string }> = {
  on: { label: "페이스 좋음", color: CYAN },
  slightly: { label: "조금 뒤처짐", color: "#f59e0b" },
  behind: { label: "따라잡는 중", color: PINK },
};

// phase(시작/흐름/막판) × pace(뒤처짐/순항)로 멘트를 고르고, ~1.5분마다 회전시켜 살아있게.
const pacerCoach = (
  secondsLeft: number,
  totalSeconds: number,
  status: PaceStatus,
  creditUnits: number,
): string => {
  if (secondsLeft === 0) return "끝까지 왔어요. 오늘 몫을 해냈어요.";
  const elapsed = totalSeconds - secondsLeft;
  const progress = totalSeconds > 0 ? elapsed / totalSeconds : 0;
  const rotate = Math.floor(elapsed / 90);
  const goal = creditUnits > 0 ? `이 세션이면 오늘 목표 ${creditUnits}개를 끝내요. ` : "";
  let pool: string[];
  if (progress >= 0.7) {
    pool = status === "behind"
      ? ["막판이에요. 여기서 멈추면 밀린 게 그대로예요. 조금만 더!", "거의 다 왔어요. 이 구간만 넘기면 따라잡아요."]
      : ["막판이에요. 여기서 멈추면 아까워요.", "거의 다 왔어요. 끝까지 같은 페이스로."];
  } else if (progress >= 0.15) {
    pool = status === "behind"
      ? [`조금 밀렸지만 흐름 탔어요. ${goal}딴 데 보지 말고 같이 가요.`, "지금 페이스면 충분히 따라잡아요. 계속 가요."]
      : ["페이스 좋아요. 딴 데 보지 말고 이대로.", `좋은 흐름이에요. ${goal}쭉 가요.`];
  } else {
    pool = status === "behind"
      ? [`조금 밀렸어요. 그래도 ${goal}시작이 반이에요.`, "딴 길로 새지 말고 같이 가요."]
      : [`시작이 반이에요. ${goal}같이 가요.`, "자, 집중 모드. 딴 데 보지 말고 가봅시다."];
  }
  return pool[rotate % pool.length];
};

const PacerOverlay = ({ session, helpOpen, onStuck, onCredit, onClose, onAbandon, onRestart }: PacerOverlayProps) => {
  const totalSeconds = session.durationMin * 60;
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [paused, setPaused] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [done, setDone] = useState(false);
  const deadlineRef = useRef(Date.now() + totalSeconds * 1000);
  const creditedRef = useRef(false);

  // 새 세션(한 세션 더)으로 startedAt이 바뀌면 시계를 리셋한다.
  useEffect(() => {
    deadlineRef.current = Date.now() + totalSeconds * 1000;
    creditedRef.current = false;
    setSecondsLeft(totalSeconds);
    setPaused(false);
    setConfirmEnd(false);
    setDone(false);
  }, [session.startedAt, totalSeconds]);

  // 시각 기반 카운트다운 — 백그라운드 탭 throttling/드리프트에도 정확.
  useEffect(() => {
    if (paused || done) return;
    const id = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [paused, done]);

  // 0 도달 → 완료 화면 + 단 한 번만 적립.
  useEffect(() => {
    if (done || secondsLeft > 0) return;
    setDone(true);
    if (!creditedRef.current) {
      creditedRef.current = true;
      onCredit();
    }
  }, [secondsLeft, done, onCredit]);

  // AI 튜터 도움 드로어가 열리면 시계를 자동 정지. 닫아도 자동 재개하지 않고 재개 버튼으로 잇는다.
  useEffect(() => {
    if (helpOpen) setPaused(true);
  }, [helpOpen]);

  // 키보드: Space=일시정지/재개, Esc=끝내기 확인.
  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (helpOpen) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPaused(prev => {
          if (prev) deadlineRef.current = Date.now() + secondsLeft * 1000;
          return !prev;
        });
      } else if (e.code === "Escape") {
        e.preventDefault();
        setConfirmEnd(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, done, secondsLeft]);

  const togglePause = () => {
    setPaused(prev => {
      if (prev) deadlineRef.current = Date.now() + secondsLeft * 1000;
      return !prev;
    });
  };

  const chip = paceChip[session.paceStatus];
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const ringOffset = PACER_RING_CIRC * (1 - (totalSeconds > 0 ? secondsLeft / totalSeconds : 0));
  const coach = paused
    ? "준비되면 다시 이어가요. ‘재개’를 누르세요."
    : pacerCoach(secondsLeft, totalSeconds, session.paceStatus, session.creditUnits);

  const cyanBtn = "px-5 py-2 rounded-xl bg-cyan text-white text-sm font-semibold cursor-pointer hover:brightness-95";
  const slateBtn = "px-5 py-2 rounded-xl bg-slate-200 text-[#444] text-sm font-semibold cursor-pointer hover:brightness-95 dark:bg-slate-700 dark:text-slate-100";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm transition-opacity ${helpOpen ? "z-[180] opacity-60 pointer-events-none" : "z-[200] opacity-100"}`}
    >
      <Card className="w-[min(520px,94vw)] p-8 text-center">
        {done ? (
          <div className="py-6">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cyan/15 text-sm font-extrabold text-cyan">완료</div>
            <p className="m-0 mb-1 text-lg font-bold text-[#222] dark:text-slate-100">잘했어요! 한 구간 완주</p>
            <p className="m-0 mb-6 text-sm text-muted">
              {session.creditUnits > 0 ? `+${session.creditUnits}개 적립 · 오늘 목표 달성` : "복습 한 세션 완료"}
            </p>
            <div className="flex gap-2 justify-center">
              <button type="button" onClick={onRestart} className={cyanBtn}>한 세션 더</button>
              <button type="button" onClick={onClose} className={slateBtn}>닫기</button>
            </div>
          </div>
        ) : confirmEnd ? (
          <div className="py-6">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pink/10 text-xs font-extrabold text-pink">중단</div>
            <p className="m-0 mb-1 text-base font-bold text-[#222] dark:text-slate-100">지금 끝낼까요?</p>
            <p className="m-0 mb-6 text-sm text-muted">아직 시간이 남았어요. 지금 그만두면 이번 세션은 기록되지 않아요.</p>
            <div className="flex gap-2 justify-center">
              <button type="button" onClick={() => setConfirmEnd(false)} className={cyanBtn}>계속하기</button>
              <button type="button" onClick={onAbandon} className={slateBtn}>그만두기</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-center gap-2 mb-1">
              <span className="text-sm font-semibold text-muted">{session.course}</span>
              {session.daysLeft !== null && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-[#555] dark:bg-slate-700 dark:text-slate-200">
                  {session.daysLeft <= 0 ? "D-DAY" : `D-${session.daysLeft}`}
                </span>
              )}
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: chip.color }}>{chip.label}</span>
            </div>
            <p className="m-0 mb-5 text-sm text-muted">
              {session.creditUnits > 0 ? `이 세션이면 오늘 목표 ${session.creditUnits}개 완료` : "오늘은 약점 복습 세션이에요"}
            </p>

            <div className="relative mx-auto" style={{ width: 240, height: 240 }}>
              <svg width="240" height="240" viewBox="0 0 240 240" className="-rotate-90">
                <circle cx="120" cy="120" r={PACER_RING_RADIUS} fill="none" strokeWidth="12" className="stroke-slate-100 dark:stroke-slate-700" />
                <circle
                  cx="120" cy="120" r={PACER_RING_RADIUS} fill="none" strokeWidth="12" strokeLinecap="round"
                  stroke={chip.color}
                  strokeDasharray={PACER_RING_CIRC}
                  strokeDashoffset={ringOffset}
                  className="transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center" aria-live="off">
                <div className="font-bold tabular-nums leading-none text-[#222] dark:text-slate-100">
                  <span className="text-5xl">{mm}</span><span className="text-2xl text-muted">:{ss}</span>
                </div>
                {paused && <span className="mt-2 text-xs font-bold text-muted">일시정지됨</span>}
              </div>
            </div>

            <p className="mt-5 min-h-[20px] text-sm text-muted" aria-live="polite">{coach}</p>

            <div className="mt-6 flex gap-2 justify-center">
              <button type="button" onClick={togglePause} className={slateBtn}>{paused ? "재개" : "일시정지"}</button>
              <button type="button" onClick={onStuck} className={cyanBtn}>AI 튜터에게 질문</button>
            </div>
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className="mt-4 border-none bg-transparent text-xs font-semibold text-muted cursor-pointer underline-offset-2 hover:underline"
            >세션 끝내기</button>
          </>
        )}
      </Card>
    </div>
  );
};

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
  const [showAddPace, setShowAddPace] = useState(false);
  const [courseScores, setCourseScores] = useState<Record<string, number[]>>({});
  const [paceLog, setPaceLog] = useState<PaceLog>({});
  const [paceLogLoaded, setPaceLogLoaded] = useState(false);
  const [appliedCatchUp, setAppliedCatchUp] = useState<Record<string, number>>({});
  const [todayKey] = useState(() => toDateKey(new Date()));
  const [todayBudget, setTodayBudget] = useState<number | null>(null);
  const [todayBudgetLoaded, setTodayBudgetLoaded] = useState(false);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [pacerSession, setPacerSession] = useState<PacerSession | null>(null);
  const [showPacerStart, setShowPacerStart] = useState(false);
  const [pacerStuckOpen, setPacerStuckOpen] = useState(false);

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

  // P5: 전체 퀴즈 응시 점수를 코스별 최신순 배열로 모아 준비도 계산에 사용
  useEffect(() => {
    let ignore = false;
    loadAllQuizAttemptsFromServer()
      .then(attempts => {
        if (ignore) return;
        const byCourse: Record<string, number[]> = {};
        attempts.forEach(attempt => {
          (byCourse[attempt.courseName] ??= []).push(attempt.scorePercent);
        });
        setCourseScores(byCourse);
      })
      .catch(error => console.warn("퀴즈 점수 불러오기 실패", error));
    return () => { ignore = true; };
  }, []);

  // P7/P8: 일별 학습 기록 로드·저장
  useEffect(() => {
    let ignore = false;
    loadDashboardState<PaceLog>("paceLog", {})
      .then(next => {
        if (ignore) return;
        setPaceLog(next);
        setPaceLogLoaded(true);
      })
      .catch(error => console.warn("학습 기록 불러오기 실패", error));
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!paceLogLoaded) return;
    saveDashboardState("paceLog", paceLog).catch(console.warn);
  }, [paceLogLoaded, paceLog]);

  useEffect(() => {
    let ignore = false;
    loadDashboardState<number | null>(`todayBudget:${todayKey}`, null)
      .then(next => {
        if (ignore) return;
        setTodayBudget(next);
        setTodayBudgetLoaded(true);
      })
      .catch(error => console.warn("오늘 예산 불러오기 실패", error));
    return () => { ignore = true; };
  }, [todayKey]);

  useEffect(() => {
    if (!todayBudgetLoaded) return;
    if (todayBudget === null) {
      removeDashboardState(`todayBudget:${todayKey}`).catch(console.warn);
    } else {
      saveDashboardState(`todayBudget:${todayKey}`, todayBudget).catch(console.warn);
    }
  }, [todayBudgetLoaded, todayBudget, todayKey]);

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

  const pacePlanViews = pacePlans
    .map(plan => {
      const dday = ddays.find(item => item.id === plan.ddayId);
      const daysLeft = dday ? getDaysLeft(dday.date) : PACE_NO_DDAY_HORIZON_DAYS;
      const baseTarget = paceTodayTarget(plan, daysLeft);
      const override = appliedCatchUp[plan.id];
      const budgetTarget = todayBudget === null ? undefined : resizeTargetByBudget(baseTarget, todayBudget);
      const status: PaceStatus = dday ? paceStatus(plan, dday.date) : "on";
      const readiness = paceReadiness(plan, courseScores[plan.course] ?? []);
      return {
        plan,
        dday,
        daysLeft,
        status,
        remaining: paceRemaining(plan),
        baseTarget,
        todayTarget: override ?? budgetTarget ?? baseTarget,
        reviewOnly: override === undefined && budgetTarget === 0,
        catchUpTarget: dday ? paceCatchUpTarget(plan, dday.date, daysLeft) : baseTarget,
        catchUpApplied: override !== undefined,
        progress: paceProgressPct(plan),
        readiness,
        readinessTier: readinessTier(readiness),
        hasScores: (courseScores[plan.course] ?? []).length > 0,
        sprint: dday ? isPaceSprint(daysLeft) : false,
      };
    });
  const activePaceViews = pacePlanViews.filter(view => view.remaining > 0);
  const statusRank: Record<PaceStatus, number> = { behind: 0, slightly: 1, on: 2 };
  const stepView = [...activePaceViews]
    .sort((a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      a.daysLeft - b.daysLeft ||
      a.progress - b.progress
    )[0] ?? null;

  const addPacePlan = (course: string, ddayId: string, totalUnits: number) => {
    setPacePlans(prev => [
      ...prev,
      { id: createClientId(), course, ddayId, totalUnits, doneUnits: 0, createdAt: Date.now() },
    ]);
  };

  const clearCatchUp = (planId: string) => {
    setAppliedCatchUp(prev => {
      if (!(planId in prev)) return prev;
      const next = { ...prev };
      delete next[planId];
      return next;
    });
  };

  const completePaceStep = (planId: string, amount: number) => {
    let creditedUnits = 0;
    setPacePlans(prev => prev.map(plan => {
      if (plan.id !== planId) return plan;
      const nextDone = Math.min(plan.totalUnits, plan.doneUnits + amount);
      creditedUnits = nextDone - plan.doneUnits;
      return { ...plan, doneUnits: nextDone, lastActivityAt: Date.now() };
    }));
    if (creditedUnits > 0) {
      setPaceLog(prev => ({ ...prev, [todayKey]: (prev[todayKey] ?? 0) + creditedUnits }));
    }
    clearCatchUp(planId);
  };

  const applyCatchUp = (planId: string, amount: number) => {
    setAppliedCatchUp(prev => ({ ...prev, [planId]: amount }));
  };

  const deletePacePlan = (planId: string) => {
    setPacePlans(prev => prev.filter(plan => plan.id !== planId));
    clearCatchUp(planId);
  };

  const budgetPack = todayBudget === null ? null : (() => {
    let remaining = todayBudget;
    let fit = 0;
    incompletePlans
      .map(plan => plan.minutes ?? 30)
      .sort((a, b) => a - b)
      .forEach(minutes => {
        if (remaining - minutes >= 0) {
          remaining -= minutes;
          fit += 1;
        }
      });
    return { fit };
  })();

  const lastActivityAt = pacePlans.reduce<number | undefined>((latest, plan) => {
    if (plan.lastActivityAt === undefined) return latest;
    return latest === undefined ? plan.lastActivityAt : Math.max(latest, plan.lastActivityAt);
  }, undefined);
  const gapDays = paceGapDays(lastActivityAt);
  const showRecovery = !recoveryDismissed && lastActivityAt !== undefined && gapDays >= 2 && stepView !== null;

  // P7/P8: 회복형 스트릭 + 이번 주 회고
  const streak = paceStreak(paceLog);
  const weekStats = paceWeekStats(paceLog);
  const totalRemaining = pacePlanViews.reduce((sum, view) => sum + view.remaining, 0);
  const weeklyGoal = paceWeeklyGoal(weekStats.units, totalRemaining);
  const hasWeeklyActivity = weekStats.units > 0 || weekStats.activeDays > 0;
  const weekPaceBadge = !hasWeeklyActivity
    ? { label: "아직 시작 전", className: "bg-slate-100 text-[#667085] dark:bg-slate-800 dark:text-slate-300" }
    : stepView
      ? { label: streak.days >= 2 ? "좋은 흐름" : "기록 진행 중", className: "bg-cyan/10 text-cyan" }
      : { label: "오늘 목표 완료", className: "bg-pink/10 text-pink" };
  const weekPaceMessage = !hasWeeklyActivity
    ? "오늘의 한 걸음을 완료하면 이번 주 학습량과 연속 학습일이 표시됩니다."
    : streak.restUsed
      ? "어제는 쉬었지만 연속 학습은 유지돼요. 오늘 다시 완료하면 흐름을 이어갈 수 있어요."
      : streak.days === 0
        ? "오늘 목표를 완료하면 이번 주 페이스 기록이 시작됩니다."
        : stepView
          ? "오늘 목표를 완료하면 연속 학습이 이어집니다."
          : "오늘 목표를 모두 완료했어요. 이 흐름을 유지해보세요.";
  const weekGoalMessage = !hasWeeklyActivity
    ? "첫 목표는 오늘 목표 완료부터 시작해요."
    : totalRemaining > 0
      ? `이번 주 흐름을 기준으로 다음 주에는 ${weeklyGoal}개 정도를 목표로 잡아볼 수 있어요.`
      : "";
  const weekActionLabel = stepView
    ? stepView.reviewOnly
      ? "복습 완료하기"
      : `오늘 목표 ${stepView.todayTarget}개 완료하기`
    : "";
  // P5: 시험 준비도 — D-day 연결된 플랜만, 임박 순
  const readinessViews = pacePlanViews
    .filter(view => view.dday)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const applyRecovery = () => {
    if (!stepView) return;
    setAppliedCatchUp(prev => ({
      ...prev,
      [stepView.plan.id]: paceRecoveryTarget(stepView.plan, stepView.daysLeft),
    }));
    setRecoveryDismissed(true);
  };

  const startPacer = (taskLabel: string, durationMin: number) => {
    if (!stepView) return;
    setPacerSession({
      course: stepView.plan.course,
      taskLabel,
      durationMin,
      startedAt: Date.now(),
      planId: stepView.plan.id,
      creditUnits: stepView.todayTarget,
      daysLeft: stepView.dday ? stepView.daysLeft : null,
      paceStatus: stepView.status,
    });
    setPacerStuckOpen(false);
  };

  // 시간을 끝까지 채웠을 때만 적립(완료 화면은 유지). 중단은 적립하지 않는다.
  const creditPacer = () => {
    if (pacerSession) completePaceStep(pacerSession.planId, pacerSession.creditUnits);
  };

  const closePacer = () => {
    setPacerSession(null);
    setPacerStuckOpen(false);
  };

  // "한 세션 더": 현재 페이스 기준으로 새 세션을 다시 띄운다(목표 달성 시 닫기).
  const restartPacer = () => {
    setPacerStuckOpen(false);
    if (stepView) startPacer(pacerSession?.taskLabel ?? stepView.plan.course, pacerSession?.durationMin ?? 25);
    else closePacer();
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
      {showPacerStart && stepView && (
        <PacerStartModal
          defaultCourse={stepView.plan.course}
          defaultTask={stepView.dday?.subj ?? stepView.plan.course}
          onClose={() => setShowPacerStart(false)}
          onStart={startPacer}
        />
      )}
      {pacerSession && (
        <PacerOverlay
          session={pacerSession}
          helpOpen={pacerStuckOpen}
          onStuck={() => setPacerStuckOpen(true)}
          onCredit={creditPacer}
          onClose={closePacer}
          onAbandon={closePacer}
          onRestart={restartPacer}
        />
      )}
      {pacerSession && (
        <AITutorDrawer
          layout="drawer"
          open={pacerStuckOpen}
          onOpenChange={setPacerStuckOpen}
          resetHistory
          contextTitle={`${pacerSession.course} · ${pacerSession.taskLabel}`}
          contextMarkdown={`# ${pacerSession.course} 집중 세션\n\n현재 학습: ${pacerSession.taskLabel}\n\n막힌 부분을 짧고 쉽게 도와줘.`}
          disabledReason="세션 맥락을 불러오지 못했어요."
        />
      )}

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
        {stepView?.sprint && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card bg-pink/10 px-4 py-3 text-sm text-[#234] dark:text-slate-200">
            <span className="font-semibold text-pink">
              {stepView.plan.course} D-{stepView.daysLeft} 막판 스퍼트
            </span>
            <span>새 분량은 멈추고, 틀린 문제 다시 풀고 시험모드로 마지막 점검해요.</span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => navigate("/review")}
                className="rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold text-pink cursor-pointer hover:bg-white"
              >오답 재풀이</button>
              <button
                type="button"
                onClick={() => navigate("/quiz")}
                className="rounded-lg bg-pink px-3 py-1.5 text-sm font-semibold text-white cursor-pointer hover:brightness-95"
              >시험모드</button>
            </div>
          </div>
        )}
        {stepView && !stepView.sprint && (() => {
          const tone = stepView.status === "behind"
            ? "bg-pink/10 text-pink"
            : stepView.status === "slightly"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
              : "bg-cyan/10 text-cyan";
          const ment = stepView.status === "behind"
            ? `조금 더 힘을 내볼까요? 오늘 ${stepView.catchUpTarget}개로 나눠 따라잡을게요.`
            : stepView.status === "slightly"
              ? "오늘 한 걸음만 더 가면 돼요. 조금만 더 힘내봐요!"
              : "지금 속도면 충분해요. 오늘도 꾸준히 가봅시다!";
          return (
            <div className={`mb-5 flex flex-wrap items-center gap-2 rounded-card px-4 py-3 text-sm font-semibold ${tone}`}>
              <span>{ment}</span>
              {stepView.status === "behind" && (
                stepView.catchUpApplied ? (
                  <span className="ml-auto rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold">반영됨</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => applyCatchUp(stepView.plan.id, stepView.catchUpTarget)}
                    className="ml-auto rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold text-pink cursor-pointer hover:bg-white"
                  >적용</button>
                )
              )}
            </div>
          );
        })()}
        {showRecovery && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card bg-cyan/10 px-4 py-3 text-sm text-[#234] dark:text-slate-200">
            <span>{gapDays}일 공백이 있었네요. 몰아서 말고 약한 개념부터 가볍게 다시 시작해요.</span>
            <button
              type="button"
              onClick={applyRecovery}
              className="ml-auto rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold text-cyan cursor-pointer hover:bg-white"
            >복구 플랜 적용</button>
          </div>
        )}
        {pacePlanViews.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-card border border-border bg-card px-4 py-3">
            <span className="text-sm font-semibold text-[#444] dark:text-slate-200">오늘 몇 분 가능해요?</span>
            {BUDGET_OPTIONS.map(minutes => {
              const selected = todayBudget === minutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTodayBudget(selected ? null : minutes)}
                  className="px-3 py-1.5 rounded-full border border-border text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 aria-pressed:bg-pink aria-pressed:text-white aria-pressed:border-pink"
                >{minutes}분</button>
              );
            })}
            {todayBudget !== null && budgetPack && (
              <span className="basis-full mt-1 text-xs text-muted">
                {todayBudget <= 10
                  ? "10분이면 새 학습은 쉬고 약점 복습만 가볍게 가요."
                  : `오늘 예산 ${todayBudget}분 · 학습계획 ${budgetPack.fit}개가 들어가요.`}
              </span>
            )}
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
            {/* 오늘의 한 걸음 */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="m-0 text-base font-bold text-[#222] dark:text-slate-100">오늘의 한 걸음</h3>
                {pacePlanViews.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAddPace(true)}
                    aria-label="페이스 플랜 추가"
                    className="border-none bg-transparent text-pink text-xl leading-none cursor-pointer"
                  >+</button>
                )}
              </div>
              {stepView ? (
                <>
                  <p className="m-0 mb-1 text-sm text-[#555] dark:text-slate-300">
                    {stepView.plan.course}
                    {stepView.dday && ` · ${stepView.dday.subj} · ${formatDdayLabel(stepView.daysLeft)}`}
                  </p>
                  <p className="m-0 mb-3 text-sm font-semibold text-[#333] dark:text-slate-100">
                    {stepView.reviewOnly
                      ? "오늘은 약점 복습만 가볍게 — 새 분량은 쉬어가요."
                      : `오늘 여기까지가 페이스예요: ${stepView.todayTarget}개`}
                  </p>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-2 rounded-full bg-cyan" style={{ width: `${stepView.progress}%` }} />
                  </div>
                  <p className="m-0 mt-2 text-xs text-muted">
                    {stepView.plan.doneUnits} / {stepView.plan.totalUnits}개 ({stepView.progress}%)
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => completePaceStep(stepView.plan.id, stepView.todayTarget)}
                      className="px-4 py-2 rounded-xl bg-pink text-white text-sm font-semibold cursor-pointer hover:brightness-95"
                    >{stepView.reviewOnly ? "복습 완료" : "완료"}</button>
                    <button
                      type="button"
                      onClick={() => setShowPacerStart(true)}
                      className="px-4 py-2 rounded-xl bg-cyan text-white text-sm font-semibold cursor-pointer hover:brightness-95"
                    >집중 타이머</button>
                    <button
                      type="button"
                      onClick={() => deletePacePlan(stepView.plan.id)}
                      className="ml-auto border-none bg-transparent text-xs text-muted cursor-pointer hover:text-pink"
                    >이 플랜 삭제</button>
                  </div>
                </>
              ) : pacePlanViews.length > 0 ? (
                <p className="m-0 py-2 text-center text-sm text-muted">
                  오늘 페이스를 모두 따라잡았어요. 잘하고 있어요!
                </p>
              ) : (
                <div className="rounded-[14px] border border-dashed border-border bg-white px-4 py-4 text-center dark:bg-slate-900/30">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-pink/10 text-base font-extrabold text-pink">
                    +
                  </div>
                  <p className="m-0 text-sm font-bold text-[#333] dark:text-slate-100">아직 페이스 플랜이 없어요</p>
                  <p className="m-0 mt-1 text-sm leading-6 text-muted">
                    D-day와 분량을 묶어 오늘 할 만큼만 나눠볼게요.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                    <div className="rounded-[10px] bg-slate-50 px-3 py-2 dark:bg-slate-800">
                      <span className="block text-[11px] font-bold text-muted">D-day</span>
                      <strong className="mt-0.5 block text-sm text-[#222] dark:text-slate-100">{ddays.length}개</strong>
                    </div>
                    <div className="rounded-[10px] bg-slate-50 px-3 py-2 dark:bg-slate-800">
                      <span className="block text-[11px] font-bold text-muted">강의</span>
                      <strong className="mt-0.5 block text-sm text-[#222] dark:text-slate-100">{courses.length}개</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddPace(true)}
                    className="mt-4 w-full rounded-[10px] bg-pink px-3 py-2.5 text-sm font-extrabold text-white cursor-pointer hover:brightness-95"
                  >페이스 플랜 만들기</button>
                </div>
              )}
            </Card>

            {/* P5. 시험 준비도 */}
            {readinessViews.length > 0 && (
              <Card className="p-5">
                <h3 className="m-0 mb-3 text-base font-bold text-[#222] dark:text-slate-100">시험 준비도</h3>
                <div className="flex flex-col gap-3">
                  {readinessViews.map(view => {
                    const tone = view.readinessTier === "ready"
                      ? "bg-cyan"
                      : view.readinessTier === "soon"
                        ? "bg-amber-400"
                        : "bg-pink";
                    const label = view.readinessTier === "ready"
                      ? "충분해요"
                      : view.readinessTier === "soon"
                        ? "조금만 더"
                        : "더 채워요";
                    return (
                      <div key={view.plan.id}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-[#333] dark:text-slate-100">
                            {view.plan.course}
                            {view.dday && <span className="text-muted"> · D-{view.daysLeft}</span>}
                          </span>
                          <span className="shrink-0 text-sm font-extrabold text-[#222] dark:text-slate-100">{view.readiness}%</span>
                        </div>
                        <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                          <div className={`h-2 rounded-full ${tone}`} style={{ width: `${view.readiness}%` }} />
                        </div>
                        <p className="m-0 mt-1 text-xs text-muted">
                          {label}
                          {!view.hasScores && " · 퀴즈를 풀면 더 정확해져요"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* P7/P8. 이번 주 페이스 + 스트릭 */}
            {pacePlanViews.length > 0 && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="m-0 text-base font-bold text-[#222] dark:text-slate-100">이번 주 페이스</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${weekPaceBadge.className}`}>
                    {weekPaceBadge.label}
                  </span>
                </div>
                {!hasWeeklyActivity ? (
                  <div className="rounded-[14px] border border-dashed border-border bg-white px-4 py-4 text-center dark:bg-slate-900/30">
                    <p className="m-0 text-sm font-bold text-[#333] dark:text-slate-100">아직 이번 주 학습 기록이 없어요</p>
                    <p className="m-0 mt-1 text-sm leading-6 text-muted">{weekPaceMessage}</p>
                    {stepView && stepView.todayTarget > 0 && (
                      <button
                        type="button"
                        onClick={() => completePaceStep(stepView.plan.id, stepView.todayTarget)}
                        className="mt-4 w-full rounded-[10px] bg-pink px-3 py-2.5 text-sm font-extrabold text-white cursor-pointer hover:brightness-95"
                      >
                        {weekActionLabel}
                      </button>
                    )}
                    <p className="m-0 mt-3 text-xs leading-5 text-muted">{weekGoalMessage}</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-[10px] bg-slate-50 px-3 py-2 dark:bg-slate-800">
                        <span className="block text-[11px] font-bold text-muted">이번 주 완료</span>
                        <strong className="mt-0.5 block text-sm text-[#222] dark:text-slate-100">{weekStats.units}개</strong>
                      </div>
                      <div className="rounded-[10px] bg-slate-50 px-3 py-2 dark:bg-slate-800">
                        <span className="block text-[11px] font-bold text-muted">학습한 날</span>
                        <strong className="mt-0.5 block text-sm text-[#222] dark:text-slate-100">{weekStats.activeDays}일</strong>
                      </div>
                      <div className="rounded-[10px] bg-slate-50 px-3 py-2 dark:bg-slate-800">
                        <span className="block text-[11px] font-bold text-muted">연속 학습</span>
                        <strong className="mt-0.5 block text-sm text-[#222] dark:text-slate-100">{streak.days}일</strong>
                      </div>
                    </div>
                    <p className="m-0 mt-3 text-xs leading-5 text-muted">
                      {weekPaceMessage}
                      {weekGoalMessage && ` ${weekGoalMessage}`}
                    </p>
                    {stepView && stepView.todayTarget > 0 && (
                      <button
                        type="button"
                        onClick={() => completePaceStep(stepView.plan.id, stepView.todayTarget)}
                        className="mt-3 w-full rounded-[10px] border border-pink bg-white px-3 py-2 text-sm font-extrabold text-pink cursor-pointer hover:bg-pink/5 dark:bg-slate-900"
                      >
                        {weekActionLabel}
                      </button>
                    )}
                  </>
                )}
              </Card>
            )}

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
