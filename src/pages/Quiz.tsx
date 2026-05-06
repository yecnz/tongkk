import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card, type PageRouteLabel } from "../common";
import { useCourses } from "../CourseContext";
import { generateQuiz, type QuizQuestion, type QuizDifficulty } from "../services/gpt";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";

type QuizView = "courseList" | "courseDetail" | "generating" | "quiz" | "result";

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
  const [view, setView] = useState<QuizView>("courseList");

  // 과목 및 설정
  const [selectedCourse, setSelectedCourse] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("보통");

  // 자료 관련
  const [cachedMarkdown, setCachedMarkdown] = useState<string | undefined>(undefined);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [newMarkdown, setNewMarkdown] = useState<string | undefined>(undefined);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 퀴즈
  const [quizzes, setQuizzes] = useState<QuizQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 과목 선택 시 localStorage에서 마크다운 자동 로드
  useEffect(() => {
    if (selectedCourse) {
      const stored = localStorage.getItem(`tongkk:markdown:${selectedCourse}`);
      setCachedMarkdown(stored ?? undefined);
    } else {
      setCachedMarkdown(undefined);
    }
    setNewMarkdown(undefined);
    setUploadedFileName("");
    setExtractError("");
  }, [selectedCourse]);

  // spin 애니메이션 CSS 한 번만 주입
  useEffect(() => {
    const id = "tongkk-spin";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = "@keyframes spin { to { transform: rotate(360deg); }}";
      document.head.appendChild(style);
    }
    return () => { document.getElementById("tongkk-spin")?.remove(); };
  }, []);

  // 퀴즈 풀이/생성 중 브라우저 이탈 방지
  useEffect(() => {
    if (view !== "quiz" && view !== "generating") return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [view]);

  const handleCourseSelect = (course: string) => {
    setSelectedCourse(course);
    setView("courseDetail");
  };

  const resetCourseSelection = () => {
    setSelectedCourse("");
    setView("courseList");
    setError(null);
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf") || isExtracting) return;
    setUploadedFileName(file.name);
    setIsExtracting(true);
    setExtractError("");
    setNewMarkdown(undefined);
    try {
      const markdown = await extractMarkdownFromPDF(file);
      setNewMarkdown(markdown);
      if (selectedCourse) {
        localStorage.setItem(`tongkk:markdown:${selectedCourse}`, markdown);
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
    if (!selectedCourse.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setView("generating");
    setError(null);
    const markdownToUse = newMarkdown || cachedMarkdown;
    try {
      const questions = await generateQuiz(selectedCourse, count, difficulty, markdownToUse, controller.signal);
      setQuizzes(questions);
      setCurrent(0);
      setAnswers({});
      setView("quiz");
    } catch (err) {
      if (controller.signal.aborted) {
        setView("courseDetail");
        return;
      }
      setError(err instanceof Error ? err.message : "퀴즈 생성에 실패했습니다.");
      setView("courseDetail");
    }
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
  };

  const selectAnswer = (idx: number) => {
    if (answers[current] !== undefined) return;
    setAnswers({ ...answers, [current]: idx });
    setShowExplanation(true);
  };

  const next = () => {
    if (current < quizzes.length - 1) { setCurrent(current + 1); setShowExplanation(false); }
    else setView("result");
  };

  const correctCount = Object.entries(answers).filter(([k, v]) => quizzes[parseInt(k)]?.answer === v).length;
  const activeMarkdown = newMarkdown || cachedMarkdown;

  const handleNav = (item: PageRouteLabel) => {
    if (view === "quiz") {
      if (!window.confirm("퀴즈 풀이 중입니다. 진행 상태가 저장되지 않습니다.\n페이지를 떠나시겠습니까?")) {
        setSidebar(false);
        return;
      }
    }
    navigate(pageRoutes[item]);
  };

  const sidebarEl = (
    <>
      {sidebar && <Sidebar active="퀴즈 생성" onNav={handleNav} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
    </>
  );

  // ── 과목 카드 리스트 ──
  if (view === "courseList") {
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} />
        <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#222" }}>과목 선택</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#999" }}>퀴즈를 만들 과목을 선택하세요</p>
          </div>

          {courses.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {courses.map((c, i) => {
                const hasMarkdown = !!localStorage.getItem(`tongkk:markdown:${c}`);
                return (
                  <button
                    key={i}
                    onClick={() => handleCourseSelect(c)}
                    style={{
                      minHeight: 170,
                      padding: 22,
                      borderRadius: 14,
                      border: "1px solid #eeeeee",
                      background: "#fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                      color: "#222",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      transition: "border 0.15s, box-shadow 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{c}</span>
                      <span style={{
                        padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: hasMarkdown ? "#E8FAFE" : "#f0f0f0",
                        color: hasMarkdown ? CYAN : "#aaa",
                        flexShrink: 0,
                      }}>
                        {hasMarkdown ? "자료 있음" : "자료 없음"}
                      </span>
                    </div>
                    <span style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: "#aaa" }}>
                      선택하기
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Card style={{ padding: 40, textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "#aaa", margin: 0 }}>등록된 과목이 없습니다. 대시보드에서 과목을 추가해주세요.</p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // ── 과목 세부 (자료 + 설정) ──
  if (view === "courseDetail") {
    const canGenerate = !isExtracting;
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {sidebarEl}
        <Header label="퀴즈 생성" onOpenSidebar={() => setSidebar(true)} />
        <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
          <button onClick={resetCourseSelection} style={{
            background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
          }}>← 과목 선택으로</button>

          <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "#222" }}>{selectedCourse}</h2>

          {error && (
            <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#FFF0F6", border: `1px solid ${PINK}`, fontSize: 13, color: PINK }}>
              {error}
            </div>
          )}

          {/* 강의자료 */}
          <Card style={{ padding: 24, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#222" }}>강의자료</h3>

            {cachedMarkdown && !newMarkdown && (
              <div style={{
                padding: "12px 16px", borderRadius: 10, background: "#E8FAFE",
                fontSize: 13, color: CYAN, marginBottom: 14, fontWeight: 500
              }}>
                저장된 강의자료가 있습니다 — 퀴즈에 반영됩니다
              </div>
            )}
            {!cachedMarkdown && !newMarkdown && (
              <div style={{
                padding: "12px 16px", borderRadius: 10, background: "#fafafa",
                fontSize: 13, color: "#aaa", marginBottom: 14
              }}>
                저장된 자료가 없습니다. PDF를 업로드하거나 과목명으로만 퀴즈를 생성할 수 있습니다.
              </div>
            )}

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
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                style={{ display: "none" }} />
              <p style={{ margin: "0 0 8px", fontSize: 14, color: "#888" }}>
                {cachedMarkdown ? "새 PDF로 교체하려면 드래그하거나" : "PDF 파일을 드래그하거나"}
              </p>
              <button style={{
                padding: "7px 18px", borderRadius: 10, border: "1px solid #ddd",
                background: "#fff", fontSize: 13, cursor: "pointer", color: "#555"
              }}>파일 선택</button>
            </div>

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
          </Card>

          {/* 설정 */}
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "#222" }}>퀴즈 설정</h3>

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
            background: canGenerate ? PINK : "#e0e0e0",
            color: canGenerate ? "#fff" : "#bbb",
            fontSize: 16, fontWeight: 700,
            cursor: canGenerate ? "pointer" : "not-allowed"
          }}>
            {isExtracting ? "자료 분석 중..." : activeMarkdown ? `${selectedCourse} 퀴즈 생성하기` : "퀴즈 생성하기 (과목명 기반)"}
          </button>
        </div>
      </div>
    );
  }

  // ── 생성 중 ──
  if (view === "generating") {
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, border: "3px solid #f0f0f0", borderTop: `3px solid ${PINK}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }}/>
          <p style={{ fontSize: 16, fontWeight: 600, color: "#333" }}>AI가 퀴즈를 생성하고 있습니다...</p>
          <p style={{ fontSize: 13, color: "#999" }}>{selectedCourse} · {count}문제 · {difficulty}{activeMarkdown ? " · 강의자료 반영" : ""}</p>
          <button onClick={cancelGeneration} style={{
            marginTop: 20, padding: "10px 28px", borderRadius: 10,
            border: "1px solid #e0e0e0", background: "#fff",
            fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#999"
          }}>취소</button>
        </div>
      </div>
    );
  }

  // ── 결과 ──
  if (view === "result") {
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
              <button onClick={resetCourseSelection} style={{
                padding: "12px 24px", borderRadius: 12, border: "1px solid #e0e0e0",
                background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#555"
              }}>새 퀴즈</button>
              <button onClick={() => { setCurrent(0); setAnswers({}); setShowExplanation(false); setView("quiz"); }} style={{
                padding: "12px 24px", borderRadius: 12, border: "none",
                background: PINK, fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#fff"
              }}>다시 풀기</button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ── 퀴즈 풀기 ──
  const q = quizzes[current];
  const selected = answers[current];
  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebarEl}
      <Header label={`${selectedCourse} 퀴즈`} onOpenSidebar={() => setSidebar(true)}
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
