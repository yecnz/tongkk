// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IssueDetail } from '../../services/workflow';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/workflow', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/workflow')>(),
  workflowRequest: mocks.request,
}));
import LearningIssues from './LearningIssues';

let root: Root, container: HTMLDivElement;
function detail(status: IssueDetail['issue']['status'] = 'needs_confirmation'): IssueDetail {
  return {
    issue: { id: 'issue', concept_id: 'concept', title: '프로세스', course_id: 'course', material_id: 'material', status, revision: 4, updated_at: '2026-11-25T12:00:00Z' },
    concept: { id: 'concept', title: '프로세스', course_id: 'course', material_id: 'material', source_refs: [{ unit_id: 'unit', quote: '실행 중인 프로그램' }] },
    evidence: [{ id: 'answer', source_kind: 'recall', outcome: 'uncertain', assisted: false, session_id: 'session', item_id: 'item', created_at: '2026-11-25T12:00:00Z', answer: '프로그램을 실행한 상태' }],
    events: [
      { id: 'recent', action: 'reassess', created_at: '2026-11-25T12:00:00Z' },
      { id: 'second', action: 'start', created_at: '2026-11-24T12:00:00Z' },
      { id: 'older', action: 'evidence', created_at: '2026-11-23T12:00:00Z' },
    ],
    review_card_id: 'card',
  };
}
function button(label: string) {
  const element = [...container.querySelectorAll('button')].find(value => value.textContent === label);
  if (!element) throw new Error(`Button not found: ${label}`);
  return element;
}
async function render(data: IssueDetail) {
  mocks.request.mockImplementation((path: string) => Promise.resolve(path.includes('?offset=') ? { issues: [data.issue], total: 1 } : data));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/review?tab=issues&issueId=issue'] }, h(LearningIssues))));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('keeps source and answer evidence distinct and shows the two latest changes without expanding', async () => {
  await render(detail());
  expect(container.querySelector('[aria-label="원문 근거"]')?.textContent).toContain('실행 중인 프로그램');
  expect(container.querySelector('[aria-label="학습 근거"]')?.textContent).toContain('프로그램을 실행한 상태');
  expect(container.querySelector('.learning-issue-status')?.closest('details')).toBeNull();
  expect(container.querySelector('.learning-issue-status')?.textContent).toContain('직접 확인한 표시는 AI 평가 결과와 구분해요.');
  const history = container.querySelector('[aria-label="상태 변경 이력"]')!;
  expect([...history.querySelectorAll(':scope > ul li')].map(row => row.querySelector('span')?.textContent)).toEqual(['다시 확인 예정', '복습 중으로 표시']);
  const older = history.querySelector('details')!;
  expect(older.open).toBe(false);
  expect(older.querySelector('summary')?.textContent).toBe('이전 변경 1개');
  await act(async () => older.querySelector('summary')!.click());
  expect(older.open).toBe(true);
  expect(older.textContent).toContain('확인할 근거 추가');
  expect(container.querySelector('a[href="/learn/review/card"]')?.textContent).toBe('기존 문제로 다시 확인하기 →');
});

it('retries an uncertain status save with the same command and blocks competing actions', async () => {
  const data = detail();
  await render(data);
  mocks.request.mockRejectedValueOnce(new Error('저장 응답을 받지 못했어요.'));
  await act(async () => button('복습 중으로 표시').click());
  const firstRequest = mocks.request.mock.calls.at(-1)!;
  expect(firstRequest).toEqual(['/learning-issues/issue/actions', 'POST', expect.objectContaining({ action: 'start', revision: 4, command_key: expect.any(String) })]);
  expect(button('다시 확인할 항목으로').disabled).toBe(true);
  expect(button('확인 완료로 표시').disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('저장 응답을 받지 못했어요.');
  mocks.request.mockResolvedValueOnce({ ...data, issue: { ...data.issue, status: 'in_progress', revision: 5 } });
  await act(async () => button('이전 저장 결과 확인').click());
  expect(mocks.request.mock.calls.at(-1)).toEqual(firstRequest);
  expect(container.querySelector('.workflow-badge')?.textContent).toBe('복습 중');
  expect(button('확인 완료로 표시').disabled).toBe(false);
});

it.each([['closed', '직접 확인함'], ['resolved', '평가로 확인됨']] as const)('distinguishes %s from the other completion type and preserves reopening', async (status, label) => {
  const data = { ...detail(status), events: [] };
  await render(data);
  expect(container.querySelector('.workflow-badge')?.textContent).toBe(label);
  expect(container.querySelector('[aria-label="상태 변경 이력"]')).toBeNull();
  expect(container.querySelector('details')).toBeNull();
  mocks.request.mockResolvedValueOnce(detail());
  await act(async () => button('다시 확인하기').click());
  expect(mocks.request).toHaveBeenLastCalledWith('/learning-issues/issue/actions', 'POST', expect.objectContaining({ action: 'reopen', revision: 4 }));
  expect(container.querySelector('.workflow-badge')?.textContent).toBe('확인 필요');
});
