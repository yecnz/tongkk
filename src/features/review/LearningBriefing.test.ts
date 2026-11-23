// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sessions: vi.fn(), reviews: vi.fn(), issues: vi.fn(), auth: { user: { id: 'u' } as { id: string } | null } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../services/learningSessions', () => ({ listLearningSessions: mocks.sessions }));
vi.mock('../../services/reviews', () => ({ reviewRequest: mocks.reviews }));
vi.mock('../../services/workflow', () => ({ workflowRequest: mocks.issues }));
import LearningBriefing from './LearningBriefing';
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.auth.user = { id: 'u' }; mocks.sessions.mockReset(); mocks.reviews.mockReset(); mocks.issues.mockResolvedValue({ issues: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('keeps available resume links when review retrieval fails, then retries', async () => {
  mocks.sessions.mockResolvedValue({ sessions: [{ id: 'session', material_name: '운영체제' }] });
  mocks.reviews.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ cards: [{ id: 'card', title: '프로세스', source_changed: false }] });
  await act(async () => root.render(h(MemoryRouter, null, h(LearningBriefing))));
  expect(container.querySelector('a[href="/learn/session"]')).toBeTruthy();
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('a[href="/learn/review/card"]')).toBeTruthy();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('does not request private data for guests', async () => {
  mocks.auth.user = null;
  await act(async () => root.render(h(MemoryRouter, null, h(LearningBriefing))));
  expect(mocks.sessions).not.toHaveBeenCalled(); expect(mocks.reviews).not.toHaveBeenCalled();
});
