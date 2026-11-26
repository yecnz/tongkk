// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ reviews: vi.fn(), concepts: vi.fn(), auth: { user: { id: 'u' } as { id: string } | null } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../services/reviews', () => ({ reviewRequest: mocks.reviews }));
vi.mock('../../services/workflow', () => ({ workflowRequest: mocks.concepts }));
import LearningRecommendations from './LearningRecommendations';
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.auth.user = { id: 'u' };
  mocks.reviews.mockReset(); mocks.concepts.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('keeps issues when reviews fail and restores reviews on retry', async () => {
  mocks.reviews.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ cards: [{ id: 'card', concept_id: 'review', title: '프로세스', source_changed: false }] });
  mocks.concepts.mockResolvedValue({ issues: [{ id: 'issue', concept_id: 'issue', title: '교착 상태' }] });
  await act(async () => root.render(h(MemoryRouter, null, h(LearningRecommendations, { items: [] }))));
  expect(Array.from(container.querySelectorAll('a'), link => link.getAttribute('href'))).toContain('/review?tab=issues&issueId=issue');
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('a[href="/learn/review/card"]')).toBeTruthy();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it('prioritizes urgent schedules, limits the list, and excludes changed or duplicate concepts', async () => {
  mocks.reviews.mockResolvedValue({ cards: [
    { id: 'changed', title: '바뀐 원문', source_changed: true },
    { id: 'card-1', concept_id: 'c1', title: '스레드', source_changed: false },
    { id: 'card-2', concept_id: 'c2', title: '메모리', source_changed: false },
  ] });
  mocks.concepts.mockResolvedValue({ issues: [{ id: 'duplicate', concept_id: 'c1', title: '중복 이슈' }], prerequisites: [{ concept_id: 'prior', title: '선행 개념', reason: '먼저 보완' }] });
  await act(async () => root.render(h(MemoryRouter, null, h(LearningRecommendations, { items: [
    { title: '임박한 시험', reason: 'D-1', urgent: true, target: { kind: 'calendar' } },
    { title: '추가 추천', reason: 'D-7', urgent: false, target: { kind: 'calendar' } },
  ] }))));
  expect(container.querySelectorAll('li')).toHaveLength(4);
  expect(container.querySelector('li')!.textContent).toContain('임박한 시험');
  expect(Array.from(container.querySelectorAll('a'), link => link.getAttribute('href'))).toContain('/stats?view=concepts&conceptId=prior');
  expect(container.textContent).not.toContain('바뀐 원문');
  expect(container.textContent).not.toContain('중복 이슈');
});
it('keeps public schedule suggestions without requesting private recommendations for guests', async () => {
  mocks.auth.user = null;
  await act(async () => root.render(h(MemoryRouter, null, h(LearningRecommendations, { items: [{ title: '일정', reason: 'D-1', urgent: true, target: { kind: 'calendar' } }] }))));
  expect(mocks.reviews).not.toHaveBeenCalled(); expect(mocks.concepts).not.toHaveBeenCalled();
  expect(container.querySelector('a[href="/calendar"]')).toBeTruthy();
});
