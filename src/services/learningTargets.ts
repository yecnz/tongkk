export type ReviewTab = 'today' | 'issues' | 'wrong';
export function reviewTab(value: string | null): ReviewTab {
  return value === 'issues' || value === 'wrong' ? value : 'today';
}

export type LearningTarget =
  | { kind: 'session'; id: string }
  | { kind: 'review'; id: string }
  | { kind: 'issue'; id: string }
  | { kind: 'calendar'; date?: string; ddayId?: string; paceId?: string }
  | { kind: 'wrong'; course?: string };

export function calendarDateKey(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function learningTargetUrl(target: LearningTarget): string {
  switch (target.kind) {
    case 'session': return `/learn/${encodeURIComponent(target.id)}`;
    case 'review': return `/learn/review/${encodeURIComponent(target.id)}`;
    case 'issue': return `/review?${new URLSearchParams({ tab: 'issues', issueId: target.id })}`;
    case 'calendar': {
      const params = new URLSearchParams();
      const date = calendarDateKey(target.date);
      if (date) params.set('date', date);
      if (target.ddayId) params.set('ddayId', target.ddayId);
      if (target.paceId) params.set('paceId', target.paceId);
      return `/calendar${params.size ? `?${params}` : ''}`;
    }
    case 'wrong': {
      const params = new URLSearchParams({ tab: 'wrong' });
      if (target.course) params.set('course', target.course);
      return `/review?${params}`;
    }
  }
}
