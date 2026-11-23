import { expect, it } from 'vitest';
import { explanationChanges } from './explanationChanges';
it('keeps repeated lines and exposes the actual insertion and deletion', () => {
  const diff = explanationChanges('정의\n예시\n정의', '정의\n새 예시\n정의');
  expect(diff.filter(x => x.kind !== 'added').map(x => x.text).join('\n')).toBe('정의\n예시\n정의');
  expect(diff.filter(x => x.kind !== 'removed').map(x => x.text).join('\n')).toBe('정의\n새 예시\n정의');
  expect(diff.filter(x => x.kind === 'same')).toHaveLength(2);
});
it('bounds comparison work for many short lines', () => {
  expect(explanationChanges('a\n'.repeat(300), 'b\n'.repeat(300)).map(x => x.kind)).toEqual(['removed', 'added']);
});
