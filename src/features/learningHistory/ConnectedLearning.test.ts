// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), user: { id: 'user' } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../services/workflow', () => ({ workflowRequest: mocks.request }));
vi.mock('../learningSession/LearningLayout', () => ({ default: ({ children }: { children: ReactNode }) => h('div', null, children) }));
vi.mock('../learningSession/LearningLink', () => ({ default: ({ children, to }: { children: ReactNode; to: string }) => h('a', { href: to }, children) }));
vi.mock('../learningSession/LearningRunner', () => ({ default: ({ id, onCompletedChange, completionActions }: { id: string; onCompletedChange: (v: boolean) => void; completionActions?: ReactNode }) => h('section', null, h('p', null, id), h('button', { onClick: () => onCompletedChange(true) }, '이 개념 학습 완료'), completionActions) }));
import ConnectedLearning, { type StudyPath } from './ConnectedLearning';
let root: Root, container: HTMLDivElement;
let path: StudyPath;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.request.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  path = { id: 'path', target_id: 'target', status: 'active', position: 0, steps: ['기초 개념', '다음 개념'].map((title, position) => ({ position, title, concept_id: position ? 'target' : 'prior', reason: '순서대로 학습', course_name: '운영체제', session_id: `session-${position}`, session_status: 'active', session_complete: false, source_changed: false })) };
  mocks.request.mockImplementation(async (url: string, _method?: string, body?: { position: number }) => {
    if (url.endsWith('/next')) {
      path.steps[body!.position].session_complete = true;
      path.position = Math.max(path.position, body!.position + 1);
      if (path.position === path.steps.length) path.status = 'completed';
    }
    return structuredClone(path);
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (entry = '/learn/connected/target') => act(async () => root.render(h(MemoryRouter, { initialEntries: [entry] }, h(Routes, null, h(Route, { path: '/learn/connected/:conceptId', element: h(ConnectedLearning) })))));
const click = async (text: string) => act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === text)!.click());

it('starts without manual relationship settings and continues only after each concept is completed', async () => {
  await render();
  expect(mocks.request).toHaveBeenCalledWith('/learning-graph/paths', 'POST', expect.objectContaining({ concept_id: 'target', idempotency_key: expect.any(String) }));
  expect(container.textContent).toContain('session-0');
  expect(container.textContent).not.toContain('다음 개념:');
  await click('이 개념 학습 완료'); await click('다음 개념: 다음 개념 →');
  expect(mocks.request).toHaveBeenCalledWith('/learning-graph/paths/path/next', 'POST', { position: 0 });
  expect(container.textContent).toContain('session-1');
  await click('이 개념 학습 완료'); await click('학습 마치기');
  expect(container.textContent).toContain('연결된 개념 학습을 마쳤어요');
});

it('resumes the saved position and session from its URL', async () => {
  path.position = 1;
  await render('/learn/connected/target?path=path');
  expect(container.textContent).toContain('session-1');
  expect(container.textContent).not.toContain('session-0');
  expect(mocks.request.mock.calls.every(call => call[1] !== 'POST')).toBe(true);
});

it('retries a failed start with the same idempotency key', async () => {
  mocks.request.mockRejectedValueOnce(new Error('연결을 확인해주세요.'));
  await render();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('연결을 확인해주세요.');
  expect(container.textContent).not.toContain('준비하는 중');
  const firstKey = mocks.request.mock.calls[0][2].idempotency_key;
  await click('다시 확인');
  expect(mocks.request.mock.calls.find((call, index) => index > 0 && call[1] === 'POST')?.[2].idempotency_key).toBe(firstKey);
  expect(container.textContent).toContain('session-0');
});
