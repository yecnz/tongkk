// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  courses: vi.fn(), materials: vi.fn(), agent: vi.fn(), profile: vi.fn(), dashboard: vi.fn(),
  signOut: vi.fn(), signIn: vi.fn(), user: null as User | null, authListeners: new Set<() => void>(),
}));
vi.mock('../AuthContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    mocks.authListeners.add(listener);
    return () => { mocks.authListeners.delete(listener); };
  };
  return {
    useAuth: () => ({
      user: useSyncExternalStore(subscribe, () => mocks.user),
      loading: false, signOut: mocks.signOut, signIn: mocks.signIn,
    }),
  };
});
vi.mock('../services/profile', () => ({ loadUserProfile: mocks.profile }));
vi.mock('../services/courses', () => ({ fetchCourses: mocks.courses }));
vi.mock('../services/materials', () => ({ loadCourseMaterialsFromServer: mocks.materials }));
vi.mock('../services/dashboardState', () => ({ loadDashboardState: mocks.dashboard, saveDashboardState: vi.fn() }));
vi.mock('../services/agent', () => ({ sendAgentMessage: mocks.agent, AgentThreadExpiredError: class extends Error {} }));
vi.mock('../components/AITutorDrawer', () => ({ FormattedTutorText: () => null }));
vi.mock('../common', async importOriginal => ({ ...await importOriginal<typeof import('../common')>(), parseAiSuggestions: () => ({ mainContent: '', suggestions: [] }) }));
import Mini from './Mini';
import MiniTutor from './MiniTutor';

