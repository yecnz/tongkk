import { getSupabaseAuthHeader } from './supabase';

export const BACKEND_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  '/api'
).replace(/\/$/, '');

type ApiErrorBody = { detail?: string };

export async function parseApiError(response: Response): Promise<string> {
  if ([522, 524, 504].includes(response.status)) {
    return 'Cloudflare 터널에서 요청 시간이 초과되었습니다. 이미지가 많은 PDF라면 페이지 수를 줄이거나 잠시 후 다시 시도해주세요.';
  }

  const text = await response.text().catch(() => '');
  if (!text) return `API 오류 (${response.status})`;

  try {
    const parsed = JSON.parse(text) as ApiErrorBody;
    if (parsed.detail) return parsed.detail;
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
