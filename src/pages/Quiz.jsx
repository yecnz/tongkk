import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";

const sampleQuizzes = [
  { id: 1, question: "시간 복잡도 O(n log n)을 가지는 정렬 알고리즘은?", options: ["버블 정렬", "퀵 정렬", "선택 정렬", "삽입 정렬"], answer: 1, explanation: "퀵 정렬의 평균 시간 복잡도는 O(n log n)입니다." },
  { id: 2, question: "스택(Stack)의 특징으로 올바른 것은?", options: ["FIFO 구조", "LIFO 구조", "랜덤 접근 가능", "정렬된 순서 유지"], answer: 1, explanation: "스택은 Last In First Out(LIFO) 구조입니다." },
  { id: 3, question: "이진 탐색의 전제 조건은?", options: ["데이터가 정렬되어 있어야 한다", "데이터가 연결 리스트여야 한다", "데이터가 트리 구조여야 한다", "데이터가 해시 테이블이어야 한다"], answer: 0, explanation: "이진 탐색은 정렬된 배열에서만 사용할 수 있습니다." },
  { id: 4, question: "다익스트라 알고리즘의 주요 용도는?", options: ["문자열 매칭", "최소 신장 트리", "최단 경로 탐색", "위상 정렬"], answer: 2, explanation: "다익스트라 알고리즘은 가중치가 있는 그래프에서 최단 경로를 찾습니다." },
  { id: 5, question: "해시 충돌 해결 방법이 아닌 것은?", options: ["체이닝", "개방 주소법", "이중 해싱", "깊이 우선 탐색"], answer: 3, explanation: "깊이 우선 탐색(DFS)은 그래프 탐색 알고리즘으로, 해시 충돌 해결과 무관합니다." }
];

const Header = ({ label, onOpenSidebar, extra }) => (
  <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <button onClick={onOpenSidebar} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
        <SidebarIcon />
      </button>
      <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
      <span style={{ color: "#bbb", fontSize: 14 }}>/ {label}</span>
    </div>
    {extra}
  </div>
);

