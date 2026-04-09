const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

/**
 * Markdown 텍스트를 받아 Gemini로 요약 (백엔드 경유 — API 키는 서버에서 관리)
 */
export async function summarizeWithGemini(markdown) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130_000);

  try {
    const response = await fetch(`${BACKEND_URL}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'Gemini', markdown }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `API 오류 (${response.status})`);
    }

    const data = await response.json();
    return data.result;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('요약 요청 시간 초과. 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
