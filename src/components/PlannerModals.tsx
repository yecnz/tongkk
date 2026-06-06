import { useState, useEffect, useRef, type CSSProperties } from "react";
import { PINK, CYAN, Card } from "../common";
import { loadCourseMaterialsFromServer } from "../services/materials";
import { loadQuizSetsFromServer } from "../services/quizSets";
import type { PacePlan } from "../services/pace";
import {
  ddayTypeLabels,
  ddayTypeColors,
  emptyMetrics,
  computeCourseMetrics,
  getDaysLeft,
  PACE_NO_DDAY_HORIZON_DAYS,
  type Dday,
  type DdayType,
  type PaceBasis,
  type CourseContentMetrics,
} from "../services/studyPlanner";

// 대시보드와 학습 캘린더가 공유하는 모달/달력 컴포넌트 모음.
// (컴포넌트만 export → react-refresh 규칙에 안전)

const MONTH_NAMES = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

export type CalendarMarker = { color: string };
// 날짜 칸 안에 짧게 표시할 칩. 페이스는 tone(상태색), 마감·일정은 color(타입색)로 그린다.
export type CalendarChip = {
  label: string;
  tone?: "done" | "today" | "upcoming" | "overdue";
  color?: { bg: string; fg: string };
  strike?: boolean;
};
// 톤 색: 9px→10px와 함께 대비를 끌어올리고, done(회색·취소선)과 upcoming(슬레이트)을 구분.
const CHIP_TONES: Record<CalendarChip["tone"], { bg: string; fg: string }> = {
  done: { bg: "#edf0f4", fg: "#6b7785" },
  today: { bg: "#E2F6FC", fg: "#0a7491" },
  upcoming: { bg: "#eef1f6", fg: "#475569" },
  overdue: { bg: "#FFEAF2", fg: "#c0397e" },
};
type CustomCalendarProps = {
  value: string;
  onChange: (value: string) => void;
  // dateStr("YYYY-MM-DD") → 그 날 표시할 점들. 있으면 날짜 셀 아래 작은 점으로 렌더.
  markers?: Record<string, CalendarMarker[]>;
  // dateStr → 그 날의 학습 칩. 주어지면 날짜 칸을 "월간 계획표" 모드(큰 칸 + 칩)로 렌더한다.
  eventsByDate?: Record<string, CalendarChip[]>;
  onSelectDate?: (value: string) => void;
};

