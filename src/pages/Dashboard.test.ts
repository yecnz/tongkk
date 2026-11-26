// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null },
  courses: { courses: [] as string[], hasLoadedCourses: true, addCourse: vi.fn(), renameCourse: vi.fn(), deleteCourse: vi.fn() },
  requireAuth: vi.fn(), ready: vi.fn(), toast: vi.fn(),
  summaries: vi.fn(), materialCount: vi.fn(), summaryCount: vi.fn(), quizCount: vi.fn(),
}));
vi.mock('../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../CourseContext', () => ({ useCourses: () => mocks.courses }));
vi.mock('../AuthGateContext', () => ({ useAuthGate: () => ({ requireAuth: mocks.requireAuth }) }));
vi.mock('../TutorialContext', () => ({ useTutorial: () => ({ ready: mocks.ready, open: vi.fn() }) }));
vi.mock('../SampleDemoContext', () => ({ useSampleDemo: () => ({ openSampleDemo: vi.fn() }) }));
vi.mock('../ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../services/dashboardState', () => ({
  loadDashboardState: async (_key: string, fallback: unknown) => fallback,
  saveDashboardState: async () => {},
}));
vi.mock('../services/materials', async importOriginal => ({
  ...await importOriginal<typeof import('../services/materials')>(), countCourseMaterialsFromServer: mocks.materialCount,
}));
vi.mock('../services/summaries', async importOriginal => ({
  ...await importOriginal<typeof import('../services/summaries')>(), loadSummariesFromServer: mocks.summaries, countSummariesFromServer: mocks.summaryCount,
}));
vi.mock('../services/quizSets', async importOriginal => ({
  ...await importOriginal<typeof import('../services/quizSets')>(), countQuizSetsFromServer: mocks.quizCount,
}));
vi.mock('../services/quizAttempts', () => ({ loadQuizAttemptsFromServer: async () => [] }));
vi.mock('../features/review/LearningBriefing', () => ({ default: () => null }));
vi.mock('../features/review/LearningRecommendations', () => ({ default: () => null }));
import Dashboard from './Dashboard';

let root: Root, container: HTMLDivElement;
function Destination() {
  const location = useLocation();
  return h('output', null, JSON.stringify({ path: location.pathname, state: location.state }));
}
async function render() {
  await act(async () => root.render(h(MemoryRouter, null, h(Routes, null,
    h(Route, { path: '/', element: h(Dashboard) }),
    h(Route, { path: '/summary', element: h(Destination) }),
  ))));
}
function reviewButton() {
  return Array.from(container.querySelectorAll('button')).find(button => button.textContent === '자료 복습하기')!;
}
function destination() {
  return JSON.parse(container.querySelector('output')!.textContent!);
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.auth.user = null;
  mocks.courses.courses = [];
  mocks.courses.hasLoadedCourses = true;
  mocks.requireAuth.mockImplementation(() => Boolean(mocks.auth.user));
  mocks.summaries.mockReset().mockResolvedValue([]);
  mocks.materialCount.mockReset().mockResolvedValue(0);
  mocks.summaryCount.mockReset().mockResolvedValue(0);
  mocks.quizCount.mockReset().mockResolvedValue(0);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps both review entries available on first launch and guides guests to login', async () => {
  await render();
  expect(container.querySelector('a[href="/review?tab=wrong"]')).toBeTruthy();
  expect(reviewButton().disabled).toBe(false);
  await act(async () => reviewButton().click());
  expect(mocks.requireAuth).toHaveBeenCalledWith('자료를 복습하려면 로그인이 필요해요');
  expect(mocks.summaries).not.toHaveBeenCalled();
});

it('opens course creation when a signed-in user has no courses', async () => {
  mocks.auth.user = { id: 'u' };
  await render();
  await act(async () => reviewButton().click());
  expect(container.querySelector('input[aria-label="과목명"]')).toBeTruthy();
  expect(mocks.summaries).not.toHaveBeenCalled();
});

it.each(['loading', 'empty', 'error'])('opens an existing course while material counts are %s', async status => {
  mocks.auth.user = { id: 'u' };
  mocks.courses.courses = ['운영체제'];
  if (status === 'loading') mocks.materialCount.mockImplementation(() => new Promise(() => {}));
  if (status === 'error') mocks.materialCount.mockRejectedValue(new Error('offline'));
  await render();
  expect(reviewButton().disabled).toBe(false);
  await act(async () => reviewButton().click());
  expect(destination()).toEqual({ path: '/summary', state: { selectedCourse: '운영체제', fromDashboard: true } });
});

it('keeps the latest summary shortcut when review materials exist', async () => {
  mocks.auth.user = { id: 'u' };
  mocks.courses.courses = ['운영체제', '자료구조'];
  mocks.summaryCount.mockImplementation(async (course: string) => course === '자료구조' ? 2 : 0);
  mocks.summaries.mockResolvedValue([
    { createdAt: 100, materialIds: ['old-material'] },
    { createdAt: 200, materialIds: ['latest-material'] },
  ]);
  await render();
  await act(async () => reviewButton().click());
  expect(mocks.summaries).toHaveBeenCalledWith('자료구조');
  expect(destination().state).toMatchObject({ selectedCourse: '자료구조', materialId: 'latest-material', viewMaterial: true, materialDetailTab: 'summary' });
});

it('blocks repeated clicks only while a summary lookup is pending', async () => {
  mocks.auth.user = { id: 'u' };
  mocks.courses.courses = ['운영체제'];
  let finish!: (value: never[]) => void;
  mocks.summaries.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => reviewButton().click());
  expect(container.querySelector<HTMLButtonElement>('button[aria-busy="true"]')?.disabled).toBe(true);
  expect(mocks.summaries).toHaveBeenCalledTimes(1);
  await act(async () => finish([]));
  expect(destination().path).toBe('/summary');
});
