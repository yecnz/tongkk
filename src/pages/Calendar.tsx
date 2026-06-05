import { useState, useEffect, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import type { PageRouteLabel } from "../common";
import { useCourses } from "../CourseContext";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { paceDateKey, paceProgressPct, paceRemaining, type PacePlan } from "../services/pace";
import {
  createClientId,
  ddayTypeColors,
  ddayTypeLabels,
  formatDdayLabel,
  getDaysLeft,
  type Dday,
  type DdayType,
  type Plan,
  type PaceBasis,
} from "../services/studyPlanner";
import { CustomCalendar, AddDdayModal, AddPlanModal, AddPaceModal, type CalendarMarker } from "../components/PlannerModals";

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
// 할 일 / 페이스 마감 마커 색(과제=핑크·일정=청록·시험=보라와 구분).
const PLAN_MARKER_COLOR = "#64748b";
const PLAN_DONE_MARKER_COLOR = "#cbd5e1";
const PACE_MARKER_COLOR = "#22C55E";

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
  const [loaded, setLoaded] = useState(false);

  const todayStr = paceDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [showAddDday, setShowAddDday] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showAddPace, setShowAddPace] = useState(false);

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

  // ── 마커: ddays(타입별 색) · plans(날짜 있는 항목) · pace 플랜 마감(연결 dday 날짜) ──
  const markers: Record<string, CalendarMarker[]> = {};
  const pushMarker = (dateStr: string, color: string) => {
    if (!dateStr) return;
    if (!markers[dateStr]) markers[dateStr] = [];
    markers[dateStr].push({ color });
  };
  ddays.forEach(dday => pushMarker(dday.date, ddayTypeColors[dday.type || "assignment"].solid));
  plans.forEach(plan => { if (plan.date) pushMarker(plan.date, plan.done ? PLAN_DONE_MARKER_COLOR : PLAN_MARKER_COLOR); });
  pacePlans.forEach(pace => {
    const dday = ddays.find(item => item.id === pace.ddayId);
    if (dday) pushMarker(dday.date, PACE_MARKER_COLOR);
  });

  // ── 선택한 날 데이터 ── (날짜 없는 plan은 "오늘"로 간주: 하위호환)
  const selectedIsToday = selectedDate === todayStr;
  const dayPlanEntries = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => (plan.date ? plan.date === selectedDate : selectedIsToday));
  const dayDdays = ddays.filter(dday => dday.date === selectedDate);

  // ── 핸들러 ──
  const addDday = (type: DdayType, subj: string, date: string) =>
    setDdays(prev => [...prev, { id: createClientId(), type, subj, date }]);
  const deleteDday = (target: Dday) => setDdays(prev => {
    if (target.id) return prev.filter(item => item.id !== target.id);
    const idx = prev.findIndex(item => item.subj === target.subj && item.date === target.date);
    return idx < 0 ? prev : prev.filter((_, i) => i !== idx);
  });
  const addPlanForSelected = (text: string) =>
    setPlans(prev => [...prev, { id: createClientId(), text, done: false, date: selectedDate }]);
  const togglePlan = (index: number) =>
    setPlans(prev => prev.map((item, i) => (i === index ? { ...item, done: !item.done } : item)));
  const deletePlan = (target: Plan, index: number) =>
    setPlans(prev => prev.filter((item, i) => (target.id ? item.id !== target.id : i !== index)));
  const addPacePlan = (course: string, ddayId: string, totalUnits: number, unitLabel?: string, basis?: PaceBasis) =>
    setPacePlans(prev => [...prev, { id: createClientId(), course, ddayId, totalUnits, doneUnits: 0, createdAt: Date.now(), unitLabel, basis }]);
  const deletePacePlan = (planId: string) => setPacePlans(prev => prev.filter(p => p.id !== planId));

  const addBtnStyle: CSSProperties = {
    border: `1px solid ${CYAN}`, background: "#fff", color: CYAN,
    borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer",
  };
  const deleteBtnStyle: CSSProperties = {
    width: 24, height: 24, borderRadius: 8, border: "1px solid #eeeeee",
    background: "#fff", color: "#bbb", cursor: "pointer", fontSize: 15,
    lineHeight: "22px", padding: 0, flexShrink: 0,
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={(item) => { navigate(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />}
      {showAddDday && <AddDdayModal initialDate={selectedDate} onClose={() => setShowAddDday(false)} onAdd={addDday} />}
      {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={addPlanForSelected} />}
      {showAddPace && <AddPaceModal courses={courses} ddays={ddays} onClose={() => setShowAddPace(false)} onAdd={addPacePlan} />}

      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #f0f0f0" }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 850, color: "#222" }}>학습 캘린더</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#888" }}>D-day · 시험 · 할 일 · 목표(페이스)를 한 화면에서 관리하세요.</p>
        </div>

        <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* 큰 월 달력 + 범례 */}
          <Card style={{ padding: 20 }}>
            <div style={{ maxWidth: 560, margin: "0 auto" }}>
              <CustomCalendar value={selectedDate} onChange={setSelectedDate} markers={markers} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 16 }}>
              {[
                { label: "과제", color: ddayTypeColors.assignment.solid },
                { label: "일정", color: ddayTypeColors.event.solid },
                { label: "시험", color: ddayTypeColors.exam.solid },
                { label: "할 일", color: PLAN_MARKER_COLOR },
                { label: "페이스", color: PACE_MARKER_COLOR },
              ].map(item => (
                <span key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />
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

              {/* 그 날의 할 일 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#444" }}>할 일</span>
                <button type="button" onClick={() => setShowAddPlan(true)} style={addBtnStyle}>+ 추가</button>
              </div>
              {dayPlanEntries.length === 0 ? (
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#bbb", padding: "4px 0" }}>이 날의 할 일이 없습니다</p>
              ) : (
                dayPlanEntries.map(({ plan: p, index: i }, idx) => (
                  <div key={p.id || `${p.text}-${i}`} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                    borderTop: idx > 0 ? "1px solid #f5f5f5" : "none",
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
                ))
              )}

              {/* 그 날의 D-day / 시험 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 8px" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#444" }}>D-day · 시험</span>
                <button type="button" onClick={() => setShowAddDday(true)} style={addBtnStyle}>+ 추가</button>
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
                        <button type="button" onClick={() => deleteDday(d)} aria-label={`${d.subj} 삭제`} title="삭제" style={deleteBtnStyle}>×</button>
                      </div>
                    </div>
                  );
                })
              )}
            </Card>

            {/* 목표(페이스) */}
            <Card style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 850, color: "#222" }}>목표 (페이스)</h3>
                <button type="button" onClick={() => setShowAddPace(true)} style={addBtnStyle}>+ 만들기</button>
              </div>
              {pacePlans.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "#bbb", padding: "4px 0" }}>설정된 페이스 플랜이 없습니다</p>
              ) : (
                pacePlans.map((pace, idx) => {
                  const dday = ddays.find(item => item.id === pace.ddayId);
                  const left = dday ? getDaysLeft(dday.date) : null;
                  const remaining = paceRemaining(pace);
                  const isQuiz = pace.basis === "quiz";
                  const unit = pace.unitLabel ?? "개";
                  return (
                    <div key={pace.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                      borderTop: idx > 0 ? "1px solid #f5f5f5" : "none",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: "#222", wordBreak: "break-word" }}>{pace.course}</span>
                          {left !== null && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#555", background: "#f1f4f8", borderRadius: 999, padding: "1px 7px" }}>
                              {formatDdayLabel(left)}
                            </span>
                          )}
                          {remaining <= 0 && (
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: CYAN, borderRadius: 999, padding: "1px 7px" }}>완료</span>
                          )}
                        </div>
                        {isQuiz ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: CYAN }}>퀴즈에서 자동 집계 · 총 {pace.totalUnits}{unit}</span>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                            <div style={{ flex: 1, height: 5, borderRadius: 999, background: "#eef1f6" }}>
                              <div style={{ height: 5, borderRadius: 999, background: CYAN, width: `${paceProgressPct(pace)}%` }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#777", flexShrink: 0 }}>{pace.doneUnits}/{pace.totalUnits}{unit}</span>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => deletePacePlan(pace.id)}
                        aria-label={`${pace.course} 페이스 플랜 삭제`}
                        title="삭제"
                        style={deleteBtnStyle}
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
