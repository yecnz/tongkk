import { getSupabaseAuthHeader } from './supabase';

export const BACKEND_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  '/api'
).replace(/\/$/, '');

// FastAPI 에러 본문. HTTPException은 detail이 문자열이지만,
// 요청 검증 에러(422)는 detail이 [{ loc, msg, type }, ...] 객체 배열로 온다.
type ValidationErrorItem = { loc?: (string | number)[]; msg?: string; type?: string };
type ApiErrorBody = { detail?: string | ValidationErrorItem[] };

// detail이 문자열이든 검증 에러 객체 배열이든 사람이 읽을 문자열로 변환한다(없으면 null).
// 이 변환이 없으면 객체 배열이 그대로 new Error(...)로 넘어가 "[object Object]"가 표시된다.
function detailToMessage(detail: ApiErrorBody['detail']): string | null {
  if (typeof detail === 'string') return detail.trim() || null;
  if (Array.isArray(detail)) {
    const messages = detail
      .map(item => (typeof item?.msg === 'string' ? item.msg : null))
      .filter((msg): msg is string => Boolean(msg));
    if (messages.length) return messages.join(' / ');
  }
  return null;
}

const TUNNEL_TIMEOUT_STATUSES = [522, 524, 504];

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timerId);
      reject(abortError());
    };
    const timerId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Cloudflare 터널이 응답 100초 제한으로 522/524/504를 돌려줘도 백엔드는 처리를
 * 이어가 결과를 캐시에 적재하므로, 잠시 기다렸다 재시도하면 캐시를 타고 완주한다.
 */
export async function fetchWithTunnelRetry(
  url: string,
  init: RequestInit & { signal: AbortSignal },
  retryDelaysMs: number[],
): Promise<Response> {
  let response = await fetch(url, init);
  for (const delayMs of retryDelaysMs) {
    if (!TUNNEL_TIMEOUT_STATUSES.includes(response.status)) break;
    await sleepWithSignal(delayMs, init.signal);
    response = await fetch(url, init);
  }
  return response;
}

export async function parseApiError(response: Response): Promise<string> {
  if (TUNNEL_TIMEOUT_STATUSES.includes(response.status)) {
    return 'Cloudflare 터널에서 요청 시간이 초과되었습니다. 이미지가 많은 PDF라면 페이지 수를 줄이거나 잠시 후 다시 시도해주세요.';
  }

  const text = await response.text().catch(() => '');
  if (!text) return `API 오류 (${response.status})`;

  try {
    const parsed = JSON.parse(text) as ApiErrorBody;
    const detailMessage = detailToMessage(parsed.detail);
    if (detailMessage) return detailMessage;
  } catch {
    // Fall through to compact text response.
  }

  const compactText = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  return compactText
    ? `API 오류 (${response.status}): ${compactText}`
    : `API 오류 (${response.status})`;
}

export async function getJsonRequestHeaders(): Promise<HeadersInit> {
  return {
    'Content-Type': 'application/json',
    ...await getSupabaseAuthHeader(),
  };
}

export async function getAuthRequestHeaders(): Promise<HeadersInit> {
  return await getSupabaseAuthHeader();
}
