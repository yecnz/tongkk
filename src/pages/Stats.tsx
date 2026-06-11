import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, pageRoutes, SidebarIcon, Sidebar, Card, type PageRouteLabel } from "../common";
import { useToast } from "../ToastContext";
import { loadAllQuizAttemptsFromServer, type SavedQuizAttemptWithCourse } from "../services/quizAttempts";
import {
  averageScore,
  coursePerformance,
  recentAttempts,
  scoreTrend,
  studyStreak,
  totalQuestionCount,
  totalStudyMinutes,
} from "../services/statsHelpers";

const formatStudyTime = (minutes: number) => {
  if (minutes <= 0) return "0분";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  if (rest === 0) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
};

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const scoreColor = (score: number) => {
  if (score >= 80) return CYAN;
  if (score >= 60) return "var(--color-indigo)";
  return PINK;
};

const progressColor = (progress: number) => {
  if (progress >= 70) return CYAN;
  if (progress >= 40) return "var(--color-indigo)";
  return PINK;
};

const SummaryCard = ({ label, value, accent, note }: { label: string; value: ReactNode; accent: string; note: string }) => (
  <Card style={{ padding: 20, minHeight: 122, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 850, color: "var(--color-text-secondary)" }}>{label}</div>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />
    </div>
    <div>
      <div style={{ fontSize: 25, fontWeight: 900, color: "var(--color-text-strong)", letterSpacing: 0 }}>{value}</div>
      <div style={{ marginTop: 7, fontSize: 12.5, fontWeight: 700, color: "var(--color-text-secondary)", lineHeight: 1.45 }}>{note}</div>
    </div>
  </Card>
);

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const BAR_GAP = 10;
// 점수 100%일 때 막대 위 점수 라벨(y-8)·꼭짓점이 viewBox(y=0) 위로 넘어가 잘리므로 위쪽 여백을 둔다.
const CHART_TOP_PAD = 22;

