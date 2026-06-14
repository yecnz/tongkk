export type PacePlan = {
  id: string;
  course: string;
  ddayId: string;
  totalUnits: number;
  doneUnits: number;
  createdAt: number;
  unitLabel?: string;
  basis?: "pages" | "quiz" | "materials" | "manual";
  lastActivityAt?: number;
};

export type PaceStatus = "on" | "slightly" | "behind";

const DAY_MS = 86400000;

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

export const paceRemaining = (plan: PacePlan) => Math.max(plan.totalUnits - plan.doneUnits, 0);

export const paceProgressPct = (plan: PacePlan) =>
  plan.totalUnits > 0 ? clamp(Math.round((plan.doneUnits / plan.totalUnits) * 100), 0, 100) : 0;

export const paceTodayTarget = (plan: PacePlan, daysLeft: number) => {
  const remaining = paceRemaining(plan);
  if (remaining <= 0) return 0;
  return Math.min(remaining, Math.ceil(remaining / Math.max(daysLeft, 1)));
};

export const paceExpectedUnits = (plan: PacePlan, ddayDate: string, now = Date.now()) => {
  const end = new Date(`${ddayDate}T00:00:00`).getTime();
  const span = end - plan.createdAt;
  if (!Number.isFinite(span) || span <= 0) return plan.totalUnits;
  const elapsed = clamp(now - plan.createdAt, 0, span);
  return plan.totalUnits * (elapsed / span);
};

export const paceStatus = (plan: PacePlan, ddayDate: string, now = Date.now()): PaceStatus => {
  const expected = paceExpectedUnits(plan, ddayDate, now);
  const actual = plan.doneUnits;
  if (actual >= expected) return "on";
  if (expected - actual <= 1) return "slightly";
  return "behind";
};

export const paceNormalPerDay = (plan: PacePlan, ddayDate: string) => {
  const end = new Date(`${ddayDate}T00:00:00`).getTime();
  const totalDays = Math.max(Math.round((end - plan.createdAt) / DAY_MS), 1);
  return Math.max(Math.ceil(plan.totalUnits / totalDays), 1);
};

// behind 플랜이 오늘·내일에 나눠 따라잡도록 한 부족분을 더한 목표 (하루 상한 = 평소 페이스 * 1.8)
export const paceCatchUpTarget = (
  plan: PacePlan,
  ddayDate: string,
  daysLeft: number,
  now = Date.now(),
) => {
  const base = paceTodayTarget(plan, daysLeft);
  const deficit = Math.max(Math.ceil(paceExpectedUnits(plan, ddayDate, now) - plan.doneUnits), 0);
  const cap = Math.max(Math.round(paceNormalPerDay(plan, ddayDate) * 1.8), base);
  return clamp(base + Math.ceil(deficit / 2), 0, Math.min(cap, paceRemaining(plan)));
};

// ── P5. 시험 준비도 예측 ───────────────────────────────────────────────
// scores: 최신순(가장 최근이 앞)인 quizAttempts.scorePercent 배열.
// 최근 점수일수록 가중치를 크게(1, 1/2, 1/3 …) 줘서 추이를 반영한다.
export const recentScoreAverage = (scores: number[]): number | null => {
  if (scores.length === 0) return null;
  let weightSum = 0;
  let valueSum = 0;
  scores.slice(0, 5).forEach((score, index) => {
    const weight = 1 / (index + 1);
    weightSum += weight;
    valueSum += score * weight;
  });
  return weightSum > 0 ? valueSum / weightSum : null;
};

// 준비도 = 진도(coverage) 50% + 최근 점수(mastery) 50%. 점수 이력이 없으면 진도로 대체.
export const paceReadiness = (plan: PacePlan, scores: number[]): number => {
  const coverage = plan.totalUnits > 0 ? plan.doneUnits / plan.totalUnits : 0;
  const avg = recentScoreAverage(scores);
  const mastery = avg === null ? coverage : avg / 100;
  return clamp(Math.round((coverage * 0.5 + mastery * 0.5) * 100), 0, 100);
};

export type ReadinessTier = "ready" | "soon" | "low";

export const readinessTier = (pct: number): ReadinessTier =>
  pct >= 75 ? "ready" : pct >= 45 ? "soon" : "low";

