import { describe, expect, it } from 'vitest';
import {
  buildPaceCalendarEntries,
  isPaceSprint,
  paceCatchUpTarget,
  paceDateKey,
  paceExpectedUnits,
  paceNormalPerDay,
  paceProgressPct,
  paceReadiness,
  paceRemaining,
  paceStatus,
  paceTodayTarget,
  readinessTier,
  recentScoreAverage,
} from './pace';
import type { PacePlan } from './pace';

const JAN1 = new Date('2026-01-01T00:00:00').getTime();
const JAN6 = new Date('2026-01-06T00:00:00').getTime();

const mkPlan = (over: Partial<PacePlan> = {}): PacePlan => ({
  id: 'p1',
  course: '자료구조',
  ddayId: 'd1',
  totalUnits: 10,
  doneUnits: 0,
  createdAt: JAN1,
  ...over,
});

describe('paceRemaining / paceProgressPct', () => {
  it('남은 분량은 음수로 내려가지 않는다', () => {
    expect(paceRemaining(mkPlan({ totalUnits: 10, doneUnits: 3 }))).toBe(7);
    expect(paceRemaining(mkPlan({ totalUnits: 10, doneUnits: 12 }))).toBe(0);
  });

  it('진행률은 0~100으로 클램프된다', () => {
    expect(paceProgressPct(mkPlan({ totalUnits: 10, doneUnits: 3 }))).toBe(30);
    expect(paceProgressPct(mkPlan({ totalUnits: 0, doneUnits: 0 }))).toBe(0);
    expect(paceProgressPct(mkPlan({ totalUnits: 4, doneUnits: 10 }))).toBe(100);
  });
});

describe('paceTodayTarget', () => {
  it('남은 분량을 남은 일수로 나눠 올림하되 남은 분량을 넘지 않는다', () => {
    expect(paceTodayTarget(mkPlan({ totalUnits: 10, doneUnits: 0 }), 4)).toBe(3);
  });
  it('남은 일수가 0이면 1일로 간주한다', () => {
    expect(paceTodayTarget(mkPlan({ totalUnits: 10, doneUnits: 0 }), 0)).toBe(10);
  });
  it('남은 분량이 없으면 0', () => {
    expect(paceTodayTarget(mkPlan({ totalUnits: 10, doneUnits: 10 }), 5)).toBe(0);
  });
});

describe('paceExpectedUnits', () => {
  it('경과 비율에 비례한다(반쯤 지나면 절반)', () => {
    expect(paceExpectedUnits(mkPlan({ totalUnits: 10 }), '2026-01-11', JAN6)).toBe(5);
  });
  it('D-day가 생성일 이전이면 전체 분량을 기대치로 본다', () => {
    expect(paceExpectedUnits(mkPlan({ totalUnits: 10 }), '2025-12-31', JAN6)).toBe(10);
  });
});

describe('paceStatus', () => {
  const plan = (done: number) => mkPlan({ totalUnits: 10, doneUnits: done });
  it('기대치 이상이면 on', () => {
    expect(paceStatus(plan(5), '2026-01-11', JAN6)).toBe('on');
  });
  it('1 이내로 뒤처지면 slightly', () => {
    expect(paceStatus(plan(4), '2026-01-11', JAN6)).toBe('slightly');
  });
  it('많이 뒤처지면 behind', () => {
    expect(paceStatus(plan(3), '2026-01-11', JAN6)).toBe('behind');
  });
});

describe('paceNormalPerDay / paceCatchUpTarget', () => {
  it('하루 평소 분량은 전체/총일수 올림(최소 1)', () => {
    expect(paceNormalPerDay(mkPlan({ totalUnits: 25 }), '2026-01-11')).toBe(3);
    expect(paceNormalPerDay(mkPlan({ totalUnits: 10 }), '2026-01-11')).toBe(1);
  });
  it('따라잡기 목표는 cap·남은분량으로 클램프된다', () => {
    const plan = mkPlan({ totalUnits: 10, doneUnits: 3 });
    expect(paceCatchUpTarget(plan, '2026-01-11', 5, JAN6)).toBe(2);
  });
});

describe('recentScoreAverage / paceReadiness / readinessTier', () => {
  it('최근 점수에 가중치를 더 준다', () => {
    expect(recentScoreAverage([100])).toBe(100);
    expect(recentScoreAverage([])).toBeNull();
    expect(recentScoreAverage([100, 0])).toBeCloseTo(66.6667, 3);
  });
  it('준비도 = 진도 50% + 숙련도 50%', () => {
    expect(paceReadiness(mkPlan({ totalUnits: 10, doneUnits: 5 }), [80])).toBe(65);
    expect(paceReadiness(mkPlan({ totalUnits: 10, doneUnits: 5 }), [])).toBe(50);
  });
  it('티어 경계: 75=ready, 45=soon, 44=low', () => {
    expect(readinessTier(75)).toBe('ready');
    expect(readinessTier(45)).toBe('soon');
    expect(readinessTier(44)).toBe('low');
  });
});

describe('isPaceSprint / paceDateKey', () => {
  it('D-3 이내면 스퍼트', () => {
    expect(isPaceSprint(0)).toBe(true);
    expect(isPaceSprint(3)).toBe(true);
    expect(isPaceSprint(4)).toBe(false);
    expect(isPaceSprint(-1)).toBe(false);
  });
  it('로컬 날짜키는 YYYY-MM-DD로 0패딩', () => {
    expect(paceDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(paceDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('buildPaceCalendarEntries', () => {
  it('총 분량을 날짜별로 고르게 펼치고 상태를 매긴다', () => {
    const plan = mkPlan({ totalUnits: 2, doneUnits: 0 });
    const entries = buildPaceCalendarEntries([plan], { d1: '2026-01-02' }, {
      now: new Date('2026-01-01T00:00:00'),
    });
    expect(entries['2026-01-01']?.[0]).toMatchObject({ units: 1, status: 'today', readOnly: false });
    expect(entries['2026-01-02']?.[0]).toMatchObject({ units: 1, status: 'upcoming' });
    const total = Object.values(entries).flat().reduce((sum, e) => sum + e.units, 0);
    expect(total).toBe(2);
  });

  it('퀴즈 기준 플랜은 오늘 한 칸을 읽기 전용으로 둔다', () => {
    const plan = mkPlan({ totalUnits: 5, doneUnits: 0, basis: 'quiz' });
    const entries = buildPaceCalendarEntries([plan], { d1: '2026-01-02' }, {
      now: new Date('2026-01-01T00:00:00'),
    });
    expect(entries['2026-01-01']?.[0]).toMatchObject({ units: 5, readOnly: true, status: 'today' });
  });
});
