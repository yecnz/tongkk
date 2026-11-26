/** The same score has the same meaning in results, review and statistics. */
export const scoreTone = (score: number): 'strong' | 'developing' | 'needs-review' =>
  score >= 80 ? 'strong' : score >= 50 ? 'developing' : 'needs-review';

export const scoreColor = (score: number) => ({
  strong: 'var(--color-cyan-deep)',
  developing: 'var(--color-text-secondary)',
  'needs-review': 'var(--color-pink-deep)',
})[scoreTone(score)];

export const scoreSurface = (score: number) => ({
  strong: 'var(--color-tint-cyan)',
  developing: 'var(--color-muted-surface)',
  'needs-review': 'var(--color-tint-pink)',
})[scoreTone(score)];
