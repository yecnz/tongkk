import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, BORDER_COLOR, pageRoutes, SidebarIcon, Sidebar, Card, type PageRouteLabel } from "../common";
import { useToast } from "../ToastContext";
import { loadAllQuizAttemptsFromServer, type SavedQuizAttemptWithCourse } from "../services/quizAttempts";
import { loadQuizSetsFromServer } from "../services/quizSets";
import { loadAllWrongAnswerAnalysesFromServer, saveWrongAnswerAnalysisToServer } from "../services/wrongAnswerAnalyses";
import { analyzeWrongAnswers, type QuizQuestion, type QuizQuestionType, type WrongAnswerAnalysis, type WrongAnalysisItem } from "../services/gpt";

const ALL = "전체";

type WrongEntry = {
  courseName: string;
  quizSetId: string | null;
  question: string;
  type: QuizQuestionType;
  studentAnswer: number | string | null;
  correctAnswer: number | string | null;
  feedback?: string;
  explanation: string;
  createdAt: number;
};

export default function ReviewNotes() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const page: PageRouteLabel = "오답 노트";
  const [sidebar, setSidebar] = useState(false);
  const [attempts, setAttempts] = useState<SavedQuizAttemptWithCourse[]>([]);
  const [analyses, setAnalyses] = useState<Map<string, WrongAnswerAnalysis>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>(ALL);
  const [retryingCourse, setRetryingCourse] = useState<string | null>(null);
  const [analyzingCourse, setAnalyzingCourse] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    Promise.all([
      loadAllQuizAttemptsFromServer({ includeAnswers: true }),
      // 분석 테이블이 아직 없거나 실패해도 오답 노트 본문은 보이도록 빈 Map으로 흘려보낸다.
      loadAllWrongAnswerAnalysesFromServer().catch(() => new Map<string, WrongAnswerAnalysis>()),
    ])
      .then(([rows, analysisMap]) => {
        if (ignore) return;
        setAttempts(rows);
        setAnalyses(analysisMap);
      })
      .catch(err => { if (!ignore) showToast(err instanceof Error ? err.message : "오답 노트를 불러오지 못했습니다.", "error"); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [showToast]);

  // attempts는 created_at desc → 처음 만난 question 텍스트가 가장 최근 회차
  const wrongEntries = useMemo(() => {
    const seen = new Set<string>();
    const result: WrongEntry[] = [];
    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        if (answer.isCorrect) continue;
        const key = `${attempt.courseName}␟${answer.question}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          courseName: attempt.courseName,
          quizSetId: attempt.quizSetId,
          question: answer.question,
          type: answer.type,
          studentAnswer: answer.studentAnswer,
          correctAnswer: answer.correctAnswer,
          feedback: answer.feedback,
          explanation: answer.explanation,
          createdAt: attempt.createdAt,
        });
      }
    }
    return result;
  }, [attempts]);

  const courseNames = useMemo(
    () => Array.from(new Set(wrongEntries.map(entry => entry.courseName))),
    [wrongEntries],
  );

  const entriesByCourse = useMemo(() => {
    const map = new Map<string, WrongEntry[]>();
    for (const entry of wrongEntries) {
      const list = map.get(entry.courseName) || [];
      list.push(entry);
      map.set(entry.courseName, list);
    }
    return map;
  }, [wrongEntries]);

  const visibleCourses = filter === ALL ? courseNames : courseNames.filter(name => name === filter);

  const handleRetry = async (courseName: string) => {
    const entries = entriesByCourse.get(courseName) || [];
    if (entries.length === 0 || retryingCourse) return;
    setRetryingCourse(courseName);
    try {
      const quizSets = await loadQuizSetsFromServer(courseName, { includeQuestions: true });
      const used = new Set<string>();
      const reviewQuestions: QuizQuestion[] = [];
      for (const entry of entries) {
        if (used.has(entry.question)) continue;
        used.add(entry.question);

        let original: QuizQuestion | undefined;
        if (entry.quizSetId) {
          original = quizSets.find(set => set.id === entry.quizSetId)?.questions.find(question => question.question === entry.question);
        }
        if (!original) {
          for (const set of quizSets) {
            const found = set.questions.find(question => question.question === entry.question);
            if (found) { original = found; break; }
          }
        }

        if (original) {
          reviewQuestions.push(original);
          continue;
        }

        // 원본 보기를 복구할 수 없는 객관식/OX는 다시 풀 수 없으므로 제외
        if (entry.type === "객관식" || entry.type === "OX") continue;
        reviewQuestions.push({
          question: entry.question,
          type: entry.type,
          explanation: entry.explanation,
          answerText: typeof entry.correctAnswer === "string" ? entry.correctAnswer : undefined,
        });
      }

      if (reviewQuestions.length === 0) {
        showToast("다시 풀 수 있는 오답을 찾지 못했습니다.", "info");
        return;
      }

      navigate(pageRoutes["퀴즈 생성"], {
        state: { selectedCourse: courseName, reviewQuestions, reviewTitle: `${courseName} 오답 다시 풀기` },
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "오답 다시 풀기 준비에 실패했습니다.", "error");
    } finally {
      setRetryingCourse(null);
    }
  };

  // 퀴즈를 다시 풀지 않고도, 누적된 오답만으로 과목 오답 분석을 바로 생성한다.
  const handleAnalyze = async (courseName: string) => {
    const entries = entriesByCourse.get(courseName) || [];
    if (entries.length === 0 || analyzingCourse) return;
    setAnalyzingCourse(courseName);
    try {
      const items: WrongAnalysisItem[] = entries.map(entry => ({
        question: entry.question,
        type: entry.type,
        studentAnswer: entry.studentAnswer != null ? String(entry.studentAnswer) : "미응답",
        correctAnswer: entry.correctAnswer != null ? String(entry.correctAnswer) : "정답 정보 없음",
        explanation: entry.feedback || entry.explanation,
        isCorrect: false,
      }));
      const analysis = await analyzeWrongAnswers(courseName, items);
      await saveWrongAnswerAnalysisToServer(courseName, analysis);
      setAnalyses(prev => new Map(prev).set(courseName, analysis));
      showToast("오답 분석을 완료했어요.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "오답 분석에 실패했습니다.", "error");
    } finally {
      setAnalyzingCourse(null);
    }
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={item => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-surface)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 오답 노트</span>
      </div>

      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "var(--color-text-strong)" }}>오답 노트</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>모든 과목·회차에서 틀린 문항을 한곳에 모았습니다.</p>
        </div>

        {courseNames.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {[ALL, ...courseNames].map(name => {
              const active = filter === name;
              return (
                <button key={name} onClick={() => setFilter(name)} style={{
                  padding: "8px 14px", borderRadius: 999,
                  border: active ? `1px solid ${PINK}` : `1px solid ${BORDER_COLOR}`,
                  background: active ? "var(--color-tint-pink)" : "var(--color-card)",
                  color: active ? PINK : "var(--color-text-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}>{name}</button>
              );
            })}
          </div>
        )}

        {loading ? (
          <Card style={{ padding: 40, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)" }}>불러오는 중...</p>
          </Card>
        ) : wrongEntries.length === 0 ? (
          <Card style={{ padding: 40, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)" }}>아직 오답이 없습니다</p>
          </Card>
        ) : (
          visibleCourses.map(courseName => {
            const entries = entriesByCourse.get(courseName) || [];
            const analysis = analyses.get(courseName);
            return (
              <div key={courseName} style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "var(--color-text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{courseName}</span>
                    <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: "var(--color-muted)" }}>{entries.length}문항</span>
                    <button
                      type="button"
                      onClick={() => handleAnalyze(courseName)}
                      disabled={analyzingCourse !== null}
                      style={{
                        flexShrink: 0,
                        padding: "7px 12px", borderRadius: 999,
                        border: `1px solid ${analyzingCourse === courseName ? CYAN : BORDER_COLOR}`,
                        background: analyzingCourse === courseName ? "var(--color-tint-cyan)" : "var(--color-card)",
                        color: analyzingCourse !== null && analyzingCourse !== courseName ? "var(--color-muted)" : CYAN,
                        fontSize: 12, fontWeight: 800,
                        cursor: analyzingCourse !== null ? "default" : "pointer",
                      }}
                    >
                      {analyzingCourse === courseName ? "분석 중..." : "과목 오답 분석"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetry(courseName)}
                    disabled={retryingCourse !== null}
                    style={{
                      flexShrink: 0,
                      padding: "9px 14px", borderRadius: 10, border: "none",
                      background: retryingCourse !== null ? "var(--color-border-soft)" : PINK,
                      color: retryingCourse !== null ? "var(--color-muted)" : "var(--color-on-brand)",
                      fontSize: 13, fontWeight: 800,
                      cursor: retryingCourse !== null ? "default" : "pointer",
                    }}
                  >
                    {retryingCourse === courseName ? "준비 중..." : "이 과목 오답만 다시 풀기"}
                  </button>
                </div>

                {analysis && (
                  <div style={{
                    marginBottom: 14, padding: "14px 16px", borderRadius: 12,
                    border: "1px solid var(--color-tint-cyan)", background: "var(--color-surface)",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 850, color: "var(--color-text-strong)", marginBottom: 8 }}>
                      오답 분석
                    </div>
                    {analysis.summary && (
                      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text)", lineHeight: 1.6 }}>{analysis.summary}</p>
                    )}
                    <div style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                      {analysis.weaknesses.length > 0 && (
                        <span><strong style={{ color: PINK }}>취약점</strong> · {analysis.weaknesses.join(" / ")}</span>
                      )}
                      {analysis.studyPoints.length > 0 && (
                        <span><strong style={{ color: CYAN }}>더 공부할 내용</strong> · {analysis.studyPoints.join(" / ")}</span>
                      )}
                      {analysis.memorize.length > 0 && (
                        <span><strong style={{ color: "var(--color-text-strong)" }}>암기 포인트</strong> · {analysis.memorize.join(" / ")}</span>
                      )}
                      {analysis.studyMethod && (
                        <span><strong>공부 방법</strong> · {analysis.studyMethod}</span>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: "grid", gap: 10 }}>
                  {entries.map((entry, index) => (
                    <Card key={`${entry.question}-${index}`} style={{ padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ padding: "3px 8px", borderRadius: 999, background: "var(--color-tint-pink)", color: PINK, fontSize: 11, fontWeight: 800 }}>{entry.courseName}</span>
                        <span style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 700 }}>{entry.type}</span>
                      </div>
                      <div style={{ marginBottom: 8, fontSize: 14, color: "var(--color-text-strong)", fontWeight: 800, lineHeight: 1.5 }}>
                        {entry.question}
                      </div>
                      <div style={{ display: "grid", gap: 5, fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                        <span>내 답: <strong style={{ color: PINK }}>{entry.studentAnswer ?? "미응답"}</strong></span>
                        <span>정답: <strong style={{ color: CYAN }}>{entry.correctAnswer ?? "정답 정보 없음"}</strong></span>
                        <span>해설: {entry.feedback || entry.explanation}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
