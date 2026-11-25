import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useMenubarDisplay } from "../services/menubarSettings";
import { useAuth } from "../AuthContext";
import LoginModal from "../components/LoginModal";
import MiniAccount from "../components/MiniAccount";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { paceDateKey } from "../services/pace";
import { ddayTypeLabels, formatDdayLabel, getDaysLeft, type Dday, type Plan } from "../services/studyPlanner";
import { fetchCourses } from "../services/courses";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import tutorMascot from "../assets/mini/figma-tutor-mascot.png";
import MiniSelect from "../components/MiniSelect";
import "./Mini.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
};

// 메뉴바 팝오버(이슈 104) — 가장 가까운 D-day와 오늘 할 일만 보여주는 작은 창.
export default function Mini() {
  const { user, loading } = useAuth();
  return <MiniScreen key={user?.id ?? null} user={user} loading={loading} />;
}

function MiniScreen({ user, loading }: { user: User | null; loading: boolean }) {
  const [showLogin, setShowLogin] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const native = isTauri();
  const navigate = useNavigate();
  const [ddays, setDdays] = useState<Dday[]>([]);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [question, setQuestion] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [courses, setCourses] = useState<string[] | null>(null);
  const [courseError, setCourseError] = useState("");
  const [course, setCourse] = useState("");
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [materialId, setMaterialId] = useState("");
  const [materialLoading, setMaterialLoading] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [courseRetry, setCourseRetry] = useState(0);
  const [materialRetry, setMaterialRetry] = useState(0);
  const [expandedList, setExpandedList] = useState<"course" | "material" | null>(null);

  useEffect(() => {
    if (!selectorOpen || !user) return;
    let ignore = false;
    fetchCourses().then(items => {
      if (ignore) return;
      setCourses(items.map(item => item.name));
      setCourseError("");
    })
      .catch(() => { if (!ignore) setCourseError("과목을 불러오지 못했어요."); });
    return () => { ignore = true; };
  }, [selectorOpen, user, courseRetry]);

  useEffect(() => {
    if (!course) return;
    let ignore = false;
    loadCourseMaterialsFromServer(course).then(items => { if (!ignore) setMaterials(items); })
      .catch(() => { if (!ignore) setMaterialError("자료를 불러오지 못했어요."); })
      .finally(() => { if (!ignore) setMaterialLoading(false); });
    return () => { ignore = true; };
  }, [course, materialRetry]);

  useEffect(() => {
    if (!user) return;
    let ignore = false;
    Promise.all([loadDashboardState<Dday[]>("ddays", []), loadDashboardState<Plan[]>("plans", [])])
      .then(([nextDdays, nextPlans]) => {
        if (ignore) return;
        setDdays(nextDdays);
        setPlans(nextPlans);
      })
      .catch(error => console.warn("메뉴바 데이터 불러오기 실패", error));
    return () => { ignore = true; };
  }, [user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        window.open("/", "_blank");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const togglePlan = (index: number) => {
    if (!plans) return;
    const next = plans.map((item, i) => (i === index ? { ...item, done: !item.done } : item));
    setPlans(next);
    saveDashboardState("plans", next).catch(console.warn);
  };

  useEffect(() => {
    if (!native) return;

    // 이전 버전의 앱은 크기 변경 명령 없이도 웹 카드의 높이를 표시할 수 있다.
    if (showLogin) {
      void invoke("resize_popover", { height: null }).catch(() => {});
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;
    let lastHeight = 0;
    const resize = () => {
      const height = Math.ceil(stage.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      void invoke("resize_popover", { height }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, [native, showLogin]);

  const today = paceDateKey(new Date());
  const { ddayScope } = useMenubarDisplay();
  const nextDday = ddays
    .map(d => ({ ...d, daysLeft: getDaysLeft(d.date) }))
    .filter(d => d.daysLeft >= 0 && (!native || d.type === "exam" ||
      (ddayScope === "exam-assignment" && (!d.type || d.type === "assignment"))))
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];
  const todayPlans = (plans ?? [])
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => !plan.date || plan.date === today);
  const doneCount = todayPlans.filter(({ plan }) => plan.done).length;
  const selectedMaterial = materials.find(material => material.id === materialId);

  let body;
  if (loading) {
    body = <p className="text-[13px] text-muted">불러오는 중...</p>;
  } else if (!user) {
    body = (
      <>
        <div className="mini-guest-heading">
          <p>Tongkk</p>
          <button type="button" onClick={() => setShowLogin(true)}>로그인</button>
        </div>
        <p>로그인하고 내 학습을 이어가세요.</p>
      </>
    );
  } else {
    body = (
      <>
        <div className={`mini-dday ${nextDday ? "" : "mini-dday-empty"}`}>
          {nextDday ? (
            <>
              <p className="mini-subject">{nextDday.subj}</p>
              <p className="mini-countdown">{formatDdayLabel(nextDday.daysLeft)}</p>
              <p className="mini-date">{ddayTypeLabels[nextDday.type || "assignment"]} · {formatDate(nextDday.date)}</p>
            </>
          ) : <p>다가오는 D-day가 없어요.</p>}
        </div>
        <section className="mini-tasks" aria-label="오늘 할 일">
          <div className="mini-tasks-heading">
            <h2>오늘 할 일</h2>
            {todayPlans.length > 0 && <span>{doneCount}/{todayPlans.length} 완료</span>}
          </div>
          <div className={`mini-task-list ${todayPlans.length ? "mini-task-list-filled" : ""}`}>
            {todayPlans.length === 0 && <p>오늘 할 일이 없어요.</p>}
            {todayPlans.map(({ plan, index }) => (
              <div key={plan.id || index} className={`mini-task ${plan.done ? "mini-task-done" : ""}`}>
                <button type="button" onClick={() => togglePlan(index)} aria-label={plan.done ? "완료 취소" : "완료"} aria-pressed={plan.done} className="mini-task-check">
                  <span aria-hidden="true">{plan.done ? "●" : "○"}</span>
                </button>
                <a href="/" target="_blank" title={plan.text}>{plan.text}</a>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div ref={stageRef} className="mini-stage mini-home-stage" hidden={showLogin}>
        <div className={`mini-card ${user ? "" : "mini-card-guest"}`}>
          {user && <MiniAccount user={user} onSwitchAccount={() => setShowLogin(true)} />}
          {body}
          <a href="/" target="_blank" className="mini-open-app">
            <span>Tongkk 창 열기</span><span className="mini-shortcut">⌘O</span>
          </a>
          {user && <form
            className={`mini-question ${selectedMaterial ? "mini-question-selected" : ""}`}
            onSubmit={e => {
              e.preventDefault();
              const q = question.trim();
              if (q) navigate("/mini/tutor", { state: { accountId: user.id, question: q, course: selectedMaterial ? course : "", materialId: selectedMaterial?.id || "" } });
            }}
          >
            <img src={tutorMascot} alt="" className="mini-mascot" />
            <button type="button" aria-expanded={selectorOpen} aria-label={selectedMaterial ? `선택한 자료: ${selectedMaterial.name}` : "자료 선택"} title={selectedMaterial?.name || "자료 선택"} onClick={() => { setSelectorOpen(open => !open); setExpandedList(null); }} className="mini-material-trigger">
              <span>{selectedMaterial?.name || "자료 선택"}</span><span aria-hidden="true">▾</span>
            </button>
            <span className="mini-input-divider" aria-hidden="true" />
            {selectorOpen && (
              <div className="mini-material-panel" role="region" aria-label="자료 선택" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setSelectorOpen(false); } }}>
                <div className="mini-panel-heading"><h2>자료 선택</h2><button type="button" aria-label="자료 선택 닫기" onClick={() => setSelectorOpen(false)}>×</button></div>
                <MiniSelect label="과목" placeholder={courseError ? "과목 불러오기 실패" : courses === null ? "과목 불러오는 중…" : courses.length ? "과목 선택" : "과목이 없어요"} value={course} options={(courses ?? []).map(name => ({ value: name, label: name }))} expanded={expandedList === "course"} onToggle={() => setExpandedList(expandedList === "course" ? null : "course")} onChange={next => {
                  setExpandedList(null);
                  if (next === course) return;
                  setCourse(next);
                  setMaterials([]);
                  setMaterialId("");
                  setMaterialError("");
                  setMaterialLoading(Boolean(next));
                }} />
                {courses !== null && courses.length === 0 && !courseError ? (
                  <div className="mini-panel-empty"><p>아직 등록된 과목이 없어요.</p><a href="/" target="_blank">Tongkk에서 강의 추가하기 ↗</a></div>
                ) : (
                  <MiniSelect label="강의자료" placeholder={!course ? "먼저 과목을 선택하세요" : "강의자료 선택"} value={materialId} options={materials.map(material => ({ value: material.id, label: material.name }))} disabled={!course || materialLoading} expanded={expandedList === "material"} onToggle={() => setExpandedList(expandedList === "material" ? null : "material")} onChange={next => { setMaterialId(next); setSelectorOpen(false); setExpandedList(null); }} />
                )}
                {courseError && <div role="alert" className="mini-panel-error"><p>{courseError}</p><button type="button" className="mini-retry" onClick={() => { setCourseError(""); setCourseRetry(value => value + 1); }}>다시 시도</button></div>}
                {materialLoading && <p className="mini-panel-status">자료를 불러오는 중…</p>}
                {course && !materialLoading && materials.length === 0 && !materialError && <p className="mini-panel-status">이 과목에 업로드된 자료가 없어요.</p>}
                {materialError && <div role="alert" className="mini-panel-error"><p>{materialError}</p><button type="button" className="mini-retry" onClick={() => { setMaterialError(""); setMaterialLoading(true); setMaterialRetry(value => value + 1); }}>다시 시도</button></div>}
              </div>
            )}
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="튜터에게 물어보기…"
              aria-label="튜터에게 물어보기"
              disabled={!user}
              className="mini-question-input"
            />
            <button type="submit" className="mini-question-send" aria-label="질문 보내기" disabled={!question.trim()}>↵</button>
          </form>}
        </div>
      </div>
      {showLogin && <LoginModal compact
        subtitle={user ? "다른 계정으로 학습을 이어가세요." : undefined}
        onClose={() => setShowLogin(false)} />}
    </>
  );
}
