import { useState, useEffect, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import type { PageRouteLabel } from "../common";
import { useCourses } from "../CourseContext";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { buildPaceCalendarEntries, paceDateKey, type PacePlan } from "../services/pace";
import { loadQuizAttemptsFromServer } from "../services/quizAttempts";
import {
  createClientId,
  ddayTypeColors,
  ddayTypeLabels,
  getDaysLeft,
  PACE_NO_DDAY_HORIZON_DAYS,
  type Dday,
  type DdayType,
  type Plan,
  type PaceBasis,
} from "../services/studyPlanner";
import { CustomCalendar, AddDdayModal, AddPlanModal, AddPaceModal, EditPaceModal, type CalendarMarker, type CalendarChip } from "../components/PlannerModals";

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
// 할 일 / 페이스 마감 마커 색(과제=핑크·일정=청록·시험=보라와 구분).
const PLAN_MARKER_COLOR = "#64748b";
const PLAN_DONE_MARKER_COLOR = "#cbd5e1";
// 선택 날짜 패널에서 페이스 항목 상태 라벨/색.
const PACE_STATUS_META: Record<"done" | "today" | "upcoming" | "overdue", { label: string; color: string }> = {
  done: { label: "완료", color: "#6b7785" },
  today: { label: "오늘", color: "#0a7491" },
  upcoming: { label: "예정", color: "#475569" },
  overdue: { label: "밀림", color: "#c0397e" },
};
// 칸 칩 정렬: 급한 상태가 먼저 — 잘릴 때 overdue/today가 done 뒤에 숨지 않도록.
const TONE_RANK: Record<string, number> = { overdue: 0, today: 1, upcoming: 2, done: 3 };

const formatPanelDate = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
};

