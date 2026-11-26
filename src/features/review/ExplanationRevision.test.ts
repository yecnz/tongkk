// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' } }) }));
vi.mock('../../services/workflow', () => ({ workflowRequest: mocks.request, WorkflowError: class extends Error {} }));
import ExplanationRevision from './ExplanationRevision';
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
it('reconciles a lost submit response after reload and allows saved navigation', async () => {
  localStorage.setItem('tongkk:revision:u:r', JSON.stringify({ text: '수정 설명', baseRevision: 1, pending: { expected_revision: 1, command_key: 'evaluation' } }));
  mocks.request.mockResolvedValue({ title: '프로세스', question: '설명해 주세요', baseline: '처음 설명', baseline_feedback: null, source_changed: false,
    revision: { id: 'r', session_id: 's', item_id: 'item', answer: '수정 설명', revision: 1, status: 'graded' },
    evaluation: { id: 'evaluation', status: 'graded', feedback: null } });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/learn/s/revisions/r'] }, h(Routes, null,
    h(Route, { path: '/learn/:sessionId/revisions/:revisionId', element: h(ExplanationRevision) }), h(Route, { path: '/', element: h('p', null, '대시보드 도착') })))));
  expect(localStorage.getItem('tongkk:revision:u:r')).toBeNull();
  await act(async () => (container.querySelector('.learning-header-back') as HTMLAnchorElement).click());
  expect(container.textContent).toContain('대시보드 도착');
});
