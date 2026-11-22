// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), user: { id: 'user' } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../services/learningSessions', () => ({ listLearningSessions: mocks.list }));
import LearningResume from './LearningResume';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.list.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(variant: 'dashboard' | 'page' = 'dashboard') {
  await act(async () => root.render(h(MemoryRouter, null, h(LearningResume, { variant }))));
}
it('shows loading until the request completes instead of showing an empty list', async () => {
  let finish!: (value: { sessions: [] }) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render();
  expect(container.querySelector('[role="status"]')?.textContent).toContain('불러오는 중');
  expect(container.textContent).not.toContain('진행 중인 학습이 없어요');
  await act(async () => finish({ sessions: [] })); expect(container.textContent).toContain('진행 중인 학습이 없어요');
});
it('offers a retry after a list failure and then restores the resume links', async () => {
  mocks.list.mockRejectedValueOnce(new Error('unavailable')); await render('page');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('불러오지 못했어요');
  mocks.list.mockResolvedValueOnce({ sessions: [{ id: 'paused', material_name: '강의자료', status: 'paused' }] });
  await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
  expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('일시 중단');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/learn/paused');
  expect(container.textContent).not.toContain('학습 시작 →');
});
it('keeps the dashboard entry and limits resume links to five', async () => {
  mocks.list.mockResolvedValueOnce({ sessions: Array.from({ length: 7 }, (_, index) => ({ id: String(index), material_name: `자료 ${index}`, status: 'active' })) });
  await render(); expect(container.querySelector('a')?.getAttribute('href')).toBe('/learn');
  expect(container.querySelectorAll('li')).toHaveLength(5);
});
