import { describe, expect, it } from 'vitest';
import { buildBriefing } from './briefing';

describe('buildBriefing', () => {
  it('임박한 시험 → 밀린 진도 → 낮은 정답률 → 오늘 계획 순으로, 과목은 한 번만 보여준다', () => {
    const items = buildBriefing({
      ddays: [
        { subj: '자료구조', type: 'exam', daysLeft: 3 },
        { subj: '먼 시험', type: 'exam', daysLeft: 20 },
        { subj: '지난 과제', daysLeft: -1 },
      ],
      paces: [
        { course: '자료구조', status: 'behind', progress: 30, todayTarget: 5, unitLabel: '페이지' },
        { course: '운영체제', status: 'slightly', progress: 50, todayTarget: 2, unitLabel: '개' },
        { course: '선형대수', status: 'on', progress: 80, todayTarget: 1, unitLabel: '개' },
      ],
      scores: { 자료구조: [40.4, 90], 운영체제: [50], 확률통계: [60, 95], 선형대수: [100] },
      todayPlansLeft: 2,
    });

    expect(items.map(({ title, reason, urgent }) => ({ title, reason, urgent }))).toEqual([
      { title: '자료구조 시험 D-3', reason: '시험 3일 전 · 최근 정답률 40%', urgent: true },
      { title: '운영체제 진도 따라잡기', reason: '진도 50% · 오늘 2개', urgent: false },
      { title: '확률통계 오답 복습', reason: '최근 퀴즈 정답률 60%', urgent: false },
      { title: '오늘 계획 2개 남음', reason: '학습 캘린더에서 정한 할 일', urgent: false },
    ]);
  });

  it('데이터가 없으면 빈 목록', () => {
    expect(buildBriefing({ ddays: [], paces: [], scores: {}, todayPlansLeft: 0 })).toEqual([]);
  });
});
