// @vitest-environment jsdom
// Real router, path services and fetch/error parsing; paid generation and the
// separately-tested learning engine are represented at their HTTP/session boundary.
import { act, createElement as h, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course', name: '운영체제' }] }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: async (_name: string, options?: { includeMarkdown?: boolean }) =>
  [{ id: 'm1', name: '첫 강의', markdown: options?.includeMarkdown ? '프로세스와 스레드' : '' }, { id: 'm2', name: '둘째 강의', markdown: options?.includeMarkdown ? '동기화' : '' }] }));
vi.mock('../../services/backend', () => ({ BACKEND_URL: '/api', getJsonRequestHeaders: async () => ({ Authorization: 'Bearer owner', 'Content-Type': 'application/json' }),
  parseApiError: async () => '요청을 처리하지 못했어요.' }));
vi.mock('../../common', () => ({
  Card: ({ children, ...props }: { children: ReactNode }) => h('section', props, children),
  Sidebar: () => null, SidebarIcon: () => null, pageRoutes: { '학습 코스': '/study-paths' },
  useSidebarOpen: () => [false, () => {}],
}));

import StudyPaths from './StudyPaths';
import StudyPathReturn from './StudyPathReturn';
import LearningLayout from '../learningSession/LearningLayout';
import { useLearningNavigation } from '../learningSession/navigation';
import type { StudyPath, StudyChapter } from '../../services/studyPaths';

const PATH = '123e4567-e89b-42d3-a456-426614174000';
const CHAPTERS = [1, 2, 3].map(n => `123e4567-e89b-42d3-a456-42661417400${n}`);
let root: Root, container: HTMLDivElement;
let stored: StudyPath | null;
let calls: { path: string; method: string; body: Record<string, unknown> | null }[];
let failNextStart: boolean;
let failNextRead: boolean;
let failNextSave: boolean;
let pauseRead: Promise<void> | null;
let sessionCount: number;
let guardBlocked: boolean;

function draft(): StudyPath {
  return { id: PATH, course_id: 'course', title: '운영체제 학습 코스', revision: 0, created_at: '', updated_at: '',
    chapters: CHAPTERS.map((id, n) => ({ id, title: ['프로세스', '스레드', '동기화'][n], objective: `학습 목표 ${n + 1}`,
      material_id: n === 2 ? 'm2' : 'm1', material_name: n === 2 ? '둘째 강의' : '첫 강의', unit_ids: [`u${n}`],
      source_hash: 'hash', source_labels: [`${n + 1}페이지`], included: true, source_changed: false, session_id: null,
      session_status: null, completed: false })) };
}
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function findSession(id: string) { return stored!.chapters.find(c => c.session_id === id)!; }
async function server(input: RequestInfo | URL, init?: RequestInit) {
  const path = String(input), method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ path, method, body });
  expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer owner');
  if (path === '/api/study-paths' && method === 'GET') return reply({ paths: stored ? [stored] : [] });
  if (path === '/api/study-paths' && method === 'POST') {
    stored = { ...draft(), title: body.title };
    return reply(stored);
  }
  if (path === `/api/study-paths/${PATH}` && method === 'GET') {
    const snapshot = structuredClone(stored);
    if (pauseRead) await pauseRead;
    if (failNextRead) { failNextRead = false; return reply({ detail: { message: '진도를 불러오지 못했어요.' } }, 503); }
    return reply(snapshot);
  }
  if (path === `/api/study-paths/${PATH}` && method === 'PUT') {
    if (failNextSave) { failNextSave = false; return reply({ detail: { message: '저장을 다시 시도해주세요.' } }, 503); }
    stored = { ...stored!, title: body.title, revision: stored!.revision + 1,
      chapters: (body.chapters as StudyChapter[]).map(edit => ({ ...stored!.chapters.find(c => c.id === edit.id)!, ...edit })) };
    return reply(stored);
  }
  const match = path.match(/^\/api\/study-paths\/[^/]+\/chapters\/([^/]+)\/start$/);
  if (match && method === 'POST') {
    if (failNextStart) { failNextStart = false; return reply({ detail: { message: '학습을 시작하지 못했어요. 다시 시도해주세요.' } }, 503); }
    const chapter = stored!.chapters.find(c => c.id === match[1])!;
    if (!chapter.session_id || (['completed', 'abandoned'].includes(chapter.session_status ?? '') && !chapter.completed)) {
      chapter.session_id = `session-${++sessionCount}`; chapter.session_status = 'active';
    }
    return reply({ session_id: chapter.session_id });
  }
  throw new Error(`Unexpected HTTP request ${method} ${path}`);
}

