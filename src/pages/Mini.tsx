import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { loadDashboardState, saveDashboardState } from "../services/dashboardState";
import { paceDateKey } from "../services/pace";
import { ddayTypeLabels, formatDdayLabel, getDaysLeft, type Dday, type Plan } from "../services/studyPlanner";
import checkLight from "../assets/mini/check-light.svg";
import checkDark from "../assets/mini/check-dark.svg";
import chevronLight from "../assets/mini/chevron-light.svg";
import chevronDark from "../assets/mini/chevron-dark.svg";
import tutorMascot from "../assets/mini/tutor-mascot.png";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
};

// 메뉴바 팝오버(이슈 104) — 가장 가까운 D-day와 오늘 할 일만 보여주는 작은 창.
export default function Mini() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [ddays, setDdays] = useState<Dday[]>([]);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [question, setQuestion] = useState("");

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

  const today = paceDateKey(new Date());
  const nextDday = ddays
    .map(d => ({ ...d, daysLeft: getDaysLeft(d.date) }))
    .filter(d => d.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];
  const todayPlans = (plans ?? [])
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => !plan.date || plan.date === today);
  const doneCount = todayPlans.filter(({ plan }) => plan.done).length;

  let body;
  if (loading) {
    body = <p className="text-[13px] text-muted">불러오는 중...</p>;
  } else if (!user) {
    body = (
      <p className="text-[13px] text-text">
        <Link to="/auth" target="_blank" className="font-bold text-text-strong underline">로그인</Link>하면 D-day와 오늘 할 일이 보여요.
      </p>
    );
  } else {
    body = (
      <>
        <div className="flex w-full items-end justify-between">
          {nextDday ? (
            <>
              <div className="flex min-w-0 flex-col text-text-strong">
                <p className="truncate text-[13px] font-bold">{nextDday.subj}</p>
                <p className="text-[40px] font-medium leading-tight tracking-[-0.8px]">{formatDdayLabel(nextDday.daysLeft)}</p>
              </div>
              <p className="shrink-0 pb-2 text-[11px] text-muted">
                {ddayTypeLabels[nextDday.type || "assignment"]} · {formatDate(nextDday.date)}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted">다가오는 D-day가 없어요.</p>
          )}
        </div>
        <div className="h-px w-full bg-border" />
        <div className="flex w-full justify-between text-[12px] text-muted">
          <p className="font-bold">오늘 할 일</p>
          <p>{doneCount}/{todayPlans.length} 완료</p>
        </div>
        <div className="flex w-full flex-col">
          {todayPlans.length === 0 && <p className="px-2 py-[7px] text-[13px] text-muted">오늘 할 일이 없어요.</p>}
          {todayPlans.map(({ plan, index }) => (
            <div key={plan.id || index} className="flex h-8 w-full items-center gap-[10px] rounded-lg px-2 hover:bg-muted-surface">
              <button
                type="button"
                onClick={() => togglePlan(index)}
                aria-label={plan.done ? "완료 취소" : "완료"}
                className="size-4 shrink-0 cursor-pointer border-0 bg-transparent p-0"
              >
                {plan.done ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-cyan text-[10px] font-bold text-on-brand">✔</span>
                ) : (
                  <>
                    <img src={checkLight} alt="" className="block size-4 dark:hidden" />
                    <img src={checkDark} alt="" className="hidden size-4 dark:block" />
                  </>
                )}
              </button>
              <a
                href="/"
                target="_blank"
                className={`flex min-w-0 flex-1 items-center gap-[10px] no-underline ${plan.done ? "opacity-50" : ""}`}
              >
                <span className={`min-w-0 flex-1 truncate text-[13px] text-text ${plan.done ? "line-through" : ""}`}>{plan.text}</span>
                {plan.minutes ? <span className="shrink-0 text-[12px] text-muted">{plan.minutes}분</span> : null}
                <img src={chevronLight} alt="" className="block size-3 shrink-0 dark:hidden" />
                <img src={chevronDark} alt="" className="hidden size-3 shrink-0 dark:block" />
              </a>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center p-6">
      <div className="flex w-[300px] flex-col items-start gap-[10px] overflow-hidden rounded-2xl border border-border bg-card px-4 pt-4 pb-3 shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
        {body}
        <a href="/" target="_blank" className="flex w-full items-center justify-between py-[2px] no-underline">
          <span className="text-[13px] text-text">Tongkk 열기</span>
          <span className="text-[12px] text-muted">⌘O</span>
        </a>
        <form
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-page px-[10px] py-[7px]"
          onSubmit={e => {
            e.preventDefault();
            const q = question.trim();
            if (q) navigate("/mini/tutor", { state: { question: q } });
          }}
        >
          <img src={tutorMascot} alt="" className="size-[15px] shrink-0 object-cover" />
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="튜터에게 물어보기…"
            disabled={!user}
            className="min-w-0 flex-1 border-0 bg-transparent! p-0 text-[13px]! text-text-strong outline-none placeholder:text-muted"
          />
          <span className="shrink-0 text-[12px] text-muted">↵</span>
        </form>
      </div>
    </div>
  );
}
