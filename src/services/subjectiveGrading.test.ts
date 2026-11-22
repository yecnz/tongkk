import { expect, it } from 'vitest';
import { normalizeSubjectiveScore, SUBJECTIVE_PASS_SCORE } from './subjectiveGrading';
it.each([undefined, null, true, false, '70', {}, [], NaN, Infinity, -Infinity])('rejects invalid grades (%s)', value => {
  expect(() => normalizeSubjectiveScore(value)).toThrow('다시 채점');
});
it.each([[-10, 0], [0, 0], [69.49, 69], [69.5, 70], [70.5, 71], [150, 100]])('normalizes %s consistently', (value, expected) => {
  expect(normalizeSubjectiveScore(value)).toBe(expected);
  expect(normalizeSubjectiveScore(value) >= SUBJECTIVE_PASS_SCORE).toBe(expected >= 70);
});