function Location() { const location = useLocation(); return h('output', { 'aria-label': '현재 경로' }, location.pathname + location.search); }
function SessionBoundary() {
  const { id = '' } = useParams();
  const { beforeLeaveRef } = useLearningNavigation();
  useEffect(() => {
    beforeLeaveRef.current = async () => { if (guardBlocked) throw new Error('학습 저장이 끝날 때까지 기다려주세요.'); };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef]);
  return h('div', null, h(StudyPathReturn), h('h1', null, `학습 세션 ${id}`),
    h('button', { onClick: () => { findSession(id).session_status = 'paused'; } }, '세션 중단'),
    h('button', { onClick: () => { findSession(id).session_status = 'completed'; findSession(id).completed = false; } }, '일부 활동만 종료'),
    h('button', { onClick: () => { findSession(id).session_status = 'completed'; findSession(id).completed = true; } }, '모든 확인 활동 종료'));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(server));
  stored = null; calls = []; failNextStart = false; failNextRead = false; failNextSave = false; pauseRead = null; sessionCount = 0; guardBlocked = false;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(url = '/study-paths') {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Location), h(Routes, null,
    h(Route, { path: '/study-paths', element: h(StudyPaths) }),
    h(Route, { path: '/learn/:id', element: h(LearningLayout, null, h(SessionBoundary)) })))));
}
const buttons = (text: string) => [...container.querySelectorAll('button')].filter(b => b.textContent?.includes(text));
async function click(text: string, index = 0) { await act(async () => { buttons(text)[index].click(); }); }
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function returnToPath() {
  await act(async () => { const link = [...container.querySelectorAll('a')].find(a => a.textContent?.includes('학습 코스로 돌아가기'))!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}
async function create() {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="과목"]')!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === '운영체제');
  expect(option).toBeDefined();
  await act(async () => option!.click());
  await act(async () => [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].forEach(c => c.click()));
  await click('AI 코스 초안 만들기');
}

it('creates, edits names/order/inclusion, saves, studies and returns to persisted completion progress', async () => {
  await create();
  expect(calls.find(c => c.method === 'POST')!.body).toMatchObject({ course_id: 'course', material_ids: ['m1', 'm2'] });
  const names = container.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])');
  await input(names[0], '중간고사 핵심'); await input(names[1], '프로세스의 구조');
  await click('↓ 아래로', 0);
  await act(async () => container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[2].click());
  expect(buttons('다음 챕터 학습')[0].disabled).toBe(true);
  await click('변경 저장');
  expect(stored!.title).toBe('중간고사 핵심');
  expect(stored!.chapters.map(c => [c.title, c.included])).toEqual([['스레드', true], ['프로세스의 구조', true], ['동기화', false]]);
  const saved = calls.find(c => c.method === 'PUT')!;
  expect(saved.body!.chapters).toEqual([
    { id: CHAPTERS[1], title: '스레드', included: true }, { id: CHAPTERS[0], title: '프로세스의 구조', included: true }, { id: CHAPTERS[2], title: '동기화', included: false },
  ]);
  await click('다음 챕터 학습');
  expect(container.querySelector('output')!.textContent).toBe(`/learn/session-1?studyPath=${PATH}`);
  await click('모든 확인 활동 종료'); await returnToPath();
  expect(container.textContent).toContain('활동 완료 1 / 2챕터');
  expect(container.querySelector<HTMLProgressElement>('progress')!.value).toBe(1);
  await click('다음 챕터 학습');
  expect(calls.filter(c => c.path.endsWith('/start')).at(-1)!.path).toContain(CHAPTERS[0]);
  await returnToPath();
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('중간고사 핵심');
});

