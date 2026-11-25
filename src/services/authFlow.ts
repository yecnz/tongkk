export const RESET_PASSWORD_PATH = '/auth/reset-password';

export const isValidAuthEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export class AuthActionError extends Error {
  constructor(message: string, public code?: string, public status?: number, public retryAfter?: number) {
    super(message);
    this.name = 'AuthActionError';
  }
}

export function authErrorMessage(error: unknown, fallback = '인증 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
  const retryAfter = error instanceof AuthActionError ? error.retryAfter : undefined;
  const retry = retryAfter && retryAfter > 0
    ? `${retryAfter >= 60 ? `${Math.ceil(retryAfter / 60)}분` : `${Math.ceil(retryAfter)}초`} 후 다시 시도해주세요.`
    : '잠시 후 다시 시도해주세요.';
  const messages: Record<string, string> = {
    otp_expired: '링크가 만료되었거나 이미 사용되었습니다. 새 메일을 요청해주세요.',
    access_denied: '인증 링크를 확인할 수 없습니다. 새 메일을 요청해주세요.',
    email_not_confirmed: '이메일 인증을 완료해주세요. 인증 메일을 다시 받을 수 있습니다.',
    invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요. 다시 확인해주세요.',
    same_password: '기존 비밀번호와 다른 비밀번호를 입력해주세요.',
    weak_password: '비밀번호가 보안 기준에 맞지 않습니다. 더 길고 다양한 문자를 사용해주세요.',
    over_email_send_rate_limit: `메일 요청이 너무 많아요. ${retry}`,
    over_request_rate_limit: `요청이 너무 많아요. ${retry}`,
    account_locked: `로그인 실패가 반복돼 잠시 잠겼어요. ${retry}`,
    user_banned: '이 계정은 이용이 제한되어 있어요. 관리자에게 문의해주세요.',
    email_address_invalid: '이메일 주소를 다시 확인해주세요.',
    user_already_exists: '이미 가입된 이메일입니다. 로그인 또는 비밀번호 찾기를 이용해주세요.',
    email_exists: '이미 가입된 이메일이에요. 로그인 또는 비밀번호 찾기를 이용해주세요.',
    email_address_not_authorized: '이 이메일로 메일을 보낼 수 없어요. 관리자에게 문의해주세요.',
    signup_disabled: '지금은 회원가입이 중단되어 있어요. 잠시 후 다시 시도해주세요.',
    email_provider_disabled: '지금은 이메일 가입을 이용할 수 없어요. 관리자에게 문의해주세요.',
    session_not_found: '인증 시간이 만료됐어요. 다시 로그인하거나 새 재설정 메일을 받아주세요.',
    refresh_token_not_found: '인증 시간이 만료됐어요. 다시 로그인하거나 새 재설정 메일을 받아주세요.',
    refresh_token_already_used: '인증 시간이 만료됐어요. 다시 로그인하거나 새 재설정 메일을 받아주세요.',
    invalid_auth_response: '로그인 응답을 확인하지 못했어요. 잠시 후 다시 시도해주세요.',
  };
  if (messages[code]) return messages[code];
  if (status === 429) return `요청이 너무 많아요. ${retry}`;
  if (status && status >= 500) return '인증 서비스에 문제가 생겼어요. 잠시 후 다시 시도해주세요.';
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (name === 'AbortError' || name === 'TimeoutError') return '요청 시간이 초과됐어요. 잠시 후 다시 시도해주세요.';
  if (name === 'AuthSessionMissingError') return messages.session_not_found;
  if (name === 'AuthRetryableFetchError' || name === 'TypeError' && /fetch|network|load failed/i.test(message)) {
    return '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.';
  }
  if (error instanceof AuthActionError) return error.message;
  return fallback;
}

// 인증 오류는 알려진 코드·HTTP 상태만 안내한다. 프록시 HTML이나 서버 내부 설정을 노출하지 않는다.
export async function authResponseError(response: Response): Promise<AuthActionError> {
  const body: unknown = await response.json().catch(() => null);
  const providerCode = body && typeof body === 'object' && 'error_code' in body && typeof body.error_code === 'string'
    ? body.error_code : undefined;
  const code = providerCode || (response.status === 401 ? 'invalid_credentials' : undefined);
  const delay = Number(response.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(delay) && delay > 0 && delay <= 86_400 ? delay : undefined;
  const fallback = response.status === 422 ? '이메일 형식과 비밀번호를 확인해주세요.'
    : response.status === 403 ? '로그인 요청이 거부됐어요. 계정 상태를 확인해주세요.'
    : '로그인하지 못했어요. 입력한 정보를 확인하고 다시 시도해주세요.';
  return new AuthActionError(fallback, code, response.status, retryAfter);
}

export function readAuthCallback(href: string) {
  const url = new URL(href);
  if (/^\/integrations\/(google-calendar|google-drive|notion)\/callback$/.test(url.pathname)) return { isRecovery: false, hasCallback: false, error: null };
  const hash = new URLSearchParams(url.hash.slice(1));
  const get = (key: string) => hash.get(key) ?? url.searchParams.get(key);
  const hasError = Boolean(get('error') || get('error_code') || get('error_description') || url.searchParams.get('auth_error') === 'invalid_link');
  return {
    isRecovery: get('type') === 'recovery' && !hasError,
    hasCallback: hasError || Boolean(get('access_token') || get('code')),
    error: hasError ? authErrorMessage({ code: get('error_code') || get('error') },
      '인증 링크가 유효하지 않거나 만료되었습니다. 새 메일을 요청해주세요.') : null,
  };
}

// SDK 초기화가 끝난 뒤에만 호출한다. 오류 설명·인증 코드를 주소에 남기지 않는다.
export function cleanAuthCallbackUrl(href: string, failed = false): string {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const keys = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type',
    'provider_token', 'provider_refresh_token', 'code', 'type', 'error', 'error_code', 'error_description'];
  for (const key of keys) {
    hash.delete(key);
    url.searchParams.delete(key);
  }
  if (failed) url.searchParams.set('auth_error', 'invalid_link');
  else url.searchParams.delete('auth_error');
  url.hash = hash.toString();
  return url.pathname + url.search + url.hash;
}
