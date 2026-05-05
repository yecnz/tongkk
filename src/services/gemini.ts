const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export type SummaryResponse = {
  result: string;
  threadId: string;
};

type SummaryApiResponse = {
  result: string;
  thread_id?: string;
  threadId?: string;
};

/**
 * Markdown 텍스트를 받아 Gemini Agent로 요약 (백엔드 경유 — API 키는 서버에서 관리)
 */
export async function summarizeWithGemini(markdown: string): Promise<SummaryResponse> {
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

    const data = await response.json() as SummaryApiResponse;
    return { result: data.result, threadId: data.thread_id || data.threadId || '' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('요약 요청 시간 초과. 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
