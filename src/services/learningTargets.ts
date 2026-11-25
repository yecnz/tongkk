export type ReviewTab = 'today' | 'issues' | 'wrong';
export function reviewTab(value: string | null): ReviewTab {
  return value === 'issues' || value === 'wrong' ? value : 'today';
}

export type LearningTarget =
  | { kind: 'session'; id: string }
  | { kind: 'review'; id: string }
  | { kind: 'issue'; id: string }
  | { kind: 'calendar' }
  | { kind: 'wrong' };

export function learningTargetUrl(target: LearningTarget): string {
  switch (target.kind) {
    case 'session': return `/learn/${encodeURIComponent(target.id)}`;
    case 'review': return `/learn/review/${encodeURIComponent(target.id)}`;
    case 'issue': return `/review?${new URLSearchParams({ tab: 'issues', issueId: target.id })}`;
    case 'calendar': return '/calendar';
    case 'wrong': return '/review?tab=wrong';
  }
}
