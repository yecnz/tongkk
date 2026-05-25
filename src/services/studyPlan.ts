import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';

export type StudyPlanMode = 'balanced' | 'lighter' | 'harder' | 'assignment' | 'event' | 'reroll';

export type StudyPlanDday = {
  id?: string;
  type?: 'assignment' | 'event';
  subj: string;
  date: string;
};

export type StudyPlanCarryover = {
  id?: string;
  text: string;
  done: boolean;
};

export type GeneratedStudyPlanItem = {
  text: string;
  minutes: number;
  sourceId?: string | null;
  sourceType?: 'assignment' | 'event' | 'carryover';
};

export type GeneratedStudyPlan = {
  model: string;
  message: string;
  items: GeneratedStudyPlanItem[];
};

export async function generateStudyPlan(
  ddays: StudyPlanDday[],
  incompletePlans: StudyPlanCarryover[],
  mode: StudyPlanMode,
): Promise<GeneratedStudyPlan> {
  const response = await fetch(`${BACKEND_URL}/study-plan`, {
    method: 'POST',
    headers: await getJsonRequestHeaders(),
    body: JSON.stringify({
      ddays: ddays.map(dday => ({
        id: dday.id,
        type: dday.type || 'assignment',
        subj: dday.subj,
        date: dday.date,
      })),
      incomplete_plans: incompletePlans,
      mode,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const data = await response.json() as {
    model?: unknown;
    message?: unknown;
    items?: unknown;
  };

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error('유효한 학습 계획을 받지 못했습니다.');
  }

  const items: GeneratedStudyPlanItem[] = data.items
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as {
        text?: unknown;
        minutes?: unknown;
        source_id?: unknown;
        source_type?: unknown;
      };
      if (typeof candidate.text !== 'string' || !candidate.text.trim()) return [];
      const normalized: GeneratedStudyPlanItem = {
        text: candidate.text.trim(),
        minutes: typeof candidate.minutes === 'number' ? candidate.minutes : 30,
        sourceId: typeof candidate.source_id === 'string' ? candidate.source_id : null,
        sourceType: candidate.source_type === 'event' || candidate.source_type === 'carryover'
          ? candidate.source_type
          : 'assignment',
      };
      return [normalized];
    });

  if (items.length === 0) {
    throw new Error('유효한 학습 계획을 받지 못했습니다.');
  }

  return {
    model: typeof data.model === 'string' ? data.model : 'gpt-5.4-nano',
    message: typeof data.message === 'string' && data.message.trim()
      ? data.message.trim()
      : '오늘 할 일을 작게 나눠봤어요.',
    items,
  };
}