// ── P6. 막판 스퍼트 ────────────────────────────────────────────────────
export const PACE_SPRINT_DAYS = 3;

// 연결 D-day가 오늘~D-3 사이면 스퍼트 구간(새 학습 중단 → 복습·시험모드).
export const isPaceSprint = (daysLeft: number) => daysLeft >= 0 && daysLeft <= PACE_SPRINT_DAYS;

export const paceDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const addDays = (date: Date, delta: number) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + delta);
  return next;
};

// ── 캘린더용: 페이스 플랜을 날짜별 학습 칩으로 펼친다 ────────────────────
// createdAt(생성일)부터 연결 D-day(없으면 horizonDays)까지 총 분량을 날짜별로 고르게
// 나누고, 누적 분배량과 doneUnits를 비교해 done/today/upcoming/overdue 상태를 매긴다.
// quiz 기준 플랜은 퀴즈 응시에서 자동 집계되므로 분배하지 않고 오늘 칸에 읽기 전용 한 칸만 둔다.
export type PaceEntryStatus = "done" | "today" | "upcoming" | "overdue";

export type PaceCalendarEntry = {
  planId: string;
  course: string;
  label: string;
  units: number;
  unitLabel: string;
  status: PaceEntryStatus;
  readOnly: boolean; // quiz 기준이면 true (체크 불가)
};

export type BuildPaceEntriesOptions = { now?: Date; horizonDays?: number };

export const buildPaceCalendarEntries = (
  plans: PacePlan[],
  // ddayId → "YYYY-MM-DD". Dday 타입을 직접 의존하지 않도록 맵으로 받는다.
  ddayDateById: Record<string, string>,
  options: BuildPaceEntriesOptions = {},
): Record<string, PaceCalendarEntry[]> => {
  const horizonDays = options.horizonDays ?? 14;
  const today = options.now ? new Date(options.now) : new Date();
  today.setHours(0, 0, 0, 0);

  const result: Record<string, PaceCalendarEntry[]> = {};
  const push = (date: Date, entry: PaceCalendarEntry) => {
    const key = paceDateKey(date);
    (result[key] ??= []).push(entry);
  };

  plans.forEach(plan => {
    const unitLabel = plan.unitLabel ?? "개";
    const done = Math.max(plan.doneUnits, 0);
    const total = Math.max(plan.totalUnits, 0);
    if (total <= 0) return;

    const start = new Date(plan.createdAt);
    start.setHours(0, 0, 0, 0);
    const ddayStr = plan.ddayId ? ddayDateById[plan.ddayId] : undefined;
    let end = ddayStr ? new Date(`${ddayStr}T00:00:00`) : addDays(start, horizonDays - 1);
    end.setHours(0, 0, 0, 0);
    if (end.getTime() < start.getTime()) end = start;

    // 퀴즈 기준: 분배 대신 오늘(범위 안으로 클램프) 한 칸만 읽기 전용으로.
    if (plan.basis === "quiz") {
      const clamped = Math.min(Math.max(today.getTime(), start.getTime()), end.getTime());
      const remaining = Math.max(total - done, 0);
      push(new Date(clamped), {
        planId: plan.id,
        course: plan.course,
        label: `${plan.course} 퀴즈 자동집계`,
        units: remaining,
        unitLabel,
        status: remaining <= 0 ? "done" : "today",
        readOnly: true,
      });
      return;
    }

    const totalDays = Math.max(Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1, 1);
    let prevCum = 0;
    for (let i = 0; i < totalDays; i++) {
      // 누적 목표를 반올림해 차분하면 합이 정확히 total이 되고 분량이 고르게 퍼진다.
      const cum = Math.round((total * (i + 1)) / totalDays);
      const units = cum - prevCum;
      prevCum = cum;
      if (units <= 0) continue;
      const day = addDays(start, i);
      let status: PaceEntryStatus;
      if (cum <= done) status = "done";
      else if (day.getTime() < today.getTime()) status = "overdue";
      else if (day.getTime() === today.getTime()) status = "today";
      else status = "upcoming";
      push(day, {
        planId: plan.id,
        course: plan.course,
        label: `${plan.course} ${units}${unitLabel}`,
        units,
        unitLabel,
        status,
        readOnly: false,
      });
    }
  });

  return result;
};
