export type PacePlan = {
  id: string;
  course: string;
  ddayId: string;
  totalUnits: number;
  doneUnits: number;
  createdAt: number;
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

export const paceGapDays = (lastActivityAt: number | undefined, now = Date.now()) => {
  if (!lastActivityAt) return 0;
  return Math.max(Math.floor((now - lastActivityAt) / DAY_MS), 0);
};

// 놓침 복구: 새 분량의 70%만 (약한 개념부터 가볍게 복귀)
export const paceRecoveryTarget = (plan: PacePlan, daysLeft: number) =>
  Math.max(Math.ceil(paceTodayTarget(plan, daysLeft) * 0.7), paceRemaining(plan) > 0 ? 1 : 0);

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

// ── P7/P8. 일별 학습 기록 기반 스트릭 + 주간 회고 ──────────────────────
// PaceLog: dateKey("YYYY-MM-DD") → 그날 완료한 단위 수.
export type PaceLog = Record<string, number>;

export const paceDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const addDays = (date: Date, delta: number) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + delta);
  return next;
};

// 연속 학습일. 주 1회 '휴식권'으로 한 번의 공백은 streak를 끊지 않는다.
// 오늘 아직 안 했어도 어제까지의 streak는 유지된다(오늘은 진행 중으로 간주).
export const paceStreak = (
  log: PaceLog,
  now = new Date(),
): { days: number; restUsed: boolean } => {
  let days = 0;
  let restUsed = false;
  for (let i = 0; i < 400; i++) {
    const active = (log[paceDateKey(addDays(now, -i))] ?? 0) > 0;
    if (active) {
      days += 1;
      continue;
    }
    if (i === 0) continue; // 오늘은 아직 진행 중일 수 있으니 끊지 않는다
    if (!restUsed) {
      restUsed = true; // 휴식권 1회 사용, streak 유지
      continue;
    }
    break;
  }
  return { days, restUsed };
};

// 최근 7일(오늘 포함) 동안의 학습 단위 합과 활동 일수.
export const paceWeekStats = (
  log: PaceLog,
  now = new Date(),
): { units: number; activeDays: number } => {
  let units = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) {
    const value = log[paceDateKey(addDays(now, -i))] ?? 0;
    if (value > 0) {
      units += value;
      activeDays += 1;
    }
  }
  return { units, activeDays };
};

// 다음 주 목표: 이번 주 실적과 전체 잔여 분량을 보고 무리 없는 주간 목표를 제안.
export const paceWeeklyGoal = (thisWeekUnits: number, totalRemaining: number): number => {
  const base = Math.max(thisWeekUnits, 1);
  const suggested = Math.ceil(base * 1.1); // 이번 주보다 살짝 높게
  return clamp(suggested, 1, Math.max(totalRemaining, 1));
};
