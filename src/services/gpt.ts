import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';

export type QuizQuestion = {
  type?: QuizQuestionType;
  question: string;
  options?: string[];
  answer?: number;
  answerText?: string;
  explanation: string;
};

export type QuizDifficulty = '쉬움' | '보통' | '어려움';
export type QuizQuestionType = '객관식' | 'OX' | '단답형' | '주관식';

export type SubjectiveGradeResult = {
  score: number;
  isCorrect: boolean;
  feedback: string;
  referenceAnswer: string;
};

export async function generateQuiz(
  subject: string,
  count: number,
  difficulty: QuizDifficulty,
  markdown?: string,
  signal?: AbortSignal,
  questionType: QuizQuestionType = '객관식',
  excludeQuestions: string[] = [],
  diagnostic = false,
): Promise<QuizQuestion[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(`${BACKEND_URL}/quiz`, {
      method: 'POST',
      headers: await getJsonRequestHeaders(),
      body: JSON.stringify({ subject, count, difficulty, markdown, question_type: questionType, exclude_questions: excludeQuestions, diagnostic }),
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

      if (type === '단답형' || type === '주관식') {
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

export async function gradeSubjectiveAnswer(
  question: string,
  referenceAnswer: string,
  studentAnswer: string,
  markdown?: string,
  signal?: AbortSignal,
): Promise<SubjectiveGradeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(`${BACKEND_URL}/quiz/grade-subjective`, {
      method: 'POST',
      headers: await getJsonRequestHeaders(),
      body: JSON.stringify({
        question,
        reference_answer: referenceAnswer,
        student_answer: studentAnswer,
        markdown,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as {
      score?: unknown;
      is_correct?: unknown;
      feedback?: unknown;
      reference_answer?: unknown;
    };
    const score = typeof data.score === 'number'
      ? Math.max(0, Math.min(100, Math.round(data.score)))
      : 0;

    return {
      score,
      isCorrect: typeof data.is_correct === 'boolean' ? data.is_correct : score >= 70,
      feedback: typeof data.feedback === 'string' ? data.feedback : '채점 결과를 확인했습니다.',
      referenceAnswer: typeof data.reference_answer === 'string' ? data.reference_answer : referenceAnswer,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('주관식 채점 시간이 초과되었습니다. 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export type WrongAnswerAnalysis = {
  summary: string;
  weaknesses: string[];
  studyPoints: string[];
  studyMethod: string;
  memorize: string[];
};

export type WrongAnalysisItem = {
  question: string;
  type: string;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
  isCorrect: boolean;
};

export async function analyzeWrongAnswers(
  subject: string,
  items: WrongAnalysisItem[],
  signal?: AbortSignal,
): Promise<WrongAnswerAnalysis> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(`${BACKEND_URL}/quiz/analyze-wrong`, {
      method: 'POST',
      headers: await getJsonRequestHeaders(),
      body: JSON.stringify({
        subject,
        items: items.map(item => ({
          question: item.question,
          type: item.type,
          student_answer: item.studentAnswer,
          correct_answer: item.correctAnswer,
          explanation: item.explanation,
          is_correct: item.isCorrect,
        })),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as {
      summary?: unknown;
      weaknesses?: unknown;
      studyPoints?: unknown;
      studyMethod?: unknown;
      memorize?: unknown;
    };
    const toStrList = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];

    return {
      summary: typeof data.summary === 'string' ? data.summary : '',
      weaknesses: toStrList(data.weaknesses),
      studyPoints: toStrList(data.studyPoints),
      studyMethod: typeof data.studyMethod === 'string' ? data.studyMethod : '',
      memorize: toStrList(data.memorize),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('오답 분석 시간이 초과되었습니다. 다시 시도해주세요.');
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
  opts?: { pages?: string; focusPrompt?: string; sourceNames?: string[] },
): Promise<SummaryResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 150_000);

  try {
    const response = await fetch(`${BACKEND_URL}/summarize`, {
      method: 'POST',
      headers: await getJsonRequestHeaders(),
      body: JSON.stringify({
        markdown,
        template,
        pages: opts?.pages?.trim() || undefined,
        focus_prompt: opts?.focusPrompt?.trim() || undefined,
        source_names: opts?.sourceNames?.length ? opts.sourceNames : undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as SummaryApiResponse;
    return { result: data.result, threadId: data.thread_id || data.threadId || '' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('요약 요청 시간 초과. Cloudflare 터널에서는 긴 요약 요청이 끊길 수 있어 페이지 수를 줄여 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
