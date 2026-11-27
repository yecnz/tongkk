// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readPrivateSessionDraft, syncPrivateSessionUser, writePrivateSessionDraft } from './privateSession';

beforeEach(() => sessionStorage.clear());
describe('private session drafts', () => {
  it('discards legacy drafts without a verified owner', () => {
    sessionStorage.setItem('tongkk:quizDraft', 'private answers');
    syncPrivateSessionUser('alice');
    expect(sessionStorage.getItem('tongkk:quizDraft')).toBeNull();
  });
  it('preserves same-account reloads but clears drafts before switching accounts', () => {
    syncPrivateSessionUser('alice');
    sessionStorage.setItem('tongkk:quizDraft', 'private answers');
    sessionStorage.setItem('tongkk:summaryViewDetail', 'private summary');
    syncPrivateSessionUser('alice');
    expect(sessionStorage.getItem('tongkk:quizDraft')).toBe('private answers');
    syncPrivateSessionUser('bob');
    expect(sessionStorage.getItem('tongkk:quizDraft')).toBeNull();
    expect(sessionStorage.getItem('tongkk:summaryViewDetail')).toBeNull();
  });
  it('clears previous-tab data when startup finds a signed-out session', () => {
    syncPrivateSessionUser('alice');
    sessionStorage.setItem('tongkk:quizDraft', 'private answers');
    syncPrivateSessionUser(null);
    expect(sessionStorage.getItem('tongkk:quizDraft')).toBeNull();
  });
  it('rejects late writes from the previous account after the cleanup', () => {
    syncPrivateSessionUser('alice');
    writePrivateSessionDraft('tongkk:quizDraft', { userId: 'alice', answer: 'private answer' });
    expect(readPrivateSessionDraft('tongkk:quizDraft', 'alice')).toMatchObject({ answer: 'private answer' });
    syncPrivateSessionUser('bob');
    writePrivateSessionDraft('tongkk:quizDraft', { userId: 'alice', answer: 'late private answer' });
    expect(sessionStorage.getItem('tongkk:quizDraft')).toBeNull();
  });
  it('never restores another owner or legacy ownerless answer even if it remains in storage', () => {
    sessionStorage.setItem('tongkk:quizDraft', JSON.stringify({ userId: 'alice', answer: 'private answer' }));
    expect(readPrivateSessionDraft('tongkk:quizDraft', 'bob')).toBeNull();
    expect(readPrivateSessionDraft('tongkk:quizDraft')).toBeNull();
    sessionStorage.setItem('tongkk:quizDraft', JSON.stringify({ answer: 'legacy private answer' }));
    expect(readPrivateSessionDraft('tongkk:quizDraft', 'alice')).toBeNull();
  });
});