export default function Calendar() {
  const navigate = useNavigate();
  const { courses } = useCourses();
  const page: PageRouteLabel = "학습 캘린더";
  const [sidebar, setSidebar] = useState(false);

  const [ddays, setDdays] = useState<Dday[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pacePlans, setPacePlans] = useState<PacePlan[]>([]);
  // 퀴즈 기준 페이스의 진행도를 파생 계산하기 위한 과목별 응시 기록 {count, createdAt}.
  const [courseQuizAttempts, setCourseQuizAttempts] = useState<Record<string, { count: number; createdAt: number }[]>>({});
  const [loaded, setLoaded] = useState(false);

  const todayStr = paceDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [showAddDday, setShowAddDday] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showAddPace, setShowAddPace] = useState(false);
  const [editingDday, setEditingDday] = useState<Dday | null>(null);
  const [editingPace, setEditingPace] = useState<PacePlan | null>(null);

  // 대시보드와 동일한 dashboardState 키를 공유. mount 시 load, 변경 시 save.
  // (load는 .then 콜백에서 setState → effect 내 동기 setState 아님)
  useEffect(() => {
    let ignore = false;
    Promise.all([
      loadDashboardState<Dday[]>("ddays", []),
      loadDashboardState<Plan[]>("plans", []),
      loadDashboardState<PacePlan[]>("pacePlans", []),
    ])
      .then(([nextDdays, nextPlans, nextPace]) => {
        if (ignore) return;
        setDdays(nextDdays.map(item => ({ ...item, type: item.type || "assignment" })));
        setPlans(nextPlans);
        setPacePlans(nextPace);
        setLoaded(true);
      })
      .catch(error => console.warn("학습 캘린더 상태 불러오기 실패", error));
    return () => { ignore = true; };
  }, []);

  useEffect(() => { if (loaded) saveDashboardState("ddays", ddays).catch(console.warn); }, [loaded, ddays]);
  useEffect(() => { if (loaded) saveDashboardState("plans", plans).catch(console.warn); }, [loaded, plans]);
  useEffect(() => { if (loaded) saveDashboardState("pacePlans", pacePlans).catch(console.warn); }, [loaded, pacePlans]);

  // 퀴즈 기준 페이스가 있는 과목만 응시 기록을 조회(과목 집합이 바뀔 때만 재조회).
  const paceQuizCoursesKey = JSON.stringify(
    Array.from(new Set(pacePlans.filter(plan => plan.basis === "quiz").map(plan => plan.course))).sort()
  );
  useEffect(() => {
    const paceCourses: string[] = JSON.parse(paceQuizCoursesKey);
    if (paceCourses.length === 0) { setCourseQuizAttempts({}); return; }
    let ignore = false;
    Promise.all(paceCourses.map(async course => {
      const attempts = await loadQuizAttemptsFromServer(course);
      return [course, attempts.map(a => ({ count: a.count, createdAt: a.createdAt }))] as const;
    }))
      .then(entries => { if (!ignore) setCourseQuizAttempts(Object.fromEntries(entries)); })
      .catch(error => console.warn("페이스 퀴즈 진행 불러오기 실패", error));
    return () => { ignore = true; };
  }, [paceQuizCoursesKey]);

  // ── 마커(점): 페이스 + 할 일을 모두 같은 "할 일" 점(회색)으로. 마감·일정(D-day)만 칩. ──
  // (페이스 점은 paceEntriesByDate 계산 이후에 채운다.)
  const markers: Record<string, CalendarMarker[]> = {};
  const pushMarker = (dateStr: string, color: string) => {
    if (!dateStr) return;
    if (!markers[dateStr]) markers[dateStr] = [];
    markers[dateStr].push({ color });
  };

  // ── 선택한 날 데이터 ── (날짜 없는 plan은 "오늘"로 간주: 하위호환)
  const selectedIsToday = selectedDate === todayStr;
  const dayPlanEntries = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => (plan.date ? plan.date === selectedDate : selectedIsToday));
  const dayDdays = ddays.filter(dday => dday.date === selectedDate);

  // ── 페이스: 퀴즈 기준은 응시 수로 진행도 파생 후 날짜별 학습 칩으로 펼친다 ──
  const resolvePaceDone = (plan: PacePlan) => {
    if (plan.basis !== "quiz") return plan.doneUnits;
    const attempts = courseQuizAttempts[plan.course] ?? [];
    const autoDone = attempts.filter(a => a.createdAt >= plan.createdAt).reduce((sum, a) => sum + a.count, 0);
    return Math.min(plan.totalUnits, autoDone);
  };
  const ddayDateById: Record<string, string> = {};
  ddays.forEach(dday => { if (dday.id) ddayDateById[dday.id] = dday.date; });
  const paceEntriesByDate = buildPaceCalendarEntries(
    pacePlans.map(plan => ({ ...plan, doneUnits: resolvePaceDone(plan) })),
    ddayDateById,
    { horizonDays: PACE_NO_DDAY_HORIZON_DAYS },
  );
  const sortByUrgency = <T extends { status: string }>(list: T[]) =>
    [...list].sort((a, b) => (TONE_RANK[a.status] ?? 9) - (TONE_RANK[b.status] ?? 9));
  // 점(마커): 페이스(완료 제외) + 할 일 모두 회색 "할 일" 점으로. 마감·일정은 칩으로.
  Object.entries(paceEntriesByDate).forEach(([date, entries]) => {
    entries.forEach(entry => {
      if (entry.status === "done") return;
      pushMarker(date, PLAN_MARKER_COLOR);
    });
  });
  plans.forEach(plan => { if (plan.date) pushMarker(plan.date, plan.done ? PLAN_DONE_MARKER_COLOR : PLAN_MARKER_COLOR); });
  // 칸 안 칩 = 마감·일정(D-day, 타입색)만.
  const eventsByDate: Record<string, CalendarChip[]> = {};
  ddays.forEach(dday => {
    if (!dday.date) return;
    const type = dday.type || "assignment";
    (eventsByDate[dday.date] ??= []).push({
      label: dday.subj,
      color: { bg: ddayTypeColors[type].soft, fg: ddayTypeColors[type].solid },
    });
  });
  const dayPaceEntries = sortByUrgency(paceEntriesByDate[selectedDate] ?? []);
  const pacePlanById = Object.fromEntries(pacePlans.map(plan => [plan.id, plan] as const));
  // 오늘 이미 반영했는지(lastActivityAt 날짜 == 오늘) — 오늘 칸의 수동 페이스만 체크 가능.
  const isPaceDoneToday = (timestamp?: number) => timestamp !== undefined && paceDateKey(new Date(timestamp)) === todayStr;

  // ── 핸들러 ──
  const addDday = (type: DdayType, subj: string, date: string) =>
    setDdays(prev => [...prev, { id: createClientId(), type, subj, date }]);
  const deleteDday = (target: Dday) => setDdays(prev => {
    if (target.id) return prev.filter(item => item.id !== target.id);
    const idx = prev.findIndex(item => item.subj === target.subj && item.date === target.date);
    return idx < 0 ? prev : prev.filter((_, i) => i !== idx);
  });
  const updateDday = (target: Dday, type: DdayType, subj: string, date: string) =>
    setDdays(prev => prev.map(item => {
      const isTarget = target.id ? item.id === target.id : item.subj === target.subj && item.date === target.date;
      return isTarget ? { ...item, type, subj, date } : item;
    }));
  const addPlanForSelected = (text: string) =>
    setPlans(prev => [...prev, { id: createClientId(), text, done: false, date: selectedDate }]);
  const togglePlan = (index: number) =>
    setPlans(prev => prev.map((item, i) => (i === index ? { ...item, done: !item.done } : item)));
  const deletePlan = (target: Plan, index: number) =>
    setPlans(prev => prev.filter((item, i) => (target.id ? item.id !== target.id : i !== index)));
  const addPacePlan = (course: string, ddayId: string, totalUnits: number, unitLabel?: string, basis?: PaceBasis) =>
    setPacePlans(prev => [...prev, { id: createClientId(), course, ddayId, totalUnits, doneUnits: 0, createdAt: Date.now(), unitLabel, basis }]);
  const deletePacePlan = (planId: string) => setPacePlans(prev => prev.filter(p => p.id !== planId));
  const updatePacePlan = (planId: string, updates: { ddayId: string; totalUnits: number; doneUnits: number }) =>
    setPacePlans(prev => prev.map(p => (p.id === planId ? { ...p, ...updates } : p)));
  // 오늘 분량 체크: 수동 기준 플랜의 진행도를 그날 권장량만큼 올린다(상한 totalUnits).
  const completePaceToday = (planId: string, amount: number) =>
    setPacePlans(prev => prev.map(p => (p.id === planId
      ? { ...p, doneUnits: Math.min(p.totalUnits, p.doneUnits + amount), lastActivityAt: Date.now() }
      : p)));

  const addBtnStyle: CSSProperties = {
    border: `1px solid ${CYAN}`, background: "#fff", color: CYAN,
    borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer",
  };
  const deleteBtnStyle: CSSProperties = {
    width: 24, height: 24, borderRadius: 8, border: "1px solid #eeeeee",
    background: "#fff", color: "#bbb", cursor: "pointer", fontSize: 15,
    lineHeight: "22px", padding: 0, flexShrink: 0,
  };
  const editBtnStyle: CSSProperties = {
    width: 24, height: 24, borderRadius: 8, border: "1px solid #eeeeee",
    background: "#fff", color: "#94a3b8", cursor: "pointer", fontSize: 12,
    lineHeight: "22px", padding: 0, flexShrink: 0,
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={(item) => { navigate(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />}
      {showAddDday && <AddDdayModal initialDate={selectedDate} onClose={() => setShowAddDday(false)} onAdd={addDday} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={addPlanForSelected} />}
      {showAddPace && <AddPaceModal courses={courses} ddays={ddays} onClose={() => setShowAddPace(false)} onAdd={addPacePlan} />}
      {editingDday && (
        <AddDdayModal
          initialDate={editingDday.date}
          initialType={editingDday.type || "assignment"}
          initialSubj={editingDday.subj}
          heading="D-day 수정"
          submitLabel="저장"
          onClose={() => setEditingDday(null)}
          onAdd={(type, subj, date) => updateDday(editingDday, type, subj, date)}
        />
      )}
      {editingPace && (
        <EditPaceModal
          plan={editingPace}
          ddays={ddays}
          onClose={() => setEditingPace(null)}
          onSave={updates => updatePacePlan(editingPace.id, updates)}
        />
      )}

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 850, color: "#222" }}>학습 캘린더</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#888" }}>날짜별 페이스 학습 · D-day · 할 일을 한 화면에서 관리하세요.</p>
        </div>

        <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* 큰 월 달력 + 범례 */}
          <Card style={{ padding: 20 }}>
            <div style={{ maxWidth: 560, margin: "0 auto" }}>
              <CustomCalendar value={selectedDate} onChange={setSelectedDate} markers={markers} eventsByDate={eventsByDate} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 16 }}>
              {[
                { label: "할 일", color: PLAN_MARKER_COLOR, soft: "#eef1f6", shape: "dot" as const },
                { label: "과제", color: ddayTypeColors.assignment.solid, soft: ddayTypeColors.assignment.soft, shape: "chip" as const },
                { label: "일정", color: ddayTypeColors.event.solid, soft: ddayTypeColors.event.soft, shape: "chip" as const },
                { label: "시험", color: ddayTypeColors.exam.solid, soft: ddayTypeColors.exam.soft, shape: "chip" as const },
              ].map(item => (
                <span key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
                  {item.shape === "dot" ? (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />
                  ) : (
                    <span style={{ width: 16, height: 11, borderRadius: 3, background: item.soft, border: `1px solid ${item.color}` }} />
                  )}
                  {item.label}
                </span>
              ))}
            </div>
          </Card>

          {/* 선택한 날 + 목표(페이스) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 850, color: "#222" }}>{formatPanelDate(selectedDate)}</h3>
                {selectedIsToday && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: CYAN, background: "#E8FAFE", borderRadius: 999, padding: "2px 8px" }}>오늘</span>
                )}
              </div>

              {/* 그 날의 할 일: 페이스 분량 + 일반 할 일 (모두 할 일로 통합) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#444" }}>할 일</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => setShowAddPlan(true)} style={addBtnStyle}>+ 할 일</button>
                  <button type="button" onClick={() => setShowAddPace(true)} style={addBtnStyle}>+ 페이스</button>
                </div>
              </div>
              {dayPaceEntries.length === 0 && dayPlanEntries.length === 0 ? (
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#bbb", padding: "4px 0" }}>이 날의 할 일이 없습니다</p>
              ) : (
                <>
                  {dayPaceEntries.map((entry, idx) => {
                    const plan = pacePlanById[entry.planId];
                    const checkedToday = plan ? isPaceDoneToday(plan.lastActivityAt) : false;
                    const done = entry.status === "done" || checkedToday;
                    const canCheck = selectedIsToday && !entry.readOnly && !done && Boolean(plan);
                    const meta = PACE_STATUS_META[done ? "done" : entry.status];
                    return (
                      <div key={`pace-${entry.planId}-${idx}`} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                        borderTop: idx > 0 ? "1px solid #f5f5f5" : "none",
                      }}>
                        {entry.readOnly ? (
                          <span aria-hidden style={{
                            width: 22, height: 22, borderRadius: "50%", border: "2px solid #e6e6e6",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            color: CYAN, fontSize: 12, lineHeight: 1,
                          }}>↻</span>
                        ) : (
                          <button
                            type="button"
                            disabled={!canCheck}
                            onClick={() => { if (canCheck) completePaceToday(entry.planId, entry.units); }}
                            aria-label={`${entry.course} 오늘 분량 완료`}
                            style={{
                              width: 22, height: 22, borderRadius: "50%",
                              border: `2px solid ${done ? CYAN : "#ddd"}`, background: done ? CYAN : "#fff",
                              cursor: canCheck ? "pointer" : "default", display: "flex",
                              alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
                            }}
                          >
                            {done && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✔</span>}
                          </button>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 14, lineHeight: 1.45, wordBreak: "break-word",
                            color: done ? "#bbb" : "#444", textDecoration: done ? "line-through" : "none",
                          }}>{entry.readOnly ? `${entry.course} 퀴즈` : entry.label}</div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: entry.readOnly ? CYAN : meta.color }}>
                            {entry.readOnly ? "퀴즈 자동 집계" : meta.label}
                          </span>
                        </div>
                        {plan && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <button type="button" onClick={() => setEditingPace(plan)} aria-label={`${entry.course} 페이스 수정`} title="수정" style={editBtnStyle}>✎</button>
                            <button type="button" onClick={() => deletePacePlan(entry.planId)} aria-label={`${entry.course} 페이스 삭제`} title="삭제" style={deleteBtnStyle}>×</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {dayPlanEntries.map(({ plan: p, index: i }, idx) => (
                    <div key={p.id || `${p.text}-${i}`} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                      borderTop: (idx > 0 || dayPaceEntries.length > 0) ? "1px solid #f5f5f5" : "none",
                    }}>
                      <button
                        type="button"
                        onClick={() => togglePlan(i)}
                        aria-label={`${p.text} 완료 토글`}
                        style={{
                          width: 22, height: 22, borderRadius: "50%", border: `2px solid ${p.done ? CYAN : "#ddd"}`,
                          background: p.done ? CYAN : "#fff", cursor: "pointer", display: "flex",
                          alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
                        }}
                      >
                        {p.done && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✔</span>}
                      </button>
                      <span style={{
                        flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.45, wordBreak: "break-word",
                        color: p.done ? "#bbb" : "#444", textDecoration: p.done ? "line-through" : "none",
                      }}>{p.text}</span>
                      <button type="button" onClick={() => deletePlan(p, i)} aria-label={`${p.text} 삭제`} title="삭제" style={deleteBtnStyle}>×</button>
                    </div>
                  ))}
                </>
              )}

              {/* 그 날의 마감 / 일정 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 8px" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#444" }}>마감 · 일정</span>
                <button type="button" onClick={() => setShowAddDday(true)} style={addBtnStyle}>+ D-day</button>
              </div>
              {dayDdays.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "#bbb", padding: "4px 0" }}>이 날의 D-day가 없습니다</p>
              ) : (
                dayDdays.map((d, idx) => {
                  const type = d.type || "assignment";
                  const left = getDaysLeft(d.date);
                  return (
                    <div key={d.id || `${d.subj}-${d.date}-${idx}`} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                      padding: "8px 0", borderTop: idx > 0 ? "1px solid #f5f5f5" : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{
                          flexShrink: 0, padding: "3px 7px", borderRadius: 999,
                          background: ddayTypeColors[type].soft, color: ddayTypeColors[type].solid,
                          fontSize: 11, fontWeight: 800,
                        }}>{ddayTypeLabels[type]}</span>
                        <span style={{ fontSize: 14, color: "#333", wordBreak: "break-word" }}>{d.subj}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: left <= 7 ? PINK : CYAN }}>
                          {left > 0 ? `D-${left}` : left === 0 ? "D-Day!" : `D+${Math.abs(left)}`}
                        </span>
                        <button type="button" onClick={() => setEditingDday(d)} aria-label={`${d.subj} 수정`} title="수정" style={editBtnStyle}>✎</button>
                        <button type="button" onClick={() => deleteDday(d)} aria-label={`${d.subj} 삭제`} title="삭제" style={deleteBtnStyle}>×</button>
                      </div>
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
