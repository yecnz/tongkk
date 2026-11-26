// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: { id: 'user' }, request: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../common', () => ({ Card: ({ children }: { children: React.ReactNode }) => h('div', null, children) }));
vi.mock('../../services/workflow', () => ({ workflowRequest: mocks.request }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course-os', name: '운영체제' }] }));
import ExternalEvents from './ExternalEvents';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.request.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each([
  { initial: null, option: '운영체제', expected: 'course-os' },
  { initial: 'course-os', option: '연결하지 않음', expected: null },
])('persists the course value selected from the custom menu: $option', async ({ initial, option, expected }) => {
  let course = initial;
  mocks.request.mockImplementation(async (_path: string, method?: string, body?: { course_id: string | null }) => {
    if (method === 'PUT') { course = body!.course_id; return {}; }
    return { timezone: 'Asia/Seoul', events: [{ id: 'event-1', title: '중간 점검', all_day: true, start_value: '2026-11-23', course_id: course }] };
  });
  await act(async () => root.render(h(ExternalEvents, { day: '2026-11-23' })));
  await act(async () => container.querySelector<HTMLButtonElement>('[role=combobox]')!.click());
  const choice = Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find(item => item.textContent?.startsWith(option))!;
  await act(async () => choice.click());
  expect(mocks.request).toHaveBeenCalledWith('/integrations/events/event-1/course', 'PUT', { course_id: expected });
  expect(container.querySelector('[role=combobox]')?.textContent).toContain(option);
  expect(document.querySelector('[role=listbox]')).toBeNull();
});
