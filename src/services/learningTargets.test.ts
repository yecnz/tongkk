import { expect, it } from 'vitest';
import { calendarDateKey, learningTargetUrl, reviewTab } from './learningTargets';

it('keeps targets internal and encodes identifiers', () => {
  expect(learningTargetUrl({ kind: 'review', id: 'a/b?x=1' })).toBe('/learn/review/a%2Fb%3Fx%3D1');
  expect(learningTargetUrl({ kind: 'issue', id: 'a&tab=wrong' })).toBe('/review?tab=issues&issueId=a%26tab%3Dwrong');
  expect(reviewTab('unknown')).toBe('today');
  expect(reviewTab('wrong')).toBe('wrong');
});

it('preserves calendar dates and selected items without allowing identifiers to alter the query', () => {
  const url = new URL(learningTargetUrl({ kind: 'calendar', date: '2026-12-02', ddayId: 'a&date=2000-01-01' }), 'https://local.invalid');
  expect(url.pathname).toBe('/calendar');
  expect(url.searchParams.get('date')).toBe('2026-12-02');
  expect(url.searchParams.get('ddayId')).toBe('a&date=2000-01-01');
  expect(new URL(learningTargetUrl({ kind: 'calendar', paceId: 'pace-1' }), url.origin).searchParams.get('paceId')).toBe('pace-1');
  expect(learningTargetUrl({ kind: 'calendar', date: '2026-02-30' })).toBe('/calendar');
});

it('accepts real calendar dates and keeps wrong-answer recommendations scoped to their course', () => {
  expect(calendarDateKey('2024-02-29')).toBe('2024-02-29');
  expect(calendarDateKey('2026-02-29')).toBeNull();
  expect(calendarDateKey('2026-13-01')).toBeNull();
  expect(calendarDateKey('11/25/2026')).toBeNull();
  const url = new URL(learningTargetUrl({ kind: 'wrong', course: '운영체제 & 자료구조' }), 'https://local.invalid');
  expect(url.searchParams.get('tab')).toBe('wrong');
  expect(url.searchParams.get('course')).toBe('운영체제 & 자료구조');
});
