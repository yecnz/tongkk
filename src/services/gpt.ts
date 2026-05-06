const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

export type QuizQuestion = {
  type?: QuizQuestionType;
  question: string;
  options?: string[];
  answer?: number;
  answerText?: string;
  explanation: string;
};

export type QuizDifficulty = '쉬움' | '보통' | '어려움';
export type QuizQuestionType = '객관식' | 'OX' | '단답형';

type ApiErrorBody = { detail?: string };

async function parseApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `API 오류 (${response.status})`;

  try {
    const parsed = JSON.parse(text) as ApiErrorBody;
    if (parsed.detail) return parsed.detail;
  } catch {
    // JSON이 아닌 응답(HTML/text)일 수 있으므로 fallback 메시지 사용
  }

  const compactText = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  return compactText
    ? `API 오류 (${response.status}): ${compactText}`
    : `API 오류 (${response.status})`;
}

export async function generateQuiz(
  subject: string,
  count: number,
  difficulty: QuizDifficulty,
  markdown?: string,
  signal?: AbortSignal,
  questionType: QuizQuestionType = '객관식',
): Promise<QuizQuestion[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(`${BACKEND_URL}/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, count, difficulty, markdown, question_type: questionType }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as { questions: unknown };

    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('유효한 퀴즈 데이터를 받지 못했습니다.');
    }

    for (const q of data.questions) {
      if (!q || typeof q !== 'object') {
        throw new Error('퀴즈 데이터 형식이 올바르지 않습니다.');
      }

      const question = q as QuizQuestion;
      const type = question.type || questionType;
      const hasBaseFields =
        typeof question.question === 'string' &&
        question.question.trim().length > 0 &&
        typeof question.explanation === 'string' &&
        question.explanation.trim().length > 0;

      if (!hasBaseFields) throw new Error('퀴즈 데이터 형식이 올바르지 않습니다.');

      if (type === '단답형') {
        if (typeof question.answerText !== 'string' || question.answerText.trim().length === 0) {
          throw new Error('퀴즈 데이터 형식이 올바르지 않습니다.');
        }
        continue;
      }

      if (
        !Array.isArray(question.options) ||
        question.options.length === 0 ||
        typeof question.answer !== 'number' ||
        question.answer < 0 ||
        question.answer >= question.options.length
      ) {
        throw new Error('퀴즈 데이터 형식이 올바르지 않습니다.');
      }
    }

    return data.questions as QuizQuestion[];
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (signal?.aborted) {
        throw new Error('퀴즈 생성이 취소되었습니다.');
      }
      throw new Error('퀴즈 생성 시간 초과. 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
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
      throw new Error(await parseApiError(response));
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
