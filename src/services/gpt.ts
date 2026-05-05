const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export type QuizQuestion = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type QuizDifficulty = '쉬움' | '보통' | '어려움';

export async function generateQuiz(
  subject: string,
  count: number,
  difficulty: QuizDifficulty,
  markdown?: string,
): Promise<QuizQuestion[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${BACKEND_URL}/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, count, difficulty, markdown }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(err.detail || `API 오류 (${response.status})`);
    }

    const data = await response.json() as { questions: QuizQuestion[] };
    return data.questions;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('퀴즈 생성 시간 초과. 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export type SummaryTemplate = 'GENERAL' | 'LECTURE_NOTE' | 'MINDMAP' | 'CHEAT_SHEET';

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
 * Markdown 텍스트를 받아 고정 GPT Agent로 템플릿 요약
 */
export async function summarizeWithTemplate(
  markdown: string,
  template: SummaryTemplate,
): Promise<SummaryResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130_000);

  try {
    const response = await fetch(`${BACKEND_URL}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, template }),
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