export default function Stats() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const page: PageRouteLabel = "학습 통계";
  const [sidebar, setSidebar] = useState(false);
  const [attempts, setAttempts] = useState<SavedQuizAttemptWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    loadAllQuizAttemptsFromServer()
      .then(rows => { if (!ignore) setAttempts(rows); })
      .catch(err => { if (!ignore) showToast(err instanceof Error ? err.message : "학습 통계를 불러오지 못했습니다.", "error"); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [showToast]);

  const trend = useMemo(() => scoreTrend(attempts), [attempts]);
  const courses = useMemo(() => coursePerformance(attempts), [attempts]);
  const latest = useMemo(
    () => recentAttempts(attempts, showAllRecent ? attempts.length : 5),
    [attempts, showAllRecent],
  );
  const visibleCourses = showAllCourses ? courses : courses.slice(0, 6);

  // 통계가 막다른 화면이 되지 않도록 과목 행에서 해당 과목 복습(자료 요약)으로 바로 잇는다.
  const goToCourseReview = (courseName: string) => {
    navigate(pageRoutes["자료 요약"], { state: { selectedCourse: courseName } });
  };
  // 최근 풀이는 세트가 남아 있으면 저장된 결과 화면으로 바로 연다.
  const goToAttempt = (attempt: SavedQuizAttemptWithCourse) => {
    if (attempt.quizSetId) {
      navigate(pageRoutes["퀴즈 생성"], { state: { course: attempt.courseName, quizSetId: attempt.quizSetId, openQuiz: true } });
      return;
    }
    goToCourseReview(attempt.courseName);
  };
  const streak = studyStreak(attempts);
  const minutes = totalStudyMinutes(attempts);
  const average = averageScore(attempts);
  const totalQuestions = totalQuestionCount(attempts);
  const bestCourse = courses.length > 0 ? [...courses].sort((a, b) => b.progressPercent - a.progressPercent)[0] : null;
  const latestScore = latest[0]?.scorePercent ?? 0;
  const previousScore = latest[1]?.scorePercent ?? null;
  const scoreDelta = previousScore === null ? null : latestScore - previousScore;

  const barCount = trend.length;
  const barWidth = barCount > 0 ? (CHART_WIDTH - BAR_GAP * (barCount - 1)) / barCount : 0;
  const trendPath = trend
    .map((point, index) => {
      const x = barCount <= 1 ? CHART_WIDTH / 2 : index * (CHART_WIDTH / (barCount - 1));
      const y = CHART_HEIGHT - (point.scorePercent / 100) * CHART_HEIGHT;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active={page} onNav={item => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-surface)", display: "flex", alignItems: "center", gap: 16 }}>
        <button type="button" className="tongkk-hover-dim" onClick={() => setSidebar(true)} style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button type="button" className="tongkk-hover-fade" onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 학습 통계</span>
      </div>

      <div className="stats-shell">
        <div className="stats-hero">
          <div>
            <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 900, color: "var(--color-text-strong)", letterSpacing: 0 }}>학습 통계</h2>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              {loading ? "불러오는 중..." : attempts.length === 0 ? "퀴즈를 풀면 이곳에 학습 흐름이 쌓입니다." : `${attempts.length}회 풀이 · ${totalQuestions}문제 · 평균 ${average}%`}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ padding: "8px 12px", borderRadius: 999, background: "var(--color-card)", border: `1px solid ${BORDER_COLOR}`, color: "var(--color-text-secondary)", fontSize: 12.5, fontWeight: 850 }}>
              최근 학습 날짜 {latest[0] ? formatDate(latest[0].createdAt) : "-"}
            </span>
            <span style={{ padding: "8px 12px", borderRadius: 999, background: "var(--color-card)", border: `1px solid ${BORDER_COLOR}`, color: scoreColor(latestScore), fontSize: 12.5, fontWeight: 900 }}>
              {latest[0] ? `최근 풀이 점수 ${latestScore}%` : "기록 없음"}
            </span>
          </div>
        </div>

        <div className="stats-summary-grid">
          <SummaryCard label="연속 학습일" value={`${streak}일`} accent={PINK} note={streak > 0 ? "연속 학습 중이에요" : "오늘 기록 없음"} />
          <SummaryCard label="총 학습시간" value={formatStudyTime(minutes)} accent={CYAN} note={`${attempts.length}회 풀이 기준`} />
          <SummaryCard label="평균 점수" value={`${average}%`} accent={scoreColor(average)} note={scoreDelta === null ? "이전 기록 없음" : `${scoreDelta >= 0 ? "+" : ""}${scoreDelta}%p 변화`} />
          <SummaryCard label="최근 집중 과목" value={bestCourse ? bestCourse.courseName : "-"} accent="var(--color-indigo)" note={bestCourse ? `진척도 ${bestCourse.progressPercent}% · ${bestCourse.attempts}회` : "과목 기록 없음"} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <Card style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "var(--color-text-strong)" }}>점수 추이</h3>
                <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--color-text-secondary)", fontWeight: 700 }}>최근 최대 12회</p>
              </div>
              <span style={{ color: scoreColor(average), fontSize: 13, fontWeight: 900 }}>평균 {average}%</span>
            </div>
            {trend.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>아직 풀이 기록이 없습니다.</p>
            ) : (
              <svg
                viewBox={`0 ${-CHART_TOP_PAD} ${CHART_WIDTH} ${CHART_HEIGHT + 42 + CHART_TOP_PAD}`}
                width="100%"
                preserveAspectRatio="xMidYMid meet"
                style={{ display: "block", width: "100%", maxWidth: CHART_WIDTH, margin: "0 auto" }}
              >
                <line x1="0" y1={CHART_HEIGHT * 0.3} x2={CHART_WIDTH} y2={CHART_HEIGHT * 0.3} stroke="var(--color-border)" strokeWidth="1" />
                <line x1="0" y1={CHART_HEIGHT * 0.6} x2={CHART_WIDTH} y2={CHART_HEIGHT * 0.6} stroke="var(--color-border)" strokeWidth="1" />
                <line x1="0" y1={CHART_HEIGHT} x2={CHART_WIDTH} y2={CHART_HEIGHT} stroke={BORDER_COLOR} strokeWidth="1" />
                {trend.map((point, index) => {
                  const height = Math.max(3, (point.scorePercent / 100) * CHART_HEIGHT);
                  const x = index * (barWidth + BAR_GAP);
                  const y = CHART_HEIGHT - height;
                  const color = scoreColor(point.scorePercent);
                  const [, month, day] = point.date.split("-");
                  return (
                    <g key={index}>
                      <rect x={x} y={y} width={barWidth} height={height} rx="6" fill={color} opacity="0.16" />
                      <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" fontSize="11" fontWeight="800" fill={color}>{point.scorePercent}</text>
                      <text x={x + barWidth / 2} y={CHART_HEIGHT + 20} textAnchor="middle" fontSize="10" fill="var(--color-muted)">{month}/{day}</text>
                    </g>
                  );
                })}
                {trend.length > 1 && <path d={trendPath} fill="none" stroke={CYAN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
                {trend.map((point, index) => {
                  const x = barCount <= 1 ? CHART_WIDTH / 2 : index * (CHART_WIDTH / (barCount - 1));
                  const y = CHART_HEIGHT - (point.scorePercent / 100) * CHART_HEIGHT;
                  return <circle key={`dot-${index}`} cx={x} cy={y} r="4.5" fill="var(--color-card)" stroke={scoreColor(point.scorePercent)} strokeWidth="3" />;
                })}
              </svg>
            )}
          </Card>
        </div>

        <div className="stats-bottom-grid">
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 900, color: "var(--color-text-strong)" }}>과목별 성과</h3>
            {courses.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>아직 과목별 기록이 없습니다.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {visibleCourses.map(course => (
                  <button
                    key={course.courseName}
                    type="button"
                    className="stats-course-row"
                    onClick={() => goToCourseReview(course.courseName)}
                    title={`${course.courseName} 자료 복습 열기`}
                    style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ marginBottom: 5, fontSize: 14, fontWeight: 900, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {course.courseName}
                        <span className="tongkk-row-hint" style={{ marginLeft: 8, fontSize: 11, fontWeight: 850, color: CYAN }}>복습 열기 →</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-muted)" }}>{course.attempts}회 · {course.totalQuestions}문제 · {formatStudyTime(course.totalMinutes)} · 정답률 {course.averageScore}%</div>
                    </div>
                    <div style={{ minWidth: 130 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-muted)" }}>진척도</span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: progressColor(course.progressPercent) }}>{course.progressPercent}%</span>
                      </div>
                      <div style={{ height: 8, background: MUTED_SURFACE, borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${course.progressPercent}%`, height: "100%", background: progressColor(course.progressPercent), borderRadius: 999 }} />
                      </div>
                    </div>
                  </button>
                ))}
                {courses.length > 6 && (
                  <button type="button" onClick={() => setShowAllCourses(prev => !prev)} style={{
                    padding: "8px 0", width: "100%", background: "none", border: "none",
                    color: PINK, fontSize: 13, cursor: "pointer", fontWeight: 700,
                  }}>{showAllCourses ? "접기" : `더보기 (${courses.length - 6}개)`}</button>
                )}
              </div>
            )}
          </Card>

          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 900, color: "var(--color-text-strong)" }}>최근 풀이</h3>
            {latest.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>아직 풀이 기록이 없습니다.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {latest.map(attempt => (
                  <button
                    key={attempt.id}
                    type="button"
                    className="tongkk-hover-row"
                    onClick={() => goToAttempt(attempt)}
                    title={attempt.quizSetId ? "저장된 풀이 결과 열기" : `${attempt.courseName} 자료 복습 열기`}
                    style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
                      padding: "12px 0", border: "none", borderBottom: `1px solid ${BORDER_COLOR}`,
                      background: "none", textAlign: "left", cursor: "pointer", width: "100%",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ marginBottom: 5, fontSize: 13.5, fontWeight: 900, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attempt.courseName}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-muted)" }}>{formatDate(attempt.createdAt)} · {attempt.questionType} · {attempt.difficulty} · {attempt.correctCount}/{attempt.count}</div>
                    </div>
                    <span style={{ color: scoreColor(attempt.scorePercent), fontSize: 16, fontWeight: 950 }}>{attempt.scorePercent}%</span>
                  </button>
                ))}
                {!showAllRecent && attempts.length > 5 && (
                  <button type="button" onClick={() => setShowAllRecent(true)} style={{
                    padding: "8px 0", width: "100%", background: "none", border: "none",
                    color: PINK, fontSize: 13, cursor: "pointer", fontWeight: 700,
                  }}>더보기 ({attempts.length - 5}개)</button>
                )}
                {showAllRecent && attempts.length > 5 && (
                  <button type="button" onClick={() => setShowAllRecent(false)} style={{
                    padding: "8px 0", width: "100%", background: "none", border: "none",
                    color: PINK, fontSize: 13, cursor: "pointer", fontWeight: 700,
                  }}>접기</button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
