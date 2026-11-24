// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ courses: vi.fn(), materials: vi.fn(), agent: vi.fn(), user: { id: 'user' } }));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock('../components/LoginModal', () => ({ default: () => null }));
vi.mock('../services/courses', () => ({ fetchCourses: mocks.courses }));
vi.mock('../services/materials', () => ({ loadCourseMaterialsFromServer: mocks.materials }));
vi.mock('../services/dashboardState', () => ({ loadDashboardState: async () => [], saveDashboardState: vi.fn() }));
vi.mock('../services/agent', () => ({ sendAgentMessage: mocks.agent, AgentThreadExpiredError: class extends Error {} }));
vi.mock('../components/AITutorDrawer', () => ({ FormattedTutorText: () => null }));
vi.mock('../common', async importOriginal => ({ ...await importOriginal<typeof import('../common')>(), parseAiSuggestions: () => ({ mainContent: '', suggestions: [] }) }));
import Mini from './Mini';
import MiniTutor from './MiniTutor';

let root: Root;
let container: HTMLDivElement;
function element<T extends HTMLElement = HTMLButtonElement>(selector: string) {
  const found = container.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found!;
}
async function click(selector: string) { await act(async () => element(selector).click()); }
async function render(path = '/mini') {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null,
    h(Route, { path: '/mini', element: h(Mini) }),
    h(Route, { path: '/mini/tutor', element: h(MiniTutor) }),
  ))));
}
async function escape(selector: string) {
  await act(async () => element(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
}
function retry() {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '다시 시도')!;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.courses.mockReset().mockResolvedValue([{ id: 'course', name: '자료구조' }]);
  mocks.materials.mockReset().mockResolvedValue([{ id: 'material', name: '아주 긴 강의자료 이름.pdf', markdown: '원문' }]);
  mocks.agent.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  expect(mocks.agent).not.toHaveBeenCalled();
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it('does not show the no-course message while courses are still loading', async () => {
  let resolve!: (items: { id: string; name: string }[]) => void;
  mocks.courses.mockReturnValue(new Promise(r => { resolve = r; }));
  await render(); await click('.mini-material-trigger');
  expect(container.textContent).toContain('과목 불러오는 중…');
  expect(container.textContent).not.toContain('아직 등록된 과목이 없어요.');
  await act(async () => resolve([{ id: 'course', name: '자료구조' }]));
  expect(container.textContent).not.toContain('과목 불러오는 중…');
  await click('.mini-select-toggle');
  expect(container.textContent).toContain('자료구조');
});

it('shows the empty-course state only after a successful empty response', async () => {
  mocks.courses.mockResolvedValue([]);
  await render(); await click('.mini-material-trigger');
  expect(container.textContent).toContain('아직 등록된 과목이 없어요.');
  expect(element<HTMLAnchorElement>('.mini-panel-empty a').getAttribute('href')).toBe('/');
});

it('retries a failed course load without presenting it as an empty account', async () => {
  mocks.courses.mockRejectedValueOnce(new Error('offline'));
  await render(); await click('.mini-material-trigger');
  expect(container.textContent).toContain('과목을 불러오지 못했어요.');
  expect(container.textContent).not.toContain('아직 등록된 과목이 없어요.');
  await act(async () => retry().click());
  await click('.mini-select-toggle');
  expect(container.textContent).toContain('자료구조');
  expect(mocks.courses).toHaveBeenCalledTimes(2);
});

it('can retry materials for the same course and retain the selected material', async () => {
  mocks.materials.mockRejectedValueOnce(new Error('offline'));
  await render(); await click('.mini-material-trigger'); await click('.mini-select-toggle'); await click('.mini-select-options button');
  expect(container.textContent).toContain('자료를 불러오지 못했어요.');
  await act(async () => retry().click());
  expect(mocks.materials).toHaveBeenCalledTimes(2);
  await click('.mini-select-field:nth-of-type(3) .mini-select-toggle');
  expect(container.textContent).not.toContain('자료 선택 안 함');
  await click('.mini-select-options button');
  expect(container.querySelector('.mini-material-panel')).toBeNull();
  expect(element('.mini-material-trigger').title).toBe('아주 긴 강의자료 이름.pdf');
});

it('Escape closes a course list first, then the enclosing mini panel', async () => {
  await render(); await click('.mini-material-trigger'); await click('.mini-select-toggle');
  await escape('.mini-select-options button');
  expect(container.querySelector('.mini-select-options')).toBeNull();
  expect(container.querySelector('.mini-material-panel')).not.toBeNull();
  expect(document.activeElement).toBe(element('.mini-select-toggle'));
  await escape('.mini-select-toggle');
  expect(container.querySelector('.mini-material-panel')).toBeNull();
});

it('Escape closes the tutor selector without discarding the question draft, then returns to mini', async () => {
  await render('/mini/tutor');
  await act(async () => {
    const input = element<HTMLInputElement>('.mini-tutor-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '작성 중 질문');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('.mini-tutor-source > summary');
  expect(element<HTMLDetailsElement>('details').open).toBe(true);
  await click('.mini-select-toggle'); await escape('.mini-select-options button');
  expect(element<HTMLDetailsElement>('details').open).toBe(true);
  await escape('.mini-select-toggle');
  expect(element<HTMLDetailsElement>('details').open).toBe(false);
  expect(element<HTMLInputElement>('.mini-tutor-input').value).toBe('작성 중 질문');
  await escape('.mini-tutor-input');
  expect(container.querySelector('.mini-card')).not.toBeNull();
});

it('the tutor back button returns to the mini screen without calling the agent', async () => {
  await render('/mini/tutor'); await click('.mini-window-back');
  expect(container.querySelector('.mini-card')).not.toBeNull();
});
