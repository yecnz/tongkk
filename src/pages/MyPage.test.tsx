// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UserProfile } from '../services/profile';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), remove: vi.fn(), updateEmail: vi.fn(), signOut: vi.fn() }));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', email: 'old@example.com' }, updateEmail: mocks.updateEmail, signOut: mocks.signOut }) }));
vi.mock('../AuthGateContext', () => ({ useAuthGate: () => ({ requireAuth: () => true, openLogin: vi.fn() }) }));
vi.mock('../ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../services/profile', () => ({ loadUserProfile: mocks.load, saveUserProfile: mocks.save, deleteOwnAppData: mocks.remove, uploadAvatar: vi.fn() }));
vi.mock('../services/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../features/integrations/SourceConnections', () => ({ default: () => null }));
vi.mock('../features/integrations/CalendarConnections', () => ({ default: () => null }));
vi.mock('../features/review/LearningPreferences', () => ({ default: () => null }));
import MyPage from './MyPage';

const profile: UserProfile = { nickname: '학생', avatarUrl: null, school: null, department: null, darkMode: false, notificationsEnabled: true, hideSummaryNotice: false };
let root: Root, container: HTMLDivElement;
const button = (text: string, scope: ParentNode = container) => Array.from(scope.querySelectorAll('button')).find(element => element.textContent?.trim() === text)!;
const dialog = () => container.querySelector('dialog')!;
async function click(text: string, scope: ParentNode = container) { await act(async () => button(text, scope).click()); }
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render() { await act(async () => root.render(<MemoryRouter><MyPage /></MemoryRouter>)); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  mocks.load.mockReset().mockResolvedValue(profile);
  mocks.save.mockReset().mockImplementation(async value => value);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.updateEmail.mockReset().mockResolvedValue(undefined);
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps profile edits and the dialog after a failed save, and allows a successful retry', async () => {
  mocks.save.mockRejectedValueOnce(new Error('저장 연결 오류'));
  await render();
  await click('✎ 편집');
  const name = dialog().querySelector('input[placeholder="닉네임 입력"]') as HTMLInputElement;
  expect(name.labels?.[0].textContent).toContain('닉네임');
  await fill(name, '새 이름');
  await click('저장', dialog());
  expect(dialog()).toBeTruthy();
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('저장 연결 오류');
  expect(name.value).toBe('새 이름');
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await click('저장', dialog());
  expect(dialog()).toBeNull();
  expect(container.textContent).toContain('새 이름');
  expect(mocks.save).toHaveBeenLastCalledWith({ ...profile, nickname: '새 이름' });
});

it('requires fresh deletion confirmation after closing and reopening the dialog', async () => {
  await render();
  await click('학습 데이터 삭제');
  await fill(dialog().querySelector('input')!, '삭제');
  expect(button('학습 데이터 삭제', dialog()).disabled).toBe(false);
  await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="닫기"]')!.click());
  await click('학습 데이터 삭제');
  expect((dialog().querySelector('input') as HTMLInputElement).value).toBe('');
  expect(button('학습 데이터 삭제', dialog()).disabled).toBe(true);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('reopens email editing with a fresh field after a previous successful change', async () => {
  await render();
  await click('이메일 변경');
  await fill(dialog().querySelector('input')!, 'new@example.com');
  await click('이메일 변경', dialog());
  expect(dialog().textContent).toContain('변경했어요');
  await click('닫기', dialog());
  await click('이메일 변경');
  expect((dialog().querySelector('input') as HTMLInputElement).value).toBe('');
  expect(dialog().textContent).not.toContain('변경했어요');
});

it('rolls back a failed toggle and preserves an actionable error', async () => {
  mocks.save.mockRejectedValueOnce(new Error('설정 저장 실패'));
  await render();
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="다크모드"]')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('설정 저장 실패');
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
