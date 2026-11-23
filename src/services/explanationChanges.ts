export type ExplanationChange = { kind: 'same' | 'added' | 'removed'; text: string };
export function explanationChanges(before: string, after: string): ExplanationChange[] {
  const a = before.split('\n'), b = after.split('\n');
  if (a.length > 200 || b.length > 200) return before === after ? [{ kind: 'same', text: before }] : [{ kind: 'removed', text: before }, { kind: 'added', text: after }];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const changes: ExplanationChange[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { changes.push({ kind: 'same', text: a[i++] }); j++; }
    else if (j < b.length && (i === a.length || table[i][j + 1] > table[i + 1][j])) changes.push({ kind: 'added', text: b[j++] });
    else changes.push({ kind: 'removed', text: a[i++] });
  }
  return changes;
}
