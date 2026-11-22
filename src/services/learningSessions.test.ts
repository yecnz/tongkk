import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./backend', () => ({ BACKEND_URL: '/api', getJsonRequestHeaders: async () => ({ Authorization: 'Bearer test' }) }));
import { clearLearningDrafts, draftKey, LearningApiError, learningRequest, readLocalDraft, shouldAcceptSession,
  writeLocalDraft, type LearningSession } from './learningSessions';

beforeEach(() => {
  const storage: Record<string, string> = {};
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: { value: (key: string, value: string) => { storage[key] = value; } },
    removeItem: { value: (key: string) => { delete storage[key]; } },
  });
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('learning draft ownership and recovery', () => {
  it('clears only the previous user on logout/account reset', () => {
    writeLocalDraft('alice', 's', 'i', { text: '내 설명', revision: 2 });
    writeLocalDraft('bob', 's', 'i', { text: '다른 사람', revision: 1 });
    clearLearningDrafts('alice');
    expect(readLocalDraft('alice', 's', 'i')).toBeNull();
    expect(readLocalDraft('bob', 's', 'i')?.text).toBe('다른 사람');
  });
  it('rejects damaged and oversized local values', () => {
    localStorage.setItem(draftKey('u', 's', 'i'), 'broken json');
    expect(readLocalDraft('u', 's', 'i')).toBeNull();
    localStorage.setItem(draftKey('u', 's', 'i'), JSON.stringify({ text: 'a'.repeat(4001), revision: 0 }));
    expect(readLocalDraft('u', 's', 'i')).toBeNull();
  });
  it('reports storage failure rather than promising recovery', () => {
    vi.stubGlobal('localStorage', { setItem() { throw new Error('quota exceeded'); } });
    expect(writeLocalDraft('u', 's', 'i', { text: '설명', revision: 0 })).toBe(false);
  });
});

it('ignores late polling/draft responses while accepting newer progress', () => {
  const previous = { id: 's', revision: 4, current: { id: 'i', revision: 3 } } as LearningSession;
  expect(shouldAcceptSession(previous, { ...previous, revision: 3 })).toBe(false);
  expect(shouldAcceptSession(previous, { ...previous, current: { ...previous.current!, revision: 2 } })).toBe(false);
  expect(shouldAcceptSession(previous, { ...previous, revision: 5 })).toBe(true);
});

it('keeps structured conflict information for recovery', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { error_code: 'REVISION_CONFLICT', message: '다른 화면에서 변경됨' } }), { status: 409 })));
  await expect(learningRequest('/s/actions', 'POST', {})).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT', message: '다른 화면에서 변경됨' });
});

it('sends one request without silently repeating model commands', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: { message: '일시 오류' } }), { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await expect(learningRequest('/s/answers', 'POST', { idempotency_key: 'same-key' })).rejects.toBeInstanceOf(LearningApiError);
  expect(fetch).toHaveBeenCalledTimes(1);
});
