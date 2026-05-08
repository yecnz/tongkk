export const BACKEND_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

type ApiErrorBody = { detail?: string };

export async function parseApiError(response: Response): Promise<string> {
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
