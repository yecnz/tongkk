import type { Dday, Plan } from '../../src/services/studyPlanner';
import type { PacePlan } from '../../src/services/pace';
export type { DashboardStateKey, ResumePoint } from '../../src/services/dashboardState';

export const demoDay = (offset = 0) => {
  const date = new Date(); date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
export const demoDdays: Dday[] = [
  { id: 'exam-demo', type: 'exam', subj: '알고리즘 중간고사', date: demoDay(7) },
  { id: 'assignment-demo', type: 'assignment', subj: '정렬 알고리즘 비교 과제', date: demoDay(3) },
];
export const demoPlans: Plan[] = [
  { id: 'plan-summary', text: '시간 복잡도 핵심 개념 정리 15분', done: true, minutes: 15, action: 'review_summary', course: '알고리즘', date: demoDay() },
  { id: 'plan-quiz', text: '퀵 정렬과 병합 정렬 비교 퀴즈 15분', done: false, minutes: 15, action: 'retry_quiz', course: '알고리즘', date: demoDay() },
  { id: 'plan-review', text: '헷갈린 정렬 개념을 내 말로 설명하기 15분', done: false, minutes: 15, action: 'review_wrong', course: '알고리즘', date: demoDay(1) },
];
const state: Record<string, unknown> = {
  ddays: demoDdays,
  plans: demoPlans,
  pacePlans: [{ id: 'pace-demo', course: '알고리즘', ddayId: 'exam-demo', totalUnits: 24, doneUnits: 6, createdAt: Date.now() - 2 * 86400000, unitLabel: '페이지', basis: 'pages' }] satisfies PacePlan[],
  resume: { route: '/quiz', course: '알고리즘', title: '정렬 알고리즘 확인 퀴즈', activity: '퀴즈 2번 문제', state: { course: '알고리즘', quizSetId: 'quiz-demo', openQuiz: true }, at: Date.now() },
  menubarReminders: [],
};
export async function loadDashboardState<T>(key: string, fallback: T): Promise<T> { return structuredClone((state[key] ?? fallback) as T); }
export async function saveDashboardState<T>(key: string, value: T): Promise<void> { state[key] = structuredClone(value); }
export async function removeDashboardState(key: string): Promise<void> { delete state[key]; }
export function saveResumePoint(point: Record<string, unknown>): void { state.resume = { ...point, at: Date.now() }; }
