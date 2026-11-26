// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ materials: vi.fn(), create: vi.fn(), list: vi.fn(), read: vi.fn(), save: vi.fn(), start: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course-id', name: '운영체제' }] }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: mocks.materials }));
vi.mock('../../services/studyPaths', async original => ({ ...await original<typeof import('../../services/studyPaths')>(),
  createStudyPath: mocks.create, listStudyPaths: mocks.list, readStudyPath: mocks.read, saveStudyPath: mocks.save, startStudyChapter: mocks.start,
}));
vi.mock('../../common', () => ({ Card: ({ children }: { children: ReactNode }) => h('section', null, children) }));
vi.mock('../learningSession/LearningLayout', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../learningSession/navigation', () => ({ useLearningNavigation: () => ({ beforeLeaveRef: { current: null } }) }));
import StudyPaths from './StudyPaths';
let root: Root;
let container: HTMLDivElement;
const savedPath = { id: 'path-id', title: '시험 준비', course_id: 'course-id', revision: 0, created_at: '', updated_at: '', chapters: [{
  id: 'chapter-id', title: '프로세스', objective: '프로세스를 설명한다', material_id: 'material-id', material_name: '1주차',
  unit_ids: ['u0'], source_hash: 'hash', source_labels: ['1페이지'], included: true, source_changed: false,
  session_id: null, session_status: null, completed: false,
}] };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ paths: [] });
  // The real material service returns no markdown unless explicitly requested.
  mocks.materials.mockImplementation(async (_course: string, options?: { includeMarkdown?: boolean }) => [{ id: 'material-id', name: '1주차', markdown: options?.includeMarkdown ? '프로세스는 실행 중인 프로그램이다.' : '' }]);
  mocks.create.mockResolvedValue(savedPath); mocks.read.mockResolvedValue(savedPath);
  mocks.save.mockImplementation(async value => ({ ...value, revision: 1 }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(url = '/study-paths') {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(StudyPaths))));
}
function button(text: string) { return [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))!; }
async function selectCourse() {
  await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="과목"]')!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === '운영체제');
  expect(option).toBeDefined();
  await act(async () => option!.click());
}

it('loads actual material text, enables selection and creates a persistent editable draft', async () => {
  await render();
  await selectCourse();
  expect(mocks.materials).toHaveBeenCalledWith('운영체제', { includeMarkdown: true });
  const checkbox = container.querySelector('input[type=checkbox]') as HTMLInputElement;
  expect(checkbox.disabled).toBe(false);
  await act(async () => checkbox.click());
  expect(button('AI 코스 초안').disabled).toBe(false);
  await act(async () => button('AI 코스 초안').click());
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ course_id: 'course-id', material_ids: ['material-id'], title: '운영체제 학습 코스' }));
  expect(container.textContent).toContain('학습 진도 새로고침');
  expect(container.textContent).toContain('프로세스를 설명한다');
});

it('keeps creation request identity after a lost response so retry cannot duplicate a path', async () => {
  mocks.create.mockRejectedValueOnce(new Error('응답이 유실됐어요'));
  await render();
  await selectCourse();
  await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click());
  await act(async () => button('AI 코스 초안').click());
  const first = mocks.create.mock.calls[0][0];
  expect(container.querySelector('[role=alert]')?.textContent).toContain('응답이 유실됐어요');
  await act(async () => button('AI 코스 초안').click());
  expect(mocks.create.mock.calls[1][0]).toEqual(first);
});

it('requires saving inclusion changes and prevents excluding every chapter', async () => {
  await render('/study-paths?path=path-id');
  await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click());
  expect(button('변경 저장').disabled).toBe(true);
  expect(container.textContent).toContain('저장하지 않은 변경');
  await act(async () => button('편집 되돌리기').click());
  expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
  expect(button('학습 시작').disabled).toBe(false);
});