it('resumes the same paused session and starts a new attempt only after partial completion', async () => {
  stored = draft(); await render(`/study-paths?path=${PATH}`);
  await click('다음 챕터 학습'); await click('세션 중단'); await returnToPath();
  expect(container.textContent).toContain('활동 완료 0 / 3챕터');
  await click('학습 이어가기');
  expect(container.querySelector('output')!.textContent).toContain('/learn/session-1');
  expect(sessionCount).toBe(1);
  await click('일부 활동만 종료'); await returnToPath();
  expect(container.textContent).toContain('활동 완료 0 / 3챕터');
  await click('부분 학습 다시 시작');
  expect(container.querySelector('output')!.textContent).toContain('/learn/session-2');
  await click('모든 확인 활동 종료'); await returnToPath();
  expect(container.textContent).toContain('활동 완료 1 / 3챕터');
});

it('preserves edits across save/start failures and permits retry without losing the path', async () => {
  stored = draft(); await render(`/study-paths?path=${PATH}`);
  await input(container.querySelector<HTMLInputElement>('input')!, '복구할 편집');
  failNextSave = true; await click('변경 저장');
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('복구할 편집');
  expect(container.textContent).toContain('저장을 다시 시도해주세요.');
  await click('변경 저장');
  expect(stored!.title).toBe('복구할 편집');
  failNextStart = true; await click('다음 챕터 학습');
  expect(container.textContent).toContain('학습을 시작하지 못했어요.');
  expect(container.querySelector('output')!.textContent).toContain('/study-paths');
  await click('다음 챕터 학습');
  expect(container.querySelector('output')!.textContent).toContain('/learn/session-1');
});

it('locks editing during refresh, then recovers from a failed refresh without overwriting edits', async () => {
  stored = draft(); await render(`/study-paths?path=${PATH}`);
  let release!: () => void;
  pauseRead = new Promise(resolve => { release = resolve; });
  await click('학습 진도 새로고침');
  expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  expect(buttons('다음 챕터 학습')[0].disabled).toBe(true);
  failNextRead = true;
  await act(async () => release()); pauseRead = null;
  expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
  expect(container.textContent).toContain('진도를 불러오지 못했어요.');
  await click('학습 진도 새로고침');
  await input(container.querySelector<HTMLInputElement>('input')!, '새 편집');
  expect(buttons('학습 진도 새로고침')[0].disabled).toBe(true);
});

it('blocks new study after source changes while keeping guarded historical navigation and return context', async () => {
  stored = draft(); stored.chapters[0] = { ...stored.chapters[0], source_changed: true, session_id: 'session-old', session_status: 'paused' };
  await render(`/study-paths?path=${PATH}`);
  expect(buttons('학습 이어가기')[0].disabled).toBe(true);
  const history = [...container.querySelectorAll('a')].find(a => a.textContent === '이전 학습 기록 보기')!;
  expect(history.getAttribute('href')).toBe(`/learn/session-old?studyPath=${PATH}`);
  await input(container.querySelector<HTMLInputElement>('input')!, '저장 전 수정');
  await act(async () => { history.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
  expect(container.textContent).toContain('편집한 코스를 저장하거나 되돌린 뒤 이동해주세요.');
  expect(container.querySelector('output')!.textContent).toContain('/study-paths');
  await click('편집 되돌리기');
  await act(async () => { history.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
  guardBlocked = true; await returnToPath();
  expect(container.textContent).toContain('학습 저장이 끝날 때까지 기다려주세요.');
  expect(container.querySelector('output')!.textContent).toContain('/learn/session-old');
  guardBlocked = false; await returnToPath();
  expect(container.textContent).toContain('원문이 변경되거나 삭제되어 새 코스가 필요해요.');
});
