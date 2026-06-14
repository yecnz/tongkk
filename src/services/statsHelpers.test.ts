import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  averageScore,
  coursePerformance,
  inferWeakTopicFromQuestion,
  normalizeWeakTopic,
  recentAttempts,
  scoreTrend,
  studyStreak,
  totalQuestionCount,
  totalStudyMinutes,
} from './statsHelpers';
import type { SavedQuizAttempt, SavedQuizAttemptWithCourse } from './quizAttempts';

const mkAttempt = (over: Partial<SavedQuizAttempt> = {}): SavedQuizAttempt => ({
  id: 'a',
  quizSetId: null,
  difficulty: '보통',
  questionType: '객관식',
  count: 10,
  correctCount: 8,
  scorePercent: 80,
  weakTopics: [],
  answers: [],
  durationSeconds: 600,
  timedOut: false,
  materialIds: [],
  createdAt: 0,
  ...over,
});

describe('normalizeWeakTopic / inferWeakTopicFromQuestion', () => {
  it('빈 문자열은 빈 결과', () => {
    expect(normalizeWeakTopic('')).toBe('');
  });
  it("'곰팡' 특수 보정", () => {
    expect(normalizeWeakTopic('곰팡')).toBe('곰팡이');
  });
  it('따옴표로 감싼 주제를 그대로 뽑는다', () => {
    expect(normalizeWeakTopic('「퀵 정렬」')).toBe('퀵 정렬');
  });
  it("'X 정렬의 수행 시간' → 'X 정렬'", () => {
    expect(normalizeWeakTopic('버블 정렬의 수행 시간')).toBe('버블 정렬');
  });
  it('inferWeakTopicFromQuestion은 normalizeWeakTopic에 위임', () => {
    expect(inferWeakTopicFromQuestion('곰팡')).toBe('곰팡이');
  });
});

describe('scoreTrend', () => {
  it('생성 시각 오름차순으로 정렬해 점수 추이를 만든다', () => {
    const trend = scoreTrend([
      mkAttempt({ createdAt: new Date('2026-03-02T10:00:00').getTime(), scorePercent: 90 }),
      mkAttempt({ createdAt: new Date('2026-03-01T10:00:00').getTime(), scorePercent: 70 }),
    ]);
    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({ date: '2026-03-01', scorePercent: 70 });
    expect(trend[1]).toMatchObject({ date: '2026-03-02', scorePercent: 90 });
  });
});

describe('studyStreak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('오늘·어제 연속 학습이면 2', () => {
    const today = new Date('2026-06-14T12:00:00').getTime();
    const attempts = [
      mkAttempt({ createdAt: today }),
      mkAttempt({ createdAt: today - 86_400_000 }),
    ];
    expect(studyStreak(attempts)).toBe(2);
  });
  it('기록이 없으면 0', () => {
    expect(studyStreak([])).toBe(0);
  });
});

describe('집계 헬퍼', () => {
  it('averageScore는 반올림 평균, 빈 배열은 0', () => {
    expect(averageScore([mkAttempt({ scorePercent: 80 }), mkAttempt({ scorePercent: 90 })])).toBe(85);
    expect(averageScore([])).toBe(0);
  });
  it('totalQuestionCount는 count 합', () => {
    expect(totalQuestionCount([mkAttempt({ count: 10 }), mkAttempt({ count: 5 })])).toBe(15);
  });
  it('totalStudyMinutes는 초→분(올림 아님, 반올림)이고 null은 0으로 취급', () => {
    expect(totalStudyMinutes([mkAttempt({ durationSeconds: 600 }), mkAttempt({ durationSeconds: null })])).toBe(10);
  });
  it('recentAttempts는 최신순 정렬 후 limit만큼', () => {
    const result = recentAttempts(
      [
        mkAttempt({ id: '1', createdAt: 1 }),
        mkAttempt({ id: '2', createdAt: 2 }),
        mkAttempt({ id: '3', createdAt: 3 }),
      ],
      2,
    );
    expect(result.map(a => a.id)).toEqual(['3', '2']);
  });
});

describe('coursePerformance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('과목별로 묶어 평균·문항수·응시수를 집계한다', () => {
    const base = new Date('2026-06-14T10:00:00').getTime();
    const withCourse = (over: Partial<SavedQuizAttemptWithCourse>): SavedQuizAttemptWithCourse => ({
      ...mkAttempt(),
      courseName: '수학',
      ...over,
    });
    const result = coursePerformance([
      withCourse({ courseName: '수학', scorePercent: 80, count: 10, createdAt: base }),
      withCourse({ courseName: '수학', scorePercent: 100, count: 10, createdAt: base + 1000 }),
      withCourse({ courseName: '영어', scorePercent: 60, count: 5, createdAt: base - 1000 }),
    ]);
    const math = result.find(r => r.courseName === '수학');
    const eng = result.find(r => r.courseName === '영어');
    expect(math).toMatchObject({ attempts: 2, averageScore: 90, totalQuestions: 20 });
    expect(eng).toMatchObject({ attempts: 1, averageScore: 60, totalQuestions: 5 });
    // 최신 응시(latestAt)가 더 늦은 수학이 앞에 온다.
    expect(result[0].courseName).toBe('수학');
  });
});
