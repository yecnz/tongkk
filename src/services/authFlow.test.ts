import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthActionError, authErrorMessage, authResponseError, cleanAuthCallbackUrl, isValidAuthEmail, readAuthCallback } from './authFlow';
const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn(), resend: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth } }));
import { emailWaitSeconds, sendAuthEmail, startEmailCooldown } from './authEmails';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('brief failure explanations', () => {
  it('distinguishes a network connection failure from server and timeout failures', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toContain('인터넷 연결');
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', status: 503 })).toContain('인증 서비스');
    expect(authErrorMessage({ name: 'TimeoutError' })).toContain('시간이 초과');
    expect(authErrorMessage({ name: 'AuthSessionMissingError' })).toContain('인증 시간이 만료');
  });
  it('explains account locking with remaining time and never exposes backend details', async () => {
    const error = await authResponseError(new Response(JSON.stringify({ error_code: 'account_locked', detail: 'internal database path' }),
      { status: 429, headers: { 'Retry-After': '899' } }));
    expect(authErrorMessage(error)).toBe('로그인 실패가 반복돼 잠시 잠겼어요. 15분 후 다시 시도해 주세요.');
    expect(authErrorMessage(error)).not.toContain('database');
  });
  it('handles proxy HTML, null JSON and unknown backend errors without rendering raw responses', async () => {
    for (const body of ['<html>private proxy information</html>', 'null', JSON.stringify({ detail: 'SUPABASE_SECRET_KEY missing' })]) {
      expect(authErrorMessage(await authResponseError(new Response(body, { status: 503 })))).toBe('인증 서비스에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    }
  });
  it('keeps rate limits separate from credential errors and ignores invalid retry headers', async () => {
    const limited = await authResponseError(new Response('{}', { status: 429, headers: { 'Retry-After': 'invalid' } }));
    expect(authErrorMessage(limited)).toBe('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
    const credentials = await authResponseError(new Response('{}', { status: 401 }));
    expect(authErrorMessage(credentials)).toContain('이메일 또는 비밀번호');
    expect(authErrorMessage({ code: 'user_banned' })).toContain('이용이 제한');
    expect(authErrorMessage({ code: 'email_address_not_authorized' })).toContain('메일을 보낼 수 없어요');
  });
});

describe('auth callback handling', () => {
  it('recognizes only the exact recovery type and never treats an error as successful recovery', () => {
    expect(readAuthCallback('https://app.test/auth#access_token=x&type=recovery').isRecovery).toBe(true);
    expect(readAuthCallback('https://app.test/auth#type=recovery_extra').isRecovery).toBe(false);
    expect(readAuthCallback('https://app.test/auth#type=recovery&error_code=otp_expired').isRecovery).toBe(false);
  });
  it('cleans sensitive callback parameters and retains a safe error marker across reloads', () => {
    const clean = cleanAuthCallbackUrl('https://app.test/auth/reset-password?from=email#access_token=secret&refresh_token=secret&error_code=otp_expired&error_description=private', true);
    expect(clean).toBe('/auth/reset-password?from=email&auth_error=invalid_link');
    expect(readAuthCallback('https://app.test' + clean).error).toBeTruthy();
    expect(cleanAuthCallbackUrl('https://app.test' + clean)).toBe('/auth/reset-password?from=email');
  });
  it('never reflects provider error text into the page', () => {
    expect(readAuthCallback('https://app.test/auth#error_description=private-details').error).not.toContain('private-details');
    expect(authErrorMessage({ code: 'same_password' })).toContain('기존 비밀번호');
    expect(authErrorMessage(new AuthActionError('계정 잠금 중'))).toBe('계정 잠금 중');
  });
});

describe('email requests', () => {
  it('validates before making any request', async () => {
    expect(isValidAuthEmail(' name@example.test ')).toBe(true);
    await expect(sendAuthEmail('reset', 'bad@address')).rejects.toThrow('이메일 주소를 다시 확인');
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it('blocks duplicate requests in flight, cooldown and modal remounts, then permits retry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
    let finish!: (value: { error: null }) => void;
    auth.resetPasswordForEmail.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = sendAuthEmail('reset', 'duplicate@example.test');
    await expect(sendAuthEmail('reset', 'DUPLICATE@example.test')).rejects.toThrow('요청하고');
    finish({ error: null }); await first;
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('duplicate@example.test', { redirectTo: 'https://app.test/auth/reset-password' });
    expect(emailWaitSeconds('reset', 'duplicate@example.test')).toBe(60);
    await expect(sendAuthEmail('reset', 'duplicate@example.test')).rejects.toThrow('잠시 후');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await sendAuthEmail('reset', 'duplicate@example.test');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
  });
  it('permits retry after network errors and waits after provider rate limits', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
    auth.resetPasswordForEmail.mockRejectedValueOnce(new Error('network'));
    await expect(sendAuthEmail('reset', 'retry@example.test')).rejects.toThrow('network');
    expect(emailWaitSeconds('reset', 'retry@example.test')).toBe(0);
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { status: 429, code: 'over_email_send_rate_limit' } });
    await expect(sendAuthEmail('reset', 'retry@example.test')).rejects.toMatchObject({ status: 429 });
    expect(emailWaitSeconds('reset', 'retry@example.test')).toBe(60);
  });
  it('starts the signup cooldown after initial signup and keeps reset requests independent', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
    startEmailCooldown('signup', 'new@example.test');
    await expect(sendAuthEmail('signup', 'new@example.test')).rejects.toThrow('잠시 후');
    expect(emailWaitSeconds('reset', 'new@example.test')).toBe(0);
    auth.resend.mockResolvedValue({ error: null });
    await sendAuthEmail('signup', 'confirm@example.test');
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'confirm@example.test', options: { emailRedirectTo: 'https://app.test/auth' } });
  });
});

it('keeps external calendar authorization separate from app login callbacks', () => {
  expect(readAuthCallback('https://app.test/integrations/google-calendar/callback?code=calendar-code&state=random-state')).toEqual({ isRecovery: false, hasCallback: false, error: null });
  expect(readAuthCallback('https://app.test/integrations/google-calendar/callback?error=access_denied')).toEqual({ isRecovery: false, hasCallback: false, error: null });
});


it.each(['google-drive','notion'])('keeps %s OAuth separate from app authentication', provider => {
  expect(readAuthCallback(`https://app.test/integrations/${provider}/callback?code=external&state=random-state`)).toEqual({isRecovery:false,hasCallback:false,error:null});
});
