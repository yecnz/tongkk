const OWNER_KEY = 'tongkk:privateSessionOwner';
const PRIVATE_KEYS = ['tongkk:quizDraft', 'tongkk:summaryViewDetail'];

// These legacy drafts contain questions and answers but have no embedded owner.
// Keep same-account reloads working and discard them before a new account renders.
export function syncPrivateSessionUser(userId: string | null): void {
  try {
    const owner = userId || '';
    if (sessionStorage.getItem(OWNER_KEY) !== owner) {
      for (const key of PRIVATE_KEYS) sessionStorage.removeItem(key);
      sessionStorage.setItem(OWNER_KEY, owner);
    }
  } catch { /* Storage can be disabled. */ }
}

export function readPrivateSessionDraft<T extends { userId: string }>(key: string, userId?: string): T | null {
  if (!userId) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as T | null;
    return value?.userId === userId ? value : null;
  } catch { return null; }
}

export function writePrivateSessionDraft<T extends { userId: string }>(key: string, draft: T): void {
  try {
    // A pending effect from the previous account must not restore cleared data.
    if (sessionStorage.getItem(OWNER_KEY) === draft.userId) sessionStorage.setItem(key, JSON.stringify(draft));
  } catch { /* Draft recovery is optional when storage is full or disabled. */ }
}