export default function Quiz() {
  const navigate = useNavigate();
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [step, setStep] = useState("select");
  const [subject, setSubject] = useState("");
  const [count, setCount] = useState(5);
  const [quizzes, setQuizzes] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [showExplanation, setShowExplanation] = useState(false);

  const generate = () => {
    if (!subject.trim()) return;
    setStep("generating");
    setTimeout(() => {
      setQuizzes(sampleQuizzes.slice(0, count));
      setCurrent(0); setAnswers({}); setStep("quiz");
    }, 2000);
  };

  const selectAnswer = (idx) => {
    if (answers[current] !== undefined) return;
    setAnswers({ ...answers, [current]: idx });
    setShowExplanation(true);
  };

  const next = () => {
    if (current < quizzes.length - 1) { setCurrent(current + 1); setShowExplanation(false); }
    else setStep("result");
  };

  const correctCount = Object.entries(answers).filter(([k, v]) => quizzes[parseInt(k)]?.answer === v).length;

  const sidebarEl = (
    <>
      {sidebar && <Sidebar active="퀴즈 생성" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
    </>
  );

  if (step === "select") {
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} />
        <div style={{ padding: 24, maxWidth: 500, margin: "40px auto" }}>
          <Card style={{ padding: 32 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#222", textAlign: "center" }}>퀴즈 생성</h2>
            <p style={{ margin: "0 0 28px", fontSize: 14, color: "#999", textAlign: "center" }}>과목과 문제 수를 선택하세요</p>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 6, display: "block" }}>과목명</label>
            {courses.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {courses.map((c, i) => (
                  <button key={i} onClick={() => setSubject(c)} style={{
                    padding: "9px 18px", borderRadius: 10,
                    border: subject === c ? "none" : "1px solid #e0e0e0",
                    background: subject === c ? PINK : "#fafafa",
                    color: subject === c ? "#fff" : "#444",
                    fontSize: 14, fontWeight: subject === c ? 600 : 400, cursor: "pointer"
                  }}>{c}</button>
                ))}
              </div>
            ) : (
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="예: 알고리즘" style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #e0e0e0",
                fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 20
              }}/>
            )}
            <label style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 6, display: "block" }}>문제 수</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
              {[5, 10, 15, 20].map(n => (
                <button key={n} onClick={() => setCount(n)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: count === n ? "none" : "1px solid #e0e0e0",
                  background: count === n ? CYAN : "#fff",
                  color: count === n ? "#fff" : "#666", fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{n}문제</button>
              ))}
            </div>
            <button onClick={generate} style={{
              width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
              background: PINK, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer"
            }}>퀴즈 생성하기</button>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "generating") {
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, border: "3px solid #f0f0f0", borderTop: `3px solid ${PINK}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }}/>
          <p style={{ fontSize: 16, fontWeight: 600, color: "#333" }}>AI가 퀴즈를 생성하고 있습니다...</p>
          <p style={{ fontSize: 13, color: "#999" }}>{subject} · {count}문제</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
        </div>
      </div>
    );
  }

  if (step === "result") {
    const pct = Math.round((correctCount / quizzes.length) * 100);
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 결과" onOpenSidebar={() => setSidebar(true)} />
        <div style={{ padding: 24, maxWidth: 500, margin: "40px auto", textAlign: "center" }}>
          <Card style={{ padding: 40 }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%", margin: "0 auto 20px",
              background: pct >= 80 ? "#E8FAFE" : pct >= 50 ? "#FFF8E8" : "#FFF0F6",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, fontWeight: 800, color: pct >= 80 ? CYAN : pct >= 50 ? "#E8A800" : PINK
            }}>{pct}%</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>
              {pct >= 80 ? "훌륭해요!" : pct >= 50 ? "좋은 시작이에요!" : "조금 더 노력해봐요!"}
            </h2>
            <p style={{ fontSize: 15, color: "#666", margin: "0 0 28px" }}>{quizzes.length}문제 중 {correctCount}문제 정답</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button onClick={() => { setStep("select"); setSubject(""); }} style={{
                padding: "12px 24px", borderRadius: 12, border: "1px solid #e0e0e0",
                background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#555"
              }}>새 퀴즈</button>
              <button onClick={() => { setCurrent(0); setAnswers({}); setShowExplanation(false); setStep("quiz"); }} style={{
                padding: "12px 24px", borderRadius: 12, border: "none",
                background: PINK, fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#fff"
              }}>다시 풀기</button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const q = quizzes[current];
  const selected = answers[current];
  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebarEl}
      <Header label={`${subject} 퀴즈`} onOpenSidebar={() => setSidebar(true)}
        extra={<span style={{ fontSize: 14, fontWeight: 600, color: "#999" }}>{current + 1} / {quizzes.length}</span>} />
      <div style={{ height: 3, background: "#f0f0f0" }}>
        <div style={{ height: 3, background: PINK, width: `${((current + 1) / quizzes.length) * 100}%`, transition: "width 0.3s" }}/>
      </div>
      <div style={{ padding: 24, maxWidth: 600, margin: "30px auto" }}>
        <Card style={{ padding: 28 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: CYAN, marginBottom: 10, display: "block" }}>Q{current + 1}</span>
          <h3 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 600, color: "#222", lineHeight: 1.5 }}>{q.question}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {q.options.map((opt, i) => {
              const isSelected = selected === i;
              const isCorrect = q.answer === i;
              const answered = selected !== undefined;
              let bg = "#fafafa", border = "#f0f0f0", color = "#444";
              if (answered) {
                if (isCorrect) { bg = "#E8FAFE"; border = CYAN; color = CYAN; }
                else if (isSelected && !isCorrect) { bg = "#FFF0F6"; border = PINK; color = PINK; }
              }
              return (
                <button key={i} onClick={() => selectAnswer(i)} style={{
                  padding: "14px 18px", borderRadius: 12, border: `1.5px solid ${border}`,
                  background: bg, textAlign: "left", fontSize: 14, color, cursor: answered ? "default" : "pointer",
                  fontWeight: isSelected || (answered && isCorrect) ? 600 : 400, transition: "all 0.2s"
                }}>
                  <span style={{ marginRight: 10, fontWeight: 600 }}>{String.fromCharCode(65 + i)}.</span>
                  {opt}
                  {answered && isCorrect && <span style={{ float: "right" }}>✓</span>}
                  {answered && isSelected && !isCorrect && <span style={{ float: "right" }}>✗</span>}
                </button>
              );
            })}
          </div>
          {showExplanation && (
            <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: "#FAFAFA", borderLeft: `3px solid ${CYAN}`, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
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