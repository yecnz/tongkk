// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course-id', name: '테스트' }] }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: async () => [{ id: 'material-id', name: '강의 자료' }] }));
vi.mock('../../services/learningSessions', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/learningSessions')>(), learningRequest: request,
}));
vi.mock('./LearningResume', () => ({ default: () => null }));
vi.mock('./ReviewOverview', () => ({ default: () => null }));
import LearningSession from '../../pages/LearningSession';
import { LearningApiError } from '../../services/learningSessions';
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  request.mockReset();
  request.mockImplementation(async (path: string) => path.startsWith('/scopes?')
    ? { source_hash: 'source-hash', total_chars: 100, max_chars: 12000,
      units: [{ id: 'p1', label: '1페이지', page: 1, chars: 100 }] }
    : { id: 'created' });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/learn?course=테스트&material=material-id'] },
    h(Routes, null, h(Route, { path: '/learn', element: h(LearningSession) }),
      h(Route, { path: '/learn/created', element: h('p', null, '학습 시작됨') })))));
}
async function choose(name: string, value: string) {
  await act(async () => (container.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement).click());
}
async function start() {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(b => /학습 시작|이전 요청 결과 확인/.test(b.textContent || ''))!;
    button.click();
  });
}

it('submits the chosen mode, time and concept count with the selected material scope', async () => {
  await render();
  await choose('learning-mode', 'new'); await choose('learning-minutes', '20'); await choose('learning-count', '3');
  expect(container.textContent).toContain('목표 20분');
  expect(container.querySelector('[aria-label="학습 순서"]')?.textContent).toContain('짧은 설명');
  await start();
  const create = request.mock.calls.find(call => call[1] === 'POST')!;
  expect(create[2]).toMatchObject({ course_id: 'course-id', material_id: 'material-id', source_hash: 'source-hash',
    familiarity: 'new', target_minutes: 20, concept_count: 3, scope: { type: 'all' } });
  expect(container.textContent).toContain('학습 시작됨');
});

it('locks settings after an ambiguous failure and replays the identical start request', async () => {
  await render();
  request.mockImplementationOnce(async () => { throw new LearningApiError('일시적인 서버 오류', 503, 'UNAVAILABLE'); });
  await start();
  const first = request.mock.calls.find(call => call[1] === 'POST')![2];
  expect((container.querySelector('input[name="learning-mode"]') as HTMLInputElement).matches(':disabled')).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('일시적인 서버 오류');
  expect(container.textContent).toContain('이전 요청 결과 확인');
  await start();
  const creates = request.mock.calls.filter(call => call[1] === 'POST');
  expect(creates[1][2]).toEqual(first);
  expect(container.textContent).toContain('학습 시작됨');
});
