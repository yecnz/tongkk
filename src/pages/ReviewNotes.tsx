import BrandLogo from "../components/BrandLogo";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { pageRoutes, SidebarIcon, Sidebar, Card, type PageRouteLabel, useSidebarOpen } from "../common";
import { useToast } from "../ToastContext";
import { useAuth } from "../AuthContext";
import { loadAllQuizAttemptsFromServer, type SavedQuizAttemptWithCourse } from "../services/quizAttempts";
import { loadQuizSetsFromServer } from "../services/quizSets";
import { loadAllWrongAnswerAnalysesFromServer, saveWrongAnswerAnalysisToServer } from "../services/wrongAnswerAnalyses";
import { analyzeWrongAnswers, type QuizQuestion, type QuizQuestionType, type WrongAnswerAnalysis, type WrongAnalysisItem } from "../services/gpt";

import QuizIssueLink from '../features/review/QuizIssueLink';
import SaveWrongCard from '../features/flashcards/SaveWrongCard';
import './ReviewNotes.css';

const ALL = "전체";

type WrongEntry = {
  materialIds: string[];
  attemptId: string;
  questionIndex: number;
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

export default function ReviewNotes({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const page: PageRouteLabel = "오답 노트";
  const [sidebar, setSidebar] = useSidebarOpen();
  const [attempts, setAttempts] = useState<SavedQuizAttemptWithCourse[]>([]);
  const [analyses, setAnalyses] = useState<Map<string, WrongAnswerAnalysis>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadRetry, setLoadRetry] = useState(0);
  const [params, setParams] = useSearchParams();
  const filter = params.get('course') || ALL;
  const setFilter = (course: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (course === ALL) next.delete('course');
    else next.set('course', course);
    return next;
  });
  const [retryingCourse, setRetryingCourse] = useState<string | null>(null);
  const [analyzingCourse, setAnalyzingCourse] = useState<string | null>(null);
  const [expandedAnalyses, setExpandedAnalyses] = useState<Set<string>>(new Set());

  useEffect(() => {
    let ignore = false;
    // 게스트는 조회 없이 빈 상태로 — 로그인하면(user 갱신) 자동 재로딩.
    if (!user) {
      setAttempts([]);
      setAnalyses(new Map());
      setLoading(false);
      return () => { ignore = true; };
    }
    setLoading(true);
    setLoadError("");
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
      .catch(err => { if (!ignore) setLoadError(err instanceof Error ? err.message : "오답 노트를 불러오지 못했습니다."); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [user, loadRetry]);

  // attempts는 created_at desc → 처음 만난 question 텍스트가 가장 최근 회차
  const wrongEntries = useMemo(() => {
    const seen = new Set<string>();
    const result: WrongEntry[] = [];
    for (const attempt of attempts) {
      for (const [questionIndex, answer] of attempt.answers.entries()) {
        if (answer.isCorrect) continue;
        const key = `${attempt.courseName}␟${answer.question}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          materialIds: attempt.materialIds,
          attemptId: attempt.id, questionIndex,
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
      setExpandedAnalyses(prev => new Set(prev).add(courseName));
      showToast("오답 분석을 완료했습니다.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "오답 분석에 실패했습니다.", "error");
    } finally {
      setAnalyzingCourse(null);
    }
  };

  return (
    <div className={`review-notes${embedded ? "" : " review-notes-page"}`}>
      {!embedded && sidebar && <Sidebar active={page} onNav={item => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}

      {!embedded && <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-surface)", display: "flex", alignItems: "center", gap: 16 }}>
        <button type="button" className="tongkk-hover-dim" onClick={() => setSidebar(!sidebar)} aria-label={sidebar ? "메뉴 닫기" : "메뉴 열기"} style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button type="button" className="brand-home tongkk-hover-fade" onClick={() => navigate("/")}><BrandLogo /></button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 오답 노트</span>
      </div>}

      <section className={embedded ? "review-notes-content" : "app-container narrow review-notes-content"} aria-labelledby="wrong-notes-heading">
        <header className="review-notes-heading">
          <div>
            <h2 id="wrong-notes-heading">오답 노트</h2>
            <p>틀린 문제를 확인하고, 과목별로 다시 풀어보세요.</p>
          </div>
          {!loading && !loadError && wrongEntries.length > 0 && <span className="review-notes-total">{courseNames.length}과목 · 오답 {wrongEntries.length}문항</span>}
        </header>

        {courseNames.length > 0 && (
          <div className="review-course-filters" role="group" aria-label="오답 과목 필터">
            {[ALL, ...courseNames].map(name => {
              const active = filter === name;
              return (
                <button type="button" key={name} aria-pressed={active} onClick={() => setFilter(name)}>
                  {name}<span className="review-filter-count">{name === ALL ? wrongEntries.length : entriesByCourse.get(name)?.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <Card className="review-empty" role="status">
            <p>오답을 불러오는 중…</p>
          </Card>
        ) : loadError ? (
          <Card className="review-empty">
            <p role="alert">{loadError}</p>
            <button type="button" className="workflow-button" onClick={() => setLoadRetry(value => value + 1)}>다시 불러오기</button>
          </Card>
        ) : wrongEntries.length === 0 ? (
          <Card className="review-empty">
            <h3>아직 기록된 오답이 없어요</h3>
            <p>퀴즈를 풀고 채점하면 틀린 문제가 여기에 모입니다.</p>
          </Card>
        ) : visibleCourses.length === 0 ? (
          <Card className="review-empty">
            <p>선택한 과목에 기록된 오답이 없습니다.</p>
            <button type="button" className="workflow-button" onClick={() => setFilter(ALL)}>전체 오답 보기</button>
          </Card>
        ) : (
          visibleCourses.map(courseName => {
            const entries = entriesByCourse.get(courseName) || [];
            const analysis = analyses.get(courseName);
            return (
              <section key={courseName} className="review-course" aria-label={`${courseName} 오답`}>
                <header className="review-course-heading">
                  <div className="review-course-title">
                    <h3>{courseName}</h3>
                    <span>{entries.length}문항</span>
                  </div>
                  <div className="review-course-actions">
                    <button
                      type="button"
                      className="workflow-button workflow-primary"
                      onClick={() => handleRetry(courseName)}
                      disabled={retryingCourse !== null}
                      aria-busy={retryingCourse === courseName}
                      aria-label={`${courseName} 오답 다시 풀기`}
                    >
                      {retryingCourse === courseName ? "준비 중…" : <>오답 다시 풀기 <span aria-hidden="true">→</span></>}
                    </button>
                    <button
                      type="button"
                      className="workflow-button"
                      onClick={() => handleAnalyze(courseName)}
                      disabled={analyzingCourse !== null}
                      aria-busy={analyzingCourse === courseName}
                      aria-label={`${courseName} ${analysis ? "오답 다시 분석" : "오답 분석"}`}
                    >
                      {analyzingCourse === courseName ? "분석 중…" : analysis ? "다시 분석" : "오답 분석"}
                    </button>
                  </div>
                </header>

                {analysis && (
                  <details className="review-analysis" open={expandedAnalyses.has(courseName)} onToggle={event => {
                    const open = event.currentTarget.open;
                    setExpandedAnalyses(prev => {
                      if (prev.has(courseName) === open) return prev;
                      const next = new Set(prev);
                      if (open) next.add(courseName);
                      else next.delete(courseName);
                      return next;
                    });
                  }}>
                    <summary>과목 오답 분석</summary>
                    {analysis.summary && (
                      <p>{analysis.summary}</p>
                    )}
                    <dl className="review-analysis-points">
                      {analysis.weaknesses.length > 0 && (
                        <div><dt>취약점</dt><dd>{analysis.weaknesses.join(" / ")}</dd></div>
                      )}
                      {analysis.studyPoints.length > 0 && (
                        <div><dt>더 공부할 내용</dt><dd>{analysis.studyPoints.join(" / ")}</dd></div>
                      )}
                      {analysis.memorize.length > 0 && (
                        <div><dt>암기 포인트</dt><dd>{analysis.memorize.join(" / ")}</dd></div>
                      )}
                      {analysis.studyMethod && (
                        <div><dt>공부 방법</dt><dd>{analysis.studyMethod}</dd></div>
                      )}
                    </dl>
                  </details>
                )}

                <div className="review-question-list">
                  {entries.map((entry, index) => (
                    <Card key={`${entry.question}-${index}`} className="review-question">
                      <div className="review-question-meta">
                        <span className="review-question-number">문항 {index + 1}</span>
                        <span>{entry.type}</span>
                      </div>
                      <h4>{entry.question}</h4>
                      <dl className="review-answer-comparison">
                        <div className="review-answer-student"><dt>내 답</dt><dd>{entry.studentAnswer ?? "미응답"}</dd></div>
                        <div className="review-answer-correct"><dt>정답</dt><dd>{entry.correctAnswer ?? "정답 정보 없음"}</dd></div>
                      </dl>
                      <div className="review-question-explanation">
                        <h5>해설</h5>
                        <p>{entry.feedback || entry.explanation || "등록된 해설이 없습니다."}</p>
                      </div>
                      <div className="review-question-footer">
                        <SaveWrongCard {...entry} />
                        <QuizIssueLink attemptId={entry.attemptId} questionIndex={entry.questionIndex} />
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </section>
    </div>
  );
}
