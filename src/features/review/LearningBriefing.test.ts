// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sessions: vi.fn(), auth: { user: { id: 'u' } as { id: string } | null } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../services/learningSessions', () => ({ listLearningSessions: mocks.sessions }));
import LearningBriefing from './LearningBriefing';
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.auth.user = { id: 'u' }; mocks.sessions.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('keeps the last material available when sessions fail, then retries', async () => {
  mocks.sessions.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ sessions: [{ id: 'session', material_name: '운영체제', status: 'active' }] });
  await act(async () => root.render(h(MemoryRouter, null, h(LearningBriefing, { resumePoint: { route: '/summary', course: '운영체제', title: '프로세스 요약', activity: '자료 요약', state: { materialId: 'material' }, at: 1 } }))));
  expect(container.querySelector('a[href="/summary"]')).toBeTruthy();
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('a[href="/learn/session"]')).toBeTruthy();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('shows only one unfinished explanation session', async () => {
  mocks.sessions.mockResolvedValue({ sessions: [
    { id: 'completed', material_name: '완료한 학습', status: 'completed' },
    { id: 'active', material_name: '진행 중 학습', status: 'active' },
    { id: 'paused', material_name: '멈춘 학습', status: 'paused' },
  ] });
  await act(async () => root.render(h(MemoryRouter, null, h(LearningBriefing))));
  expect(container.querySelectorAll('li')).toHaveLength(1);
  expect(container.querySelector('a[href="/learn/active"]')).toBeTruthy();
  expect(container.textContent).not.toContain('완료한 학습');
});
it('does not request private data for guests', async () => {
  mocks.auth.user = null;
  await act(async () => root.render(h(MemoryRouter, null, h(LearningBriefing))));
  expect(mocks.sessions).not.toHaveBeenCalled();
});