let root: Root;
let container: HTMLDivElement;
const firstUser = { id: 'user', email: 'first@example.com' } as User;
const secondUser = { id: 'second', email: 'second@example.com' } as User;
function setUser(user: User | null) {
  mocks.user = user;
  mocks.authListeners.forEach(listener => listener());
}
function element<T extends HTMLElement = HTMLButtonElement>(selector: string) {
  const found = container.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found!;
}
async function click(selector: string) { await act(async () => element(selector).click()); }
async function render(path = '/mini', state?: unknown) {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [{ pathname: path, state }] }, h(Routes, null,
    h(Route, { path: '/mini', element: h(Mini) }),
    h(Route, { path: '/mini/tutor', element: h(MiniTutor) }),
  ))));
}
async function type(selector: string, value: string) {
  await act(async () => {
    const input = element<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function escape(selector: string) {
  await act(async () => element(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
}
function retry() {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '다시 시도')!;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.courses.mockReset().mockResolvedValue([{ id: 'course', name: '자료구조' }]);
  mocks.materials.mockReset().mockResolvedValue([{ id: 'material', name: '아주 긴 강의자료 이름.pdf', markdown: '원문' }]);
  mocks.agent.mockReset();
  setUser(firstUser);
  mocks.profile.mockReset().mockImplementation(async () => ({
    nickname: mocks.user?.id === secondUser.id ? '두번째계정' : '하늘학생',
    avatarUrl: null,
  }));
  mocks.dashboard.mockReset().mockResolvedValue([]);
  mocks.signOut.mockReset().mockImplementation(async () => setUser(null));
  mocks.signIn.mockReset().mockImplementation(async () => setUser(secondUser));
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it('does not show the no-course message while courses are still loading', async () => {
  let resolve!: (items: { id: string; name: string }[]) => void;
  mocks.courses.mockReturnValue(new Promise(r => { resolve = r; }));
  await render(); await click('.mini-material-trigger');
  expect(container.textContent).toContain('과목 불러오는 중…');
  expect(container.textContent).not.toContain('아직 등록된 과목이 없어요.');
  await act(async () => resolve([{ id: 'course', name: '자료구조' }]));
  expect(container.textContent).not.toContain('과목 불러오는 중…');
  await click('.mini-select-toggle');
  expect(container.textContent).toContain('자료구조');
});

it('shows the empty-course state only after a successful empty response', async () => {
  mocks.courses.mockResolvedValue([]);
  await render(); await click('.mini-material-trigger');
  expect(container.textContent).toContain('아직 등록된 과목이 없어요.');
  expect(element<HTMLAnchorElement>('.mini-panel-empty a').getAttribute('href')).toBe('/');
});

it('retries a failed course load without presenting it as an empty account', async () => {
  mocks.courses.mockRejectedValueOnce(new Error('offline'));
  await render(); await click('.mini-material-trigger');
  expect(container.textContent).toContain('과목을 불러오지 못했어요.');
  expect(container.textContent).not.toContain('아직 등록된 과목이 없어요.');
  await act(async () => retry().click());
  await click('.mini-select-toggle');
  expect(container.textContent).toContain('자료구조');
  expect(mocks.courses).toHaveBeenCalledTimes(2);
});

it('can retry materials for the same course and retain the selected material', async () => {
  mocks.materials.mockRejectedValueOnce(new Error('offline'));
  await render(); await click('.mini-material-trigger'); await click('.mini-select-toggle'); await click('.mini-select-options button');
  expect(container.textContent).toContain('자료를 불러오지 못했어요.');
  await act(async () => retry().click());
  expect(mocks.materials).toHaveBeenCalledTimes(2);
  await click('.mini-select-field:nth-of-type(3) .mini-select-toggle');
  expect(container.textContent).not.toContain('자료 선택 안 함');
  await click('.mini-select-options button');
  expect(container.querySelector('.mini-material-panel')).toBeNull();
  expect(element('.mini-material-trigger').title).toBe('아주 긴 강의자료 이름.pdf');

  await click('.mini-material-trigger'); await click('.mini-select-toggle'); await click('.mini-select-options button');
  expect(element('.mini-material-trigger').title).toBe('아주 긴 강의자료 이름.pdf');
  expect(container.textContent).not.toContain('자료를 불러오는 중…');
  expect(mocks.materials).toHaveBeenCalledTimes(2);
});

it('Escape closes a course list first, then the enclosing mini panel', async () => {
  await render(); await click('.mini-material-trigger'); await click('.mini-select-toggle');
  await escape('.mini-select-options button');
  expect(container.querySelector('.mini-select-options')).toBeNull();
  expect(container.querySelector('.mini-material-panel')).not.toBeNull();
  expect(document.activeElement).toBe(element('.mini-select-toggle'));
  await escape('.mini-select-toggle');
  expect(container.querySelector('.mini-material-panel')).toBeNull();
});

it('Escape closes the tutor selector without discarding the question draft, then returns to mini', async () => {
  await render('/mini/tutor');
  await act(async () => {
    const input = element<HTMLInputElement>('.mini-tutor-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '작성 중 질문');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('.mini-tutor-source > summary');
  expect(element<HTMLDetailsElement>('details').open).toBe(true);
  await click('.mini-select-toggle'); await escape('.mini-select-options button');
  expect(element<HTMLDetailsElement>('details').open).toBe(true);
  await escape('.mini-select-toggle');
  expect(element<HTMLDetailsElement>('details').open).toBe(false);
  expect(element<HTMLInputElement>('.mini-tutor-input').value).toBe('작성 중 질문');
  await escape('.mini-tutor-input');
  expect(container.querySelector('.mini-card')).not.toBeNull();
});

it('the tutor back button returns to the mini screen without calling the agent', async () => {
  await render('/mini/tutor'); await click('.mini-window-back');
  expect(container.querySelector('.mini-card')).not.toBeNull();
  expect(mocks.agent).not.toHaveBeenCalled();
});

it('uses the same profile in the badge and menu and refreshes it on focus and tray reopen', async () => {
  await render();
  expect(element('.mini-account-trigger').textContent).toBe('하늘');
  await click('.mini-account-trigger');
  expect(element('.mini-account-menu').textContent).toContain('하늘학생');
  expect(element('.mini-account-menu').textContent).toContain('first@example.com');

  mocks.profile.mockResolvedValueOnce({ nickname: '새로운별명', avatarUrl: 'https://example.com/avatar.png' });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(container.querySelectorAll('.mini-account-avatar img')).toHaveLength(2);
  await act(async () => element('.mini-account-trigger img').dispatchEvent(new Event('error')));
  expect(container.querySelectorAll('.mini-account-avatar img')).toHaveLength(0);
  expect(element('.mini-account-trigger').textContent).toBe('새로');

  mocks.profile.mockResolvedValueOnce({ nickname: '변경됨', avatarUrl: null });
  await act(async () => window.dispatchEvent(new Event('tongkk:mini-open')));
  expect(element('.mini-account-trigger').textContent).toBe('변경');
  expect(element('.mini-account-menu').textContent).toContain('변경됨');
  await escape('.mini-account-menu button');
  expect(container.querySelector('.mini-account-menu')).toBeNull();
  expect(document.activeElement).toBe(element('.mini-account-trigger'));
});

it('keeps the current account on failure and clears its dashboard and selection on logout', async () => {
  mocks.dashboard.mockImplementation(async (key: string) => key === 'plans' ? [{ text: '첫 계정 과제' }] : []);
  mocks.signOut.mockRejectedValueOnce(new Error('offline'));
  await render();
  await click('.mini-material-trigger'); await click('.mini-select-toggle'); await click('.mini-select-options button');
  await click('.mini-select-field:nth-of-type(3) .mini-select-toggle'); await click('.mini-select-options button');
  await type('.mini-question-input', '이전 질문 초안');
  await click('.mini-account-trigger'); await click('.mini-account-menu button:last-of-type');
  expect(element('[role="alert"]').textContent).toContain('로그아웃하지 못했어요');
  expect(element('.mini-material-trigger').title).toBe('아주 긴 강의자료 이름.pdf');
  expect(container.textContent).toContain('첫 계정 과제');

  await click('.mini-account-menu button:last-of-type');
  expect(mocks.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  expect(element('.mini-guest-heading button').textContent).toBe('로그인');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain('첫 계정 과제');

  mocks.dashboard.mockResolvedValue([]);
  await click('.mini-guest-heading button');
  await type('input[type=email]', secondUser.email!);
  await type('input[type=password]', 'test-password');
  await click('.mini-login-submit');
  expect(element('.mini-material-trigger').title).toBe('자료 선택');
  expect(element<HTMLInputElement>('.mini-question-input').value).toBe('');
  expect(element('.mini-account-trigger').textContent).toBe('두번');
  expect(container.textContent).not.toContain('첫 계정 과제');
});

it('keeps the account and selected material after a failed or cancelled switch', async () => {
  mocks.signIn.mockRejectedValueOnce(new Error('invalid credentials'));
  await render();
  await click('.mini-material-trigger'); await click('.mini-select-toggle'); await click('.mini-select-options button');
  await click('.mini-select-field:nth-of-type(3) .mini-select-toggle'); await click('.mini-select-options button');
  await type('.mini-question-input', '질문 초안');
  await click('.mini-account-trigger'); await click('.mini-account-menu button:first-of-type');
  expect(mocks.user).toBe(firstUser);
  expect(element('.mini-card').closest('.mini-stage')?.hasAttribute('hidden')).toBe(true);
  await type('input[type=email]', secondUser.email!);
  await type('input[type=password]', 'invalid-password');
  await click('.mini-login-submit');
  expect(element('[role="dialog"] [role="alert"]')).not.toBeNull();

  await click('.mini-login-close');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(element('.mini-card').closest('.mini-stage')?.hasAttribute('hidden')).toBe(false);
  expect(element('.mini-account-trigger').textContent).toBe('하늘');
  expect(element('.mini-material-trigger').title).toBe('아주 긴 강의자료 이름.pdf');
  expect(element<HTMLInputElement>('.mini-question-input').value).toBe('질문 초안');
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it('switches accounts from the tutor and aborts the previous account’s pending question', async () => {
  let resolveAgent!: (response: { threadId: string; result: string }) => void;
  mocks.agent.mockReturnValue(new Promise(resolve => { resolveAgent = resolve; }));
  await render('/mini/tutor', { accountId: firstUser.id, question: '첫 계정 질문' });
  expect(mocks.agent).toHaveBeenCalledTimes(1);
  const signal = mocks.agent.mock.calls[0][6] as AbortSignal;
  expect(container.textContent).toContain('첫 계정 질문');
  await click('.mini-account-trigger');
  await escape('.mini-account-menu button');
  expect(container.querySelector('.mini-tutor')).not.toBeNull();
  await click('.mini-account-trigger'); await click('.mini-account-menu button:first-of-type');
  expect(signal.aborted).toBe(false);
  expect(element('[role="dialog"]').textContent).toContain('다른 계정으로 학습을 이어가세요.');
  await escape('input[type=email]');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(element('.mini-tutor').closest('.mini-stage')?.hasAttribute('hidden')).toBe(false);
  expect(container.textContent).toContain('첫 계정 질문');
  await click('.mini-account-trigger'); await click('.mini-account-menu button:first-of-type');
  await type('input[type=email]', secondUser.email!);
  await type('input[type=password]', 'test-password');
  await click('.mini-login-submit');
  expect(signal.aborted).toBe(true);
  expect(mocks.signOut).not.toHaveBeenCalled();
  await act(async () => resolveAgent({ threadId: 'old', result: '첫 계정 응답' }));
  expect(mocks.signIn).toHaveBeenCalledWith(secondUser.email, 'test-password');
  expect(element('.mini-account-trigger').textContent).toBe('두번');
  expect(container.textContent).not.toContain('첫 계정');
  expect(mocks.agent).toHaveBeenCalledTimes(1);
});

it('ignores tutor history state owned by another account', async () => {
  setUser(secondUser);
  await render('/mini/tutor', { accountId: firstUser.id, question: '첫 계정 질문', course: '과목', materialId: 'material' });
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.materials).not.toHaveBeenCalled();
  expect(element('.mini-tutor-source summary').textContent).toContain('과목 선택');
});
