import { supabase } from './supabase';
import { AuthActionError, isValidAuthEmail, RESET_PASSWORD_PATH } from './authFlow';

type EmailKind = 'reset' | 'signup';
const requests = new Map<string, { pending: boolean; nextAllowedAt: number }>();
const requestKey = (kind: EmailKind, email: string) => `${kind}:${email.trim().toLowerCase()}`;

export function emailWaitSeconds(kind: EmailKind, email: string, now = Date.now()): number {
  return Math.max(0, Math.ceil(((requests.get(requestKey(kind, email))?.nextAllowedAt ?? 0) - now) / 1000));
}

export function startEmailCooldown(kind: EmailKind, email: string): void {
  requests.set(requestKey(kind, email), { pending: false, nextAllowedAt: Date.now() + 60_000 });
}

// 모달을 닫았다 다시 열거나 동시에 눌러도 같은 메일을 중복 요청하지 않는다.
export async function sendAuthEmail(kind: EmailKind, rawEmail: string): Promise<void> {
  const email = rawEmail.trim();
  if (!isValidAuthEmail(email)) throw new AuthActionError('이메일 주소를 다시 확인해주세요.');
  const key = requestKey(kind, email);
  if (requests.get(key)?.pending) throw new AuthActionError('메일을 요청하고 있습니다. 잠시 기다려주세요.');
  if (emailWaitSeconds(kind, email) > 0) throw new AuthActionError('잠시 후 메일을 다시 요청해주세요.');
  const state = { pending: true, nextAllowedAt: 0 };
  requests.set(key, state);
  try {
    const { error } = kind === 'reset'
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}` })
      : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/auth` } });
    if (error) throw error;
    state.nextAllowedAt = Date.now() + 60_000;
  } catch (error) {
    if (error && typeof error === 'object' && ('status' in error && error.status === 429 ||
      'code' in error && String(error.code).includes('rate_limit'))) state.nextAllowedAt = Date.now() + 60_000;
    throw error;
  } finally {
    state.pending = false;
  }
}