export const CustomCalendar = ({ value, onChange, markers, eventsByDate, onSelectDate }: CustomCalendarProps) => {
  const planner = Boolean(eventsByDate);
  const today = new Date();
  const initDate = value ? new Date(value + "T00:00:00") : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

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

  // 선택 날짜가 보이는 달 밖이면 그 달로 이동(날짜 선택/오늘 버튼 시에만 — 화살표 탐색은 자유).
  useEffect(() => {
    if (!value) return;
    const d = new Date(value + "T00:00:00");
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }, [value]);

  const offCurrentMonth = viewYear !== today.getFullYear() || viewMonth !== today.getMonth();
  const goToToday = () => {
    const ty = today.getFullYear();
    const tm = today.getMonth();
    setViewYear(ty);
    setViewMonth(tm);
    const td = `${ty}-${String(tm + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    onChange(td);
    onSelectDate?.(td);
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)", borderRadius: 18, padding: "16px 12px", border: "1px solid rgba(255,255,255,0.8)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={prevMonth} aria-label="이전 달" className="tongkk-cal-nav" style={{ border: "none", cursor: "pointer", fontSize: 20, padding: "4px 10px", borderRadius: 8 }}>‹</button>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#222" }}>{viewYear}년 {MONTH_NAMES[viewMonth]}</span>
          {planner && offCurrentMonth && (
            <button type="button" onClick={goToToday} style={{
              border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800,
              color: "#0a7491", background: "#E2F6FC", borderRadius: 999, padding: "2px 9px",
            }}>오늘</button>
          )}
        </span>
        <button onClick={nextMonth} aria-label="다음 달" className="tongkk-cal-nav" style={{ border: "none", cursor: "pointer", fontSize: 20, padding: "4px 10px", borderRadius: 8 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 600, padding: "4px 0",
            color: i === 0 ? "#FF6B6B" : i === 6 ? "#5B9CF6" : "#6b7280" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = Boolean(selected &&
            selected.getFullYear() === viewYear &&
            selected.getMonth() === viewMonth &&
            selected.getDate() === day);
          const isToday =
            today.getFullYear() === viewYear &&
            today.getMonth() === viewMonth &&
            today.getDate() === day;
          const dayMarkers = markers?.[dateStr] ?? [];
          const shownMarkers = dayMarkers.slice(0, 3);
          const extraMarkers = dayMarkers.length - shownMarkers.length;
          const weekdayColor = i % 7 === 0 ? "#FF6B6B" : i % 7 === 6 ? "#5B9CF6" : "#555";

          // 월간 계획표 모드: 큰 칸 + 날짜 위 작은 점(마감/할 일) + 학습 칩.
          if (planner) {
            const chips = eventsByDate?.[dateStr] ?? [];
            const shownChips = chips.slice(0, 2);
            const extraChips = chips.length - shownChips.length;
            return (
              <button key={day} onClick={() => { onChange(dateStr); onSelectDate?.(dateStr); }} className="tongkk-cal-cell" style={{
                width: "100%", minHeight: 62, borderRadius: 10, padding: "4px 4px 5px",
                border: isSelected ? `1.5px solid ${PINK}` : isToday ? "1px solid rgba(0,192,232,0.55)" : "1px solid transparent",
                background: isSelected ? "rgba(240,112,174,0.14)" : "transparent",
                cursor: "pointer", display: "flex", flexDirection: "column",
                alignItems: "stretch", gap: 2, overflow: "hidden", textAlign: "left",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 3, paddingLeft: 1 }}>
                  <span style={{ fontSize: 11, lineHeight: 1, fontWeight: isSelected || isToday ? 800 : 600,
                    color: isSelected ? "#1f2937" : isToday ? "#0a7491" : weekdayColor }}>{day}</span>
                  {dayMarkers.length > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      {shownMarkers.map((marker, mi) => (
                        <span key={mi} style={{ width: 4, height: 4, borderRadius: "50%", background: marker.color }} />
                      ))}
                      {extraMarkers > 0 && (
                        <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, color: "#64748b" }}>+{extraMarkers}</span>
                      )}
                    </span>
                  )}
                </span>
                {shownChips.map((chip, ci) => {
                  const c = chip.color ?? CHIP_TONES[chip.tone ?? "upcoming"];
                  const strike = chip.strike ?? chip.tone === "done";
                  return (
                    <span key={ci} title={chip.label} style={{
                      display: "block", maxWidth: "100%", padding: "1px 4px", borderRadius: 4,
                      background: c.bg, color: c.fg, fontSize: 10, fontWeight: 700, lineHeight: 1.35,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      textDecoration: strike ? "line-through" : "none",
                    }}>{chip.label}</span>
                  );
                })}
                {extraChips > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1.2, color: "#64748b", paddingLeft: 2 }}>+{extraChips}</span>
                )}
              </button>
            );
          }

          return (
            <button key={day} onClick={() => { onChange(dateStr); onSelectDate?.(dateStr); }} style={{
              width: "100%", aspectRatio: "1", borderRadius: "50%",
              border: isSelected ? "none" : isToday ? "1px solid rgba(0,192,232,0.55)" : "none",
              background: isSelected ? PINK : "transparent",
              color: isSelected ? "#fff" : isToday ? "#0a7491" : "#333",
              fontSize: 13, fontWeight: isSelected || isToday ? 700 : 400,
              cursor: "pointer", transition: "background 0.15s",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
            }}>
              <span style={{ lineHeight: 1 }}>{day}</span>
              {dayMarkers.length > 0 && (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, height: 5 }}>
                  {shownMarkers.map((marker, mi) => (
                    <span key={mi} style={{ width: 5, height: 5, borderRadius: "50%", background: isSelected ? "#fff" : marker.color }} />
                  ))}
                  {extraMarkers > 0 && (
                    <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, color: isSelected ? "#fff" : "#94a3b8" }}>+{extraMarkers}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

type AddDdayModalProps = {
  onClose: () => void;
  onAdd: (type: DdayType, subject: string, date: string) => void;
  initialDate?: string;
  initialType?: DdayType;
  initialSubj?: string;
  heading?: string;
  submitLabel?: string;
};

export const AddDdayModal = ({ onClose, onAdd, initialDate = "", initialType = "assignment", initialSubj = "", heading = "D-day 추가", submitLabel = "추가" }: AddDdayModalProps) => {
  const [type, setType] = useState<DdayType>(initialType);
  const [subj, setSubj] = useState(initialSubj);
  const [date, setDate] = useState(initialDate);
  const placeholder = `${ddayTypeLabels[type]}명`;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", borderRadius: 22, padding: 28, boxShadow: "0 8px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.9)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>{heading}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
          {(["assignment", "event", "exam"] as const).map(item => {
            const selected = type === item;
            const color = ddayTypeColors[item];
            return (
              <button
                key={item}
                type="button"
                onClick={() => setType(item)}
                style={{
                  padding: "9px 0",
                  borderRadius: 10,
                  border: selected ? `1px solid ${color.solid}` : "1px solid #e0e0e0",
                  background: selected ? color.soft : "rgba(255,255,255,0.8)",
                  color: selected ? color.solid : "#666",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {ddayTypeLabels[item]}
              </button>
            );
          })}
        </div>
        <input value={subj} onChange={e => setSubj(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, boxSizing: "border-box", marginBottom: 14,
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
          }}>{submitLabel}</button>
        </div>
      </div>
    </div>
  );
};

type AddPlanModalProps = { onClose: () => void; onAdd: (text: string) => void };

export const AddPlanModal = ({ onClose, onAdd }: AddPlanModalProps) => {
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
            fontSize: 14, boxSizing: "border-box", marginBottom: 16
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

type AddPaceModalProps = {
  courses: string[];
  ddays: Dday[];
  onClose: () => void;
  onAdd: (course: string, ddayId: string, totalUnits: number, unitLabel: string, basis: PaceBasis) => void;
};

export const AddPaceModal = ({ courses, ddays, onClose, onAdd }: AddPaceModalProps) => {
  const selectableDdays = [...ddays]
    .filter(dday => Boolean(dday.id))
    .sort((a, b) => getDaysLeft(a.date) - getDaysLeft(b.date));
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
  const rawDaysLeft = connectedDday ? getDaysLeft(connectedDday.date) : null;
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
                      const left = getDaysLeft(dday.date);
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

type EditPaceModalProps = {
  plan: PacePlan;
  ddays: Dday[];
  onClose: () => void;
  onSave: (updates: { ddayId: string; totalUnits: number; doneUnits: number }) => void;
};

export const EditPaceModal = ({ plan, ddays, onClose, onSave }: EditPaceModalProps) => {
  const selectableDdays = [...ddays]
    .filter(dday => Boolean(dday.id))
    .sort((a, b) => getDaysLeft(a.date) - getDaysLeft(b.date));
  const isQuiz = plan.basis === "quiz";
  const unit = plan.unitLabel ?? "개";
  const [ddayId, setDdayId] = useState(plan.ddayId);
  const [total, setTotal] = useState(String(plan.totalUnits));
  const [done, setDone] = useState(String(plan.doneUnits));

  const totalNum = Math.floor(Number(total));
  const totalValid = Number.isFinite(totalNum) && totalNum > 0;
  const doneNum = Math.floor(Number(done || "0"));
  const doneValid = Number.isFinite(doneNum) && doneNum >= 0;
  const canSave = totalValid && doneValid;

  const handleSave = () => {
    if (!canSave) return;
    // 퀴즈 기준은 진행도가 자동 집계라 doneUnits를 보존하고, 그 외엔 총량을 넘지 않게 보정한다.
    const nextDone = isQuiz ? plan.doneUnits : Math.min(doneNum, totalNum);
    onSave({ ddayId, totalUnits: totalNum, doneUnits: nextDone });
    onClose();
  };

  const inputStyle: CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
    fontSize: 14, boxSizing: "border-box", background: "rgba(255,255,255,0.8)",
  };
  const labelStyle: CSSProperties = { display: "block", marginBottom: 6, fontSize: 12, fontWeight: 800, color: "#667085" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", borderRadius: 22, padding: 28, boxShadow: "0 8px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.9)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>페이스 플랜 수정</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#888" }}>{plan.course}</p>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>연결할 D-day</label>
          <select value={ddayId} onChange={e => setDdayId(e.target.value)} style={inputStyle}>
            <option value="">연결 안 함</option>
            {selectableDdays.map(dday => {
              const left = getDaysLeft(dday.date);
              const label = left > 0 ? `D-${left}` : left === 0 ? "D-Day" : `D+${Math.abs(left)}`;
              return <option key={dday.id} value={dday.id}>{dday.subj} · {label} ({dday.date})</option>;
            })}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>총 분량 ({unit})</label>
          <input
            value={total}
            onChange={e => setTotal(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="총 분량"
            aria-label={`총 분량 (${unit})`}
            style={inputStyle}
          />
        </div>

        {isQuiz ? (
          <p style={{ margin: "0 0 14px", fontSize: 12, color: CYAN, fontWeight: 700 }}>
            퀴즈 기준 플랜은 진행도가 퀴즈 응시에서 자동 집계돼요.
          </p>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>완료한 분량 ({unit})</label>
            <input
              value={done}
              onChange={e => setDone(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
              inputMode="numeric"
              placeholder="지금까지 완료한 분량"
              aria-label={`완료한 분량 (${unit})`}
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              padding: "8px 18px", borderRadius: 10, border: "none",
              background: canSave ? PINK : "#d8d8d8", color: "#fff",
              cursor: canSave ? "pointer" : "default", fontSize: 14, fontWeight: 600,
            }}
          >저장</button>
        </div>
      </div>
    </div>
  );
};
