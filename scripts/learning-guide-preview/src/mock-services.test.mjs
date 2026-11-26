import { beforeEach, expect, it, vi } from 'vitest';

let guide;
beforeEach(async () => {
  vi.resetModules();
  guide = await import('./mock-services.mjs');
});

async function start(target = 'concept-resource') {
  const path = await guide.workflowRequest('/learning-graph/paths', 'POST', {
    concept_id: target, idempotency_key: crypto.randomUUID(),
  });
  const step = path.steps.at(-1);
  const request = (suffix, body, method = 'POST') => guide.learningRequest(`/${step.session_id}/${suffix}`, method, body);
  return { path, step, request };
}

it.each([
  ['concept-resource', '프로세스'],
  ['concept-deadlock', '기다'],
])('reveals saved hints, reference and source for %s without advancing the answer', async (target, sourceText) => {
  const { request } = await start(target);
  const first = await request('help', { help_type: 'hint1' });
  expect(first.current.help.hint1).toBeTruthy();
  expect(first.current.phase).toBe('recall_answering');
  const second = await request('help', { help_type: 'hint2' });
  expect(second.current.help.hint1).toBe(first.current.help.hint1);
  expect(second.current.help.hint2).toBeTruthy();
  const reference = await request('help', { help_type: 'reference' });
  expect(reference.current.help.reference).toBeTruthy();
  const source = await request('help', { help_type: 'source' });
  expect(source.current.help.source).toContain(sourceText);
  expect(source.revision).toBeGreaterThan(first.revision);
});

it('preserves an autosaved answer while opening help and records help use in results', async () => {
  const { request } = await start();
  await request('draft', { text: '자원을 받아 사용하는 과정입니다.' }, 'PATCH');
  const helped = await request('help', { help_type: 'hint1' });
  expect(helped.current.draft).toBe('자원을 받아 사용하는 과정입니다.');
  await request('answers', { kind: 'recall', answer: helped.current.draft });
  await request('actions', { action: 'advance' });
  await request('answers', { kind: 'check', answer: 0 });
  const completed = await request('actions', { action: 'advance' });
  expect(completed.result[0].assisted).toBe(true);
});

it('lets an unknown answer use help before continuing to its check', async () => {
  const { request } = await start();
  const unknown = await request('actions', { action: 'unknown' });
  expect(unknown.current.phase).toBe('repair');
  const helped = await request('help', { help_type: 'hint1' });
  expect(helped.current.help.hint1).toBeTruthy();
  expect(helped.allowed_actions).toContain('advance');
  const check = await request('actions', { action: 'advance' });
  expect(check.current.phase).toBe('check_answering');
});

it('reports unsupported help requests instead of silently returning unchanged data', async () => {
  const { request } = await start();
  await expect(request('help', { help_type: 'missing' })).rejects.toThrow();
});
