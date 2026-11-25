import { expect, it } from 'vitest';
import { learningTargetUrl, reviewTab } from './learningTargets';

it('keeps targets internal and encodes identifiers', () => {
  expect(learningTargetUrl({ kind: 'review', id: 'a/b?x=1' })).toBe('/learn/review/a%2Fb%3Fx%3D1');
  expect(learningTargetUrl({ kind: 'issue', id: 'a&tab=wrong' })).toBe('/review?tab=issues&issueId=a%26tab%3Dwrong');
  expect(reviewTab('unknown')).toBe('today');
  expect(reviewTab('wrong')).toBe('wrong');
});
