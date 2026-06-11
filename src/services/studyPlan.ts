import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';
import type { PlanAction } from './studyPlanner';

export type StudyPlanMode = 'balanced' | 'lighter' | 'harder' | 'assignment' | 'event' | 'reroll';

// 콜드 스타트 대응: 학습 기록이 없어도 좋은 계획을 짜도록 사용자가 알려주는 학습 상태.
export type StudyPlanGoal = 'exam' | 'assignment' | 'review';
export type StudyPlanFamiliarity = 'new' | 'attended' | 'reviewed';

// 데이터 기반 처방의 근거가 되는 과목별 학습 상태 요약.
export type StudyPlanCourseContext = {
  name: string;
  materials: number;
  summaries: number;
  quizSets: number;
  attempts: number;
  lastScorePercent: number | null;
  recentWrongCount: number;
  daysSinceLastAttempt: number | null;
};

// 간격 반복 복습 후보(며칠 전 학습한 내용).
export type StudyPlanReviewCandidate = {
  course: string;
  daysSince: number;
  scorePercent: number | null;
};

export type StudyPlanContext = {
  goal: StudyPlanGoal;
  familiarity: StudyPlanFamiliarity;
  dailyMinutes: number;
  courses?: StudyPlanCourseContext[];
  reviewCandidates?: StudyPlanReviewCandidate[];
};

export type StudyPlanDday = {
  id?: string;
  type?: 'assignment' | 'event' | 'exam';
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
  sourceType?: 'assignment' | 'event' | 'exam' | 'carryover' | 'review';
  action?: PlanAction | null;
  course?: string | null;
  dayOffset: number;
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
  context?: StudyPlanContext,
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
      goal: context?.goal,
      familiarity: context?.familiarity,
      daily_minutes: context?.dailyMinutes,
      courses: (context?.courses ?? []).map(course => ({
        name: course.name,
        materials: course.materials,
        summaries: course.summaries,
        quiz_sets: course.quizSets,
        attempts: course.attempts,
        last_score_percent: course.lastScorePercent,
        recent_wrong_count: course.recentWrongCount,
        days_since_last_attempt: course.daysSinceLastAttempt,
      })),
      review_candidates: (context?.reviewCandidates ?? []).map(candidate => ({
        course: candidate.course,
        days_since: candidate.daysSince,
        score_percent: candidate.scorePercent,
      })),
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
        action?: unknown;
        course?: unknown;
        day_offset?: unknown;
      };
      if (typeof candidate.text !== 'string' || !candidate.text.trim()) return [];
      const sourceTypes = ['assignment', 'event', 'exam', 'carryover', 'review'] as const;
      const actions = ['retry_quiz', 'review_wrong', 'review_summary', 'read_material', 'make_quiz'] as const;
      const normalized: GeneratedStudyPlanItem = {
        text: candidate.text.trim(),
        minutes: typeof candidate.minutes === 'number' ? candidate.minutes : 30,
        sourceId: typeof candidate.source_id === 'string' ? candidate.source_id : null,
        sourceType: sourceTypes.find(type => type === candidate.source_type) ?? 'assignment',
        action: actions.find(action => action === candidate.action) ?? null,
        course: typeof candidate.course === 'string' && candidate.course.trim() ? candidate.course.trim() : null,
        dayOffset: typeof candidate.day_offset === 'number' && Number.isFinite(candidate.day_offset)
          ? Math.max(0, Math.min(30, Math.round(candidate.day_offset)))
          : 0,
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
