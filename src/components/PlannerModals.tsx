import { useState, useEffect, useRef } from "react";
import { PINK, CYAN, Card } from "../common";
import { loadCourseMaterialsFromServer } from "../services/materials";
import { loadQuizSetsFromServer } from "../services/quizSets";
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
type CustomCalendarProps = {
  value: string;
  onChange: (value: string) => void;
  // dateStr("YYYY-MM-DD") → 그 날 표시할 점들. 있으면 날짜 셀 아래 작은 점으로 렌더.
  markers?: Record<string, CalendarMarker[]>;
  onSelectDate?: (value: string) => void;
};

export const CustomCalendar = ({ value, onChange, markers, onSelectDate }: CustomCalendarProps) => {
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
          const dayMarkers = markers?.[dateStr] ?? [];
          const shownMarkers = dayMarkers.slice(0, 3);
          const extraMarkers = dayMarkers.length - shownMarkers.length;
          return (
            <button key={day} onClick={() => { onChange(dateStr); onSelectDate?.(dateStr); }} style={{
              width: "100%", aspectRatio: "1", borderRadius: "50%", border: "none",
              background: isSelected ? PINK : isToday ? "rgba(240,112,174,0.12)" : "transparent",
              color: isSelected ? "#fff" : isToday ? PINK : "#333",
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
};

export const AddDdayModal = ({ onClose, onAdd, initialDate = "", initialType = "assignment" }: AddDdayModalProps) => {
  const [type, setType] = useState<DdayType>(initialType);
  const [subj, setSubj] = useState("");
  const [date, setDate] = useState(initialDate);
  const title = `${ddayTypeLabels[type]} 추가`;
  const placeholder = `${ddayTypeLabels[type]}명`;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 380, background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", borderRadius: 22, padding: 28, boxShadow: "0 8px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.9)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700 }}>D-day 추가</h3>
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
