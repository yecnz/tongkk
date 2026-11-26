// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Plan } from '../services/studyPlanner';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../services/dashboardState', () => ({ loadDashboardState: mocks.load, saveDashboardState: mocks.save }));
import { useCalendarState } from './useCalendarState';

let root: Root, container: HTMLDivElement, state: ReturnType<typeof useCalendarState>;
const plan: Plan = { id: 'p', text: '읽기', done: false, date: '2026-11-26' };
function Harness({ userId = 'u' }: { userId?: string }) {
  const next = useCalendarState(userId);
  useEffect(() => { state = next; });
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function render(userId = 'u') { await act(async () => root.render(<Harness userId={userId} />)); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.load.mockReset().mockImplementation(async (key: string) => key === 'plans' ? [plan] : []);
  mocks.save.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('loads existing data without writing it back and blocks edits until all initial reads finish', async () => {
  const initial = deferred<Plan[]>();
  mocks.load.mockImplementation(async (key: string) => key === 'plans' ? initial.promise : []);
  await render();
  expect(state.loading).toBe(true);
  expect(state.canEdit).toBe(false);
  await act(async () => state.setPlans([{ ...plan, text: 'premature edit' }]));
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => initial.resolve([plan]));
  expect(state.plans).toEqual([plan]);
  expect(state.canEdit).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('shows a failed load and retries without overwriting the server with an empty calendar', async () => {
  mocks.load.mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(state.loadError).toContain('불러오지 못했어요');
  expect(state.canEdit).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => state.retryLoad());
  expect(state.loadError).toBe('');
  expect(state.plans).toEqual([plan]);
  expect(state.canEdit).toBe(true);
});

it('keeps failed edits visible and retries the exact change before enabling further edits', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'));
  await render();
  await act(async () => state.setPlans(previous => previous.map(item => ({ ...item, done: true }))));
  expect(state.saveError).toContain('저장하지 못했어요');
  expect(state.plans[0].done).toBe(true);
  expect(state.canEdit).toBe(false);
  await act(async () => state.setPlans([]));
  expect(state.plans).toHaveLength(1);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => state.retrySave());
  expect(mocks.save).toHaveBeenLastCalledWith('plans', [{ ...plan, done: true }]);
  expect(state.saveError).toBe('');
  expect(state.canEdit).toBe(true);
});

it('serializes edits while a save is pending so late writes cannot overwrite newer input', async () => {
  const save = deferred<void>(); mocks.save.mockReturnValueOnce(save.promise);
  await render();
  await act(async () => {
    state.setPlans([{ ...plan, done: true }]);
    state.setPlans([]);
  });
  expect(state.saving).toBe(true);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(state.plans).toHaveLength(1);
  await act(async () => save.resolve());
  await act(async () => state.setPlans([]));
  expect(mocks.save).toHaveBeenLastCalledWith('plans', []);
});

it('ignores an old account load after a new account starts editing', async () => {
  const old = deferred<Plan[]>();
  mocks.load.mockImplementation(async (key: string) => key === 'plans' ? old.promise : []);
  await render('old');
  mocks.load.mockImplementation(async () => []);
  await render('new');
  await act(async () => state.setPlans([{ ...plan, text: '새 계정의 일정' }]));
  await act(async () => old.resolve([plan]));
  expect(state.plans[0].text).toBe('새 계정의 일정');
});
