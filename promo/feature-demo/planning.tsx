import { useState } from 'react';
import Calendar from '../../src/pages/Calendar';
import Stats from '../../src/pages/Stats';
import LearningBriefing from '../../src/features/review/LearningBriefing';
import LearningResume from '../../src/features/learningSession/LearningResume';
import PlanningPlan from './planning-plan';
export { handlePlanningRequest } from './planning-workflow';

function ResumeDemo() {
  const [resumedAt] = useState(() => Date.now());
  return <main className="workflow-surface workflow-stack" style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
    <LearningBriefing resumePoint={{ route: '/quiz', course: '알고리즘', title: '정렬 알고리즘 확인 퀴즈', activity: '퀴즈 2번 문제', state: { course: '알고리즘', quizSetId: 'quiz-demo', openQuiz: true }, at: resumedAt }} />
    <LearningResume variant="page" />
  </main>;
}
function PlanDemo() {
  const [view, setView] = useState('today');
  return <><nav className="workflow-tabs" aria-label="학습 계획 보기" style={{ padding: '16px 24px 0' }}>
    <button type="button" aria-pressed={view === 'today'} onClick={() => setView('today')}>오늘 할 일 · AI 학습 계획</button>
    <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>학습 캘린더 · 페이스 플랜</button>
  </nav>{view === 'calendar' ? <Calendar /> : <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}><PlanningPlan /></main>}</>;
}
export const planningScreens = { resume: ResumeDemo, plan: PlanDemo, stats: Stats };
