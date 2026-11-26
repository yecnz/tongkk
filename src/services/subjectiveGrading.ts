export const SUBJECTIVE_PASS_SCORE = 70;
export function normalizeSubjectiveScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('채점 결과를 확인하지 못했어요. 다시 채점해 주세요.');
  }
  return Math.round(Math.max(0, Math.min(100, value)));
}
