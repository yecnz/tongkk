import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { generateQuiz, type QuizQuestion, type QuizDifficulty } from "../services/gpt";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";

type HeaderProps = { label: string; onOpenSidebar: () => void; extra?: ReactNode };

const Header = ({ label, onOpenSidebar, extra }: HeaderProps) => (
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
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("보통");
  const [quizzes, setQuizzes] = useState<QuizQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedMarkdown, setCachedMarkdown] = useState<string | undefined>(undefined);

  // 파일 업로드 관련 상태
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [newMarkdown, setNewMarkdown] = useState<string | undefined>(undefined);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 과목 선택 시 localStorage에서 마크다운 자동 로드
  useEffect(() => {
    if (subject) {
      const stored = localStorage.getItem(`tongkk:markdown:${subject}`);
      setCachedMarkdown(stored ?? undefined);
    } else {
      setCachedMarkdown(undefined);
    }
    // 과목 바뀌면 업로드 초기화
    setNewMarkdown(undefined);
    setUploadedFileName("");
    setExtractError("");
  }, [subject]);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) return;
    setUploadedFileName(file.name);
    setIsExtracting(true);
    setExtractError("");
    setNewMarkdown(undefined);
    try {
      const markdown = await extractMarkdownFromPDF(file);
      setNewMarkdown(markdown);
      // 해당 과목에 저장
      if (subject) {
        localStorage.setItem(`tongkk:markdown:${subject}`, markdown);
        setCachedMarkdown(markdown);
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "PDF 변환 실패");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const generate = async () => {
    if (!subject.trim()) return;
    setStep("generating");
    setError(null);
    const markdownToUse = newMarkdown || cachedMarkdown;
    try {
      const questions = await generateQuiz(subject, count, difficulty, markdownToUse);
      setQuizzes(questions);
      setCurrent(0);
      setAnswers({});
      setStep("quiz");
    } catch (err) {
      setError(err instanceof Error ? err.message : "퀴즈 생성에 실패했습니다.");
      setStep("select");
    }
  };

  const selectAnswer = (idx: number) => {
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

  const activeMarkdown = newMarkdown || cachedMarkdown;
  const canGenerate = !!subject.trim() && !isExtracting;

  if (step === "select") {
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} />
        <div style={{ padding: 24, maxWidth: 640, margin: "32px auto" }}>

          {error && (
            <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#FFF0F6", border: `1px solid ${PINK}`, fontSize: 13, color: PINK }}>
              {error}
            </div>
          )}

          {/* 과목 선택 */}
          <Card style={{ padding: 28, marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700, color: "#222" }}>과목 선택</h2>
            {courses.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {courses.map((c, i) => {
                  const hasMarkdown = !!localStorage.getItem(`tongkk:markdown:${c}`);
                  const isSelected = subject === c;
                  return (
                    <button key={i} onClick={() => setSubject(isSelected ? "" : c)} style={{
                      padding: "14px 10px", borderRadius: 12,
                      border: isSelected ? `2px solid ${PINK}` : "1.5px solid #e8e8e8",
                      background: isSelected ? "#FFF0F6" : "#fafafa",
                      cursor: "pointer", textAlign: "center", position: "relative"
                    }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: isSelected ? PINK : "#333", marginBottom: 6 }}>{c}</div>
                      <div style={{
                        display: "inline-block", fontSize: 11, fontWeight: 500,
                        padding: "2px 8px", borderRadius: 6,
                        background: hasMarkdown ? "#E8FAFE" : "#f0f0f0",
                        color: hasMarkdown ? CYAN : "#aaa"
                      }}>{hasMarkdown ? "자료 있음" : "자료 없음"}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="과목명 직접 입력 (예: 알고리즘)" style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #e0e0e0",
                fontSize: 14, outline: "none", boxSizing: "border-box"
              }}/>
            )}
          </Card>

          {/* 자료 업로드 (과목 선택 후 표시) */}
          {subject && (
            <Card style={{ padding: 28, marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "#222" }}>강의자료 업로드</h2>

              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? CYAN : "#ddd"}`,
                  borderRadius: 12, padding: "28px 20px", textAlign: "center",
                  cursor: "pointer", background: dragOver ? "#F0FDFF" : "#fafafa",
                  transition: "all 0.2s", marginBottom: 12
                }}
              >
                <input ref={fileRef} type="file" accept=".pdf"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  style={{ display: "none" }} />
                <p style={{ margin: "0 0 8px", fontSize: 14, color: "#888" }}>PDF 파일을 드래그하거나</p>
                <button style={{
                  padding: "7px 18px", borderRadius: 10, border: "1px solid #ddd",
                  background: "#fff", fontSize: 13, cursor: "pointer", color: "#555"
                }}>파일 선택</button>
              </div>

              <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>

              {isExtracting && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 14, height: 14, border: `2px solid ${PINK}`, borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: PINK }}>PDF 분석 중... ({uploadedFileName})</span>
                </div>
              )}
              {!isExtracting && newMarkdown && (
                <span style={{ fontSize: 13, color: "#4CAF50" }}>{uploadedFileName} 분석 완료 — 퀴즈에 반영됩니다</span>
              )}
              {!isExtracting && extractError && (
                <span style={{ fontSize: 13, color: "#E53E3E" }}>분석 실패: {extractError}</span>
              )}
              {!isExtracting && !newMarkdown && cachedMarkdown && !extractError && (
                <span style={{ fontSize: 13, color: CYAN }}>저장된 강의자료를 사용합니다 (새 파일 업로드로 교체 가능)</span>
              )}
              {!isExtracting && !newMarkdown && !cachedMarkdown && !extractError && (
                <span style={{ fontSize: 13, color: "#aaa" }}>자료 없이 생성하면 과목명 기반으로만 출제됩니다</span>
              )}
            </Card>
          )}

          {/* 설정 */}
          <Card style={{ padding: 28, marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700, color: "#222" }}>설정</h2>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8, display: "block" }}>문제 수</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {[5, 10, 15, 20].map(n => (
                <button key={n} onClick={() => setCount(n)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: count === n ? "none" : "1px solid #e0e0e0",
                  background: count === n ? CYAN : "#fff",
                  color: count === n ? "#fff" : "#666", fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{n}문제</button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8, display: "block" }}>난이도</label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["쉬움", "보통", "어려움"] as QuizDifficulty[]).map(d => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10,
                  border: difficulty === d ? "none" : "1px solid #e0e0e0",
                  background: difficulty === d ? PINK : "#fff",
                  color: difficulty === d ? "#fff" : "#666", fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>
          </Card>

          <button onClick={generate} disabled={!canGenerate} style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: canGenerate ? (activeMarkdown ? PINK : "#e0e0e0") : "#e0e0e0",
            color: canGenerate ? "#fff" : "#bbb",
            fontSize: 16, fontWeight: 700,
            cursor: canGenerate ? "pointer" : "not-allowed"
          }}>
            {!subject ? "과목을 선택하세요" : isExtracting ? "자료 분석 중..." : activeMarkdown ? `${subject} 퀴즈 생성하기` : "퀴즈 생성하기"}
          </button>
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
          <p style={{ fontSize: 13, color: "#999" }}>{subject} · {count}문제 · {difficulty}{activeMarkdown ? " · 강의자료 반영" : ""}</p>
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
              <button onClick={() => { setStep("select"); setSubject(""); setNewMarkdown(undefined); setUploadedFileName(""); }} style={{
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
                  {answered && isCorrect && <span style={{ float: "right" }}>O</span>}
                  {answered && isSelected && !isCorrect && <span style={{ float: "right" }}>X</span>}
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
