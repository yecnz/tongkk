// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'alice' }, fetch: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('./services/courses', () => ({ fetchCourses: mocks.fetch, createCourse: vi.fn(), removeCourse: vi.fn(), updateCourse: vi.fn() }));
import { CourseProvider, useCourses } from './CourseContext';
import type { CourseRecord } from './services/courses';
let root: Root;
let container: HTMLDivElement;
function Probe() { return h('p', null, useCourses().courses.join(',')); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.user = { id: 'alice' }; mocks.fetch.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('does not expose a previous account course response after switching users', async () => {
  let finishAlice!: (courses: CourseRecord[]) => void;
  mocks.fetch.mockReturnValueOnce(new Promise(resolve => { finishAlice = resolve; }));
  await act(async () => root.render(h(CourseProvider, null, h(Probe))));
  mocks.user = { id: 'bob' };
  mocks.fetch.mockResolvedValue([{ id: 'b', name: 'Bob course' }]);
  await act(async () => root.render(h(CourseProvider, null, h(Probe))));
  expect(container.textContent).toBe('Bob course');
  await act(async () => finishAlice([{ id: 'a', name: 'Alice private course' } as CourseRecord]));
  expect(container.textContent).toBe('Bob course');
});
