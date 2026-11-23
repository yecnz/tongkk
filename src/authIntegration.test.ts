// @vitest-environment jsdom
import { act, createElement as h, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ initialize: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(),
  setSession: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(), resetPasswordForEmail: vi.fn(), resend: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('./services/supabase', () => ({ supabase: { auth } }));
vi.mock('./services/courses', () => ({ invalidateCoursesCache: vi.fn() }));
vi.mock('./services/materials', () => ({ invalidateMaterialsCache: vi.fn() }));
vi.mock('./services/summaries', () => ({ invalidateSummariesCache: vi.fn() }));
vi.mock('./services/quizSets', () => ({ invalidateQuizSetsCache: vi.fn() }));
vi.mock('./services/learningSessions', () => ({ clearLearningDrafts: vi.fn() }));
import { AuthProvider, useAuth } from './AuthContext';
import { ToastProvider } from './ToastContext';
import Auth from './pages/Auth';
import LoginModal from './components/LoginModal';
import AuthCallbackBoundary from './components/AuthCallbackBoundary';

const session = { access_token: 'synthetic', refresh_token: 'synthetic', user: { id: 'user-1', email: 'student@example.test' } };
let root: Root | null = null;
let container: HTMLDivElement;
let currentAuth: ReturnType<typeof useAuth>;
const closed = vi.fn();
function Probe() {
  const value = useAuth();
  useEffect(() => { currentAuth = value; }, [value]);
  return null;
}
async function render(path: string, options: { modal?: boolean; signup?: boolean; keepUrl?: boolean } = {}) {
  if (root) await act(async () => root!.unmount());
  document.body.innerHTML = '';
  if (!options.keepUrl) window.history.replaceState(null, '', path);
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  const content = options.modal
    ? h(LoginModal, { onClose: closed, initialMode: options.signup ? 'signUp' : 'signIn' })
    : h(AuthCallbackBoundary, null, h(Routes, null,
      h(Route, { path: '/auth', element: h(Auth) }),
      h(Route, { path: '/auth/reset-password', element: h(Auth) }),
      h(Route, { path: '/', element: h('p', null, '대시보드 테스트') })));
  await act(async () => root!.render(h(AuthProvider, null, h(MemoryRouter, { initialEntries: [path] },
    h(ToastProvider, null, h(Probe), content)))));
}
async function input(index: number, value: string) {
  await act(async () => {
    const element = container.querySelectorAll('input')[index];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === text);
    expect(button, text).toBeTruthy(); button!.click();
  });
}
async function submit(twice = false) {
  await act(async () => {
    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    if (twice) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  auth.initialize.mockResolvedValue({ error: null });
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.onAuthStateChange.mockReturnValue({ data: { listener: null, subscription: { unsubscribe: vi.fn() } } });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.setSession.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.resend.mockResolvedValue({ error: null });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; document.body.innerHTML = ''; vi.unstubAllGlobals();
});

describe('password recovery routing and forms', () => {
  it('keeps the password form after reload with a restored session and no URL tokens', async () => {
    await render('/auth/reset-password');
    expect(container.textContent).toContain('새 비밀번호 설정');
    expect(currentAuth.recoveryMode).toBe(false);
    await render('/auth/reset-password');
    expect(container.querySelectorAll('input[type=password]')).toHaveLength(2);
  });
  it('routes a legacy recovery callback from /auth into the dedicated form', async () => {
    window.history.replaceState(null, '', '/auth#access_token=synthetic&type=recovery');
    auth.initialize.mockImplementation(async () => { window.history.replaceState(null, '', '/auth'); return { error: null }; });
    await render('/auth', { keepUrl: true });
    expect(container.textContent).toContain('새 비밀번호 설정');
    expect(container.textContent).not.toContain('대시보드 테스트');
  });
  it('shows expired link guidance even with a previous login and retains it after reload', async () => {
    const path = '/auth/reset-password';
    window.history.replaceState(null, '', path + '#error=access_denied&error_code=otp_expired&error_description=private');
    auth.initialize.mockResolvedValue({ error: { code: 'otp_expired' } });
    await render(path, { keepUrl: true });
    expect(container.querySelector('[role=alert]')?.textContent).toContain('만료');
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(window.location.href).not.toContain('private');
    expect(window.location.search).toContain('auth_error=invalid_link');
    auth.initialize.mockResolvedValue({ error: null });
    await render(path, { keepUrl: true });
    expect(container.querySelector('input[type=password]')).toBeNull();
    await click('재설정 메일 다시 받기');
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('비밀번호 찾기');
  });
  it('requires a valid session and blocks password submission while signed out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await render('/auth/reset-password');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('세션');
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('validates matching passwords and explains provider errors', async () => {
    await render('/auth/reset-password');
    await input(0, 'new-password'); await input(1, 'other-password'); await submit();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(container.textContent).toContain('일치하지');
    await input(1, 'new-password');
    auth.updateUser.mockResolvedValue({ error: { code: 'same_password' } });
    await submit();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('기존 비밀번호');
    expect(container.textContent).toContain('새 비밀번호 설정');
  });
  it('submits once and goes to the dashboard only after successful update', async () => {
    let finish!: (value: { error: null }) => void;
    auth.updateUser.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render('/auth/reset-password');
    await input(0, 'new-password'); await input(1, 'new-password');
    await submit(true);
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('대시보드 테스트');
    await act(async () => finish({ error: null }));
    expect(container.textContent).toContain('대시보드 테스트');
    expect(currentAuth.recoveryMode).toBe(false);
  });
  it('exits loading after initialization throws', async () => {
    auth.initialize.mockRejectedValue(new Error('network'));
    await render('/auth');
    expect(currentAuth.loading).toBe(false);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('다시 시도');
  });
});

describe('login, signup and reset email UI', () => {
  it('establishes the returned Supabase session and closes on a successful login', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'user-access', refresh_token: 'user-refresh' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await render('/auth', { modal: true });
    await input(0, 'login@example.test'); await input(1, 'correct-password'); await submit(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'user-access', refresh_token: 'user-refresh' });
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it('keeps login available for retry after a network failure', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await render('/auth', { modal: true });
    await input(0, 'offline@example.test'); await input(1, 'password'); await submit();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('인터넷 연결');
    expect(container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(false);
    expect(closed).not.toHaveBeenCalled();
  });
  it('uses a separate reset form and prevents duplicate emails and immediate resend', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    let finish!: (value: { error: null }) => void;
    auth.resetPasswordForEmail.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await render('/auth', { modal: true }); await click('비밀번호 찾기');
    expect(container.querySelector('input[type=password]')).toBeNull();
    await input(0, 'ui-reset@example.test'); await submit(true);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(true);
    await act(async () => finish({ error: null }));
    expect(container.querySelector('[role=status]')?.textContent).toContain('메일함');
    expect(container.querySelector('button[type=submit]')?.textContent).toContain('초 후');
    expect(container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(true);
    await render('/auth', { modal: true }); await click('비밀번호 찾기'); await input(0, 'ui-reset@example.test');
    expect(container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(true);
  });
  it('asks for the 6-digit signup code and signs in once it is verified', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    await render('/auth', { modal: true, signup: true });
    await input(0, 'ui-signup@example.test'); await input(1, 'new-password'); await submit();
    expect(closed).not.toHaveBeenCalled();
    expect(container.textContent).toContain('6자리 인증번호');
    expect(container.textContent).toContain('남은 시간');
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
    await input(0, '12a3456'); await submit();
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'ui-signup@example.test', token: '123456', type: 'signup' });
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it('closes after immediate signup when confirmation is disabled', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signUp.mockResolvedValue({ data: { session }, error: null });
    await render('/auth', { modal: true, signup: true });
    await input(0, 'instant@example.test'); await input(1, 'new-password'); await submit();
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it('offers signup confirmation instead of treating an unconfirmed account as a wrong password', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: '이메일 인증을 완료해주세요.', error_code: 'email_not_confirmed' }), { status: 403 })));
    await render('/auth', { modal: true });
    await input(0, 'pending@example.test'); await input(1, 'password'); await submit();
    expect(container.textContent).toContain('이메일 인증');
    expect(container.querySelector('input[type=password]')).toBeNull();
    expect(closed).not.toHaveBeenCalled();
  });
});
