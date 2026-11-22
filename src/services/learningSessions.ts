import { BACKEND_URL, getJsonRequestHeaders } from './backend';

export type Scope = { type: 'all' | 'pages' | 'units'; pages?: number[]; unit_ids?: string[] };
export type Scopes = {
  material_name: string; source_hash: string; total_chars: number; max_chars: number;
  units: { id: string; label: string; page: number | null; chars: number }[];
};
export type Feedback = { criteria: {
  criterion_id: string; status: 'met' | 'missing' | 'contradicted' | 'uncertain';
  student_quote: string; reason: string; source_refs: { unit_id: string; quote: string }[];
}[] };
export type SessionResult = {
  title: string; recall: 'sufficient' | 'needs_review' | 'uncertain' | 'ungraded' | 'self_report';
  check: 'correct' | 'incorrect' | 'ungraded'; assisted: boolean; prior_instruction: boolean;
  repeated: boolean; reported: boolean; skipped?: boolean;
};
export type LearningSession = {
  id: string; course_id: string; material_id: string; material_name: string;
  status: 'preparing' | 'active' | 'paused' | 'completed' | 'abandoned' | 'failed';
  revision: number; target_minutes: number; concept_count: number; completed_count: number;
  source_changed: boolean; allowed_actions: string[]; result: SessionResult[];
  operation: { id: string; kind: string; status: string; retryable: boolean; error_code: string | null } | null;
  current: {
    id: string; title: string; phase: string; revision: number; position: number; question: string;
    draft: string; introduction: string | null; help: Record<string, string | null>;
    feedback: Feedback | null; evaluation_error: boolean; self_check: string | null; reported: boolean;
    check: { question: string; options: string[] } | null;
    check_result: { answer_index: number; selected: number; correct: boolean; explanation: string } | null;
  } | null;
};
export type SessionSummary = Pick<LearningSession, 'id' | 'material_name' | 'status'> & { updated_at: string };

export function shouldAcceptSession(previous: LearningSession | null, next: LearningSession): boolean {
  if (!previous || previous.id !== next.id) return true;
  if (previous.revision !== next.revision) return next.revision > previous.revision;
  return previous.current?.id !== next.current?.id || (next.current?.revision ?? 0) >= (previous.current?.revision ?? 0);
}

export class LearningApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export async function learningRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BACKEND_URL}/learning-sessions${path}`, {
    method, headers: await getJsonRequestHeaders(), signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const code = typeof detail?.error_code === 'string' ? detail.error_code : 'REQUEST_FAILED';
    throw new LearningApiError(code === 'SETUP_REQUIRED' ? '학습 세션을 아직 사용할 수 없어요. 관리자에게 문의해주세요.' : typeof detail?.message === 'string' ? detail.message :
      (typeof detail === 'string' ? detail : Array.isArray(detail) ? '입력한 내용과 학습 범위를 확인해주세요.' : '학습 기록을 불러오지 못했습니다.'),
    response.status, code);
  }
  return data as T;
}

export const listLearningSessions = (signal?: AbortSignal) =>
  learningRequest<{ sessions: SessionSummary[] }>('', 'GET', undefined, signal);

const DRAFT_PREFIX = 'tongkk:learning-draft:';
export type LocalDraft = { text: string; revision: number };
export const draftKey = (user: string, session: string, item: string) => `${DRAFT_PREFIX}${user}:${session}:${item}`;

export function readLocalDraft(user: string, session: string, item: string): LocalDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(user, session, item)) || 'null');
    return value && typeof value.text === 'string' && value.text.length <= 4000 && Number.isInteger(value.revision)
      ? value : null;
  } catch { return null; }
}

export function writeLocalDraft(user: string, session: string, item: string, value: LocalDraft): boolean {
  try { localStorage.setItem(draftKey(user, session, item), JSON.stringify(value)); return true; }
  catch { return false; }
}

export function removeLocalDraft(user: string, session: string, item: string) {
  try { localStorage.removeItem(draftKey(user, session, item)); } catch { /* unavailable storage */ }
}

export function clearLearningDrafts(user: string) {
  try {
    const prefix = `${DRAFT_PREFIX}${user}:`;
    Object.keys(localStorage).filter(key => key.startsWith(prefix)).forEach(key => localStorage.removeItem(key));
  } catch { /* Private mode may disable storage. Server records remain authoritative. */ }
}

export type LearningHistoryItem = {
  id: string; title: string; position: number; question: string | null; answer: string | null;
  feedback: Feedback | null; help: Record<string, string | null>; check: NonNullable<LearningSession['current']>['check'];
  check_result: NonNullable<LearningSession['current']>['check_result']; skipped: boolean;
};
