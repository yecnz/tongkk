// Local transport for the actual learning screens. No server or AI requests are made.
export type Feedback = { criteria: { criterion_id: string; status: 'met' | 'missing' | 'contradicted' | 'uncertain'; student_quote: string; reason: string; source_refs: { unit_id: string; quote: string }[] }[] };
export type SessionResult = { title: string; recall: string; check: string; assisted: boolean; prior_instruction: boolean; repeated: boolean; reported: boolean; skipped?: boolean };
export type LearningItem = { id: string; title: string; phase: string; revision: number; position: number; question: string; draft: string; introduction: string | null; help: Record<string, string | null>; feedback: Feedback | null; evaluation_error: boolean; self_check: string | null; reported: boolean; check: { question: string; options: string[] } | null; check_result: { answer_index: number; selected: number; correct: boolean; explanation: string } | null };
export type LearningSession = { id: string; course_id: string; material_id: string; material_name: string; status: string; revision: number; target_minutes: number; concept_count: number; completed_count: number; source_changed: boolean; allowed_actions: string[]; result: SessionResult[]; operation: null; current: LearningItem | null };
export type SessionSummary = Pick<LearningSession, 'id' | 'material_name' | 'status'> & { updated_at: string };
export type LocalDraft = { text: string; revision: number };
export type Scopes = { material_name: string; source_hash: string; total_chars: number; max_chars: number; units: { id: string; label: string; page: number | null; chars: number }[] };
export type LearningHistoryItem = Omit<LearningItem, 'draft'> & { answer: string; skipped: boolean };
export class LearningApiError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }
const copy = <T,>(value: T): T => structuredClone(value);
const history: Record<string, LearningHistoryItem[]> = {};
const sessions: Record<string, LearningSession> = {};
const drafts = new Map<string, LocalDraft>();

const concepts = [
  { title: '퀵 정렬의 평균과 최악 시간 복잡도', question: '퀵 정렬은 평균적으로 빠른데, 왜 최악의 경우에는 느려질 수 있을까요? 피벗과 분할 크기를 연결해 설명해보세요.',
    introduction: '**퀵 정렬**은 피벗을 기준으로 작은 값과 큰 값으로 나눈 뒤 각각 정렬합니다.\n\n분할이 균형적이면 단계 수는 약 $\\log n$이고, 매 단계에서 총 $n$개를 비교해 평균 $O(n\\log n)$입니다. 한쪽에 계속 몰리면 단계가 $n$에 가까워져 최악 $O(n^2)$이 됩니다.',
    hint1: '피벗을 정한 뒤 두 부분의 크기가 비슷한 경우와, 한쪽에 값이 몰리는 경우를 비교해보세요.',
    hint2: '균형 분할에서는 재귀 깊이가 log n입니다. 매번 0개와 n−1개로 나뉘면 깊이가 n에 가까워집니다.',
    reference: '퀵 정렬은 피벗을 기준으로 배열을 나눕니다. 균형 잡힌 분할은 O(log n)단계이며 단계마다 O(n) 비교가 필요해 평균 O(n log n)입니다. 한쪽으로 치우친 분할이 반복되면 n단계가 생겨 최악 O(n²)이 됩니다.',
    check: { question: '피벗이 매번 가장 작은 값이어서 0개와 n−1개로 나뉜다면, 퀵 정렬의 시간 복잡도는?', options: ['O(1)', 'O(log n)', 'O(n log n)', 'O(n²)'] }, answer: 3,
    source: '평균 O(n log n), 최악 O(n²). 피벗에 따라 분할 균형이 달라진다.',
  },
  { title: '정렬의 안정성', question: '점수가 같은 학생들을 이름순으로 미리 정렬했습니다. 점수순으로 다시 정렬해도 같은 점수 안에서 이름순이 유지되려면 어떤 성질이 필요할까요?',
    introduction: '**안정 정렬**은 같은 키를 가진 원소들의 원래 상대 순서를 보존합니다. 병합 정렬과 삽입 정렬은 구현 조건에 따라 안정성을 유지할 수 있고, 일반적인 선택 정렬은 보장하지 않습니다.',
    hint1: '값이 같은 두 원소가 정렬 전후에 같은 순서인지 생각해보세요.',
    hint2: '이미 이름으로 정렬한 순서가 점수가 같은 그룹 안에서 유지되어야 합니다.',
    reference: '안정 정렬이 필요합니다. 같은 점수인 학생들끼리 입력 시점의 상대 순서가 유지되므로, 먼저 만든 이름순이 보존됩니다.',
    check: { question: '안정 정렬이 보존하는 것은 무엇인가요?', options: ['입력 배열 전체의 순서', '같은 키를 가진 원소의 상대 순서', '항상 O(n)의 실행 시간', '추가 메모리 없이 정렬하는 성질'] }, answer: 1,
    source: '안정성: 같은 값을 가진 원소의 상대적 순서를 유지하는 성질.',
  },
];

function itemAt(position: number): LearningItem {
  const concept = concepts[position % concepts.length];
  return { id: `item-demo-${position}`, title: concept.title, phase: 'recall_answering', revision: 1, position,
    question: concept.question, draft: '', introduction: concept.introduction, help: {}, feedback: null,
    evaluation_error: false, self_check: null, reported: false, check: null, check_result: null };
}
function newSession(id = 'demo-session', count = 2): LearningSession {
  return { id, course_id: 'course-demo', material_id: 'material-demo', material_name: '알고리즘 3주차 강의자료.pdf',
    status: 'active', revision: 1, target_minutes: 15, concept_count: Math.min(4, Math.max(1, count)), completed_count: 0,
    source_changed: false, allowed_actions: ['help', 'pause', 'finish', 'abandon', 'unknown', 'skip'], result: [], operation: null, current: itemAt(0) };
}
export function demoFeedback(answer: string, position = 0): Feedback {
  const concept = concepts[position % concepts.length];
  return { criteria: [
    { criterion_id: 'sample-feedback', status: 'uncertain', student_quote: answer, reason: '예시 피드백입니다. 입력한 설명을 실제 AI가 평가한 결과는 아닙니다. 아래 원문 근거와 비교하며 핵심 개념이 포함됐는지 확인해보세요.', source_refs: [{ unit_id: 'unit-demo-1', quote: concept.source }] },
    { criterion_id: 'sample-key-point', status: 'missing', student_quote: '', reason: `이해를 확인할 핵심: ${concept.reference}`, source_refs: [{ unit_id: 'unit-demo-1', quote: concept.source }] },
  ] };
}
function syncActions(session: LearningSession) {
  if (['completed', 'abandoned'].includes(session.status)) { session.allowed_actions = []; return; }
  if (session.status === 'paused') { session.allowed_actions = ['resume', 'abandon']; return; }
  session.allowed_actions = ['help', 'pause', 'finish', 'abandon', 'skip'];
  if (session.current?.phase === 'recall_answering') session.allowed_actions.push('unknown');
  if (['recall_feedback', 'repair', 'check_feedback'].includes(session.current?.phase || '')) session.allowed_actions.push('advance');
  if (session.current?.phase === 'repair') session.allowed_actions.push('self_check');
}
function finishItem(session: LearningSession, skipped = false) {
  const item = session.current;
  if (!item) return;
  (history[session.id] ||= []).push({ ...copy(item), answer: item.draft, skipped });
  session.result.push({ title: item.title, recall: item.feedback ? 'uncertain' : item.self_check ? 'self_report' : 'ungraded',
    check: item.check_result ? item.check_result.correct ? 'correct' : 'incorrect' : 'ungraded',
    assisted: Object.values(item.help).some(Boolean), prior_instruction: true, repeated: false, reported: item.reported, skipped });
  session.completed_count += 1;
}
function advance(session: LearningSession, skipped = false) {
  finishItem(session, skipped);
  if (session.completed_count >= session.concept_count) { session.status = 'completed'; session.current = null; }
  else session.current = itemAt(session.completed_count);
}
export function resetLearningSessions() {
  Object.keys(sessions).forEach(key => delete sessions[key]); Object.keys(history).forEach(key => delete history[key]); drafts.clear();
  sessions['demo-session'] = newSession();
  sessions['demo-session-paused'] = { ...newSession('demo-session-paused'), status: 'paused', allowed_actions: ['resume', 'abandon'] };
  const completed = newSession('demo-session-completed');
  for (let position = 0; position < 2; position += 1) {
    completed.current = itemAt(position);
    completed.current.draft = position === 0 ? '퀵 정렬은 항상 반으로 나누어서 O(n log n)입니다.' : '같은 키를 가진 원소들의 상대 순서를 유지합니다.';
    completed.current.feedback = demoFeedback(completed.current.draft, position);
    completed.current.phase = 'check_feedback';
    completed.current.check = copy(concepts[position].check);
    completed.current.check_result = { answer_index: concepts[position].answer, selected: concepts[position].answer, correct: true, explanation: concepts[position].reference };
    finishItem(completed);
  }
  completed.status = 'completed'; completed.current = null; completed.allowed_actions = [];
  sessions[completed.id] = completed;
}
resetLearningSessions();
export const shouldAcceptSession = (previous: LearningSession | null, next: LearningSession) => !previous || previous.id !== next.id || next.revision >= previous.revision;
export const listLearningSessions = async () => ({ sessions: Object.values(sessions).filter(s => !['completed', 'abandoned'].includes(s.status)).map(s => ({ id: s.id, material_name: s.material_name, status: s.status, updated_at: new Date().toISOString() })) });
export const draftKey = (user: string, session: string, item: string) => `${user}:${session}:${item}`;
export const readLocalDraft = (user: string, session: string, item: string) => copy(drafts.get(draftKey(user, session, item)) || null);
export const writeLocalDraft = (user: string, session: string, item: string, value: LocalDraft) => { drafts.set(draftKey(user, session, item), copy(value)); return true; };
export const removeLocalDraft = (user: string, session: string, item: string) => { drafts.delete(draftKey(user, session, item)); };
export const clearLearningDrafts = () => drafts.clear();

export async function learningRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const request = (body || {}) as Record<string, unknown>;
  if (path.startsWith('/scopes')) return copy({ material_name: '알고리즘 3주차 강의자료.pdf', source_hash: 'demo-source', total_chars: 2800, max_chars: 60000,
    units: [{ id: 'unit-demo-1', label: '시간 복잡도와 정렬', page: 1, chars: 1400 }, { id: 'unit-demo-2', label: '안정성과 알고리즘 비교', page: 2, chars: 1400 }] }) as T;
  if (!path && method === 'POST') {
    const id = `demo-session-${crypto.randomUUID()}`;
    sessions[id] = newSession(id, Number(request.concept_count) || 2);
    sessions[id].target_minutes = Number(request.target_minutes) || 15;
    return copy(sessions[id]) as T;
  }
  if (!path) return await listLearningSessions() as T;
  if (path === '/history') return copy({ sessions: Object.values(sessions).filter(s => ['completed', 'abandoned'].includes(s.status)).map(s => ({ ...s, updated_at: new Date().toISOString() })) }) as T;
  const [, id, action] = path.split('/');
  const session = sessions[id] ||= newSession(id);
  if (action === 'history') return copy({ items: history[id] || [] }) as T;
  if (method === 'GET') return copy(session) as T;
  const item = session.current;
  if (action === 'draft' && item) item.draft = String(request.text || '');
  if (action === 'answers' && item) {
    if (request.kind === 'recall') { item.draft = String(request.answer || ''); item.feedback = demoFeedback(item.draft, item.position); item.phase = 'recall_feedback'; }
    else {
      const concept = concepts[item.position % concepts.length]; const selected = Number(request.answer);
      item.check_result = { answer_index: concept.answer, selected, correct: selected === concept.answer, explanation: concept.reference };
      item.phase = 'check_feedback';
    }
  }
  if (action === 'help' && item) {
    const concept = concepts[item.position % concepts.length]; const type = String(request.help_type);
    item.help[type] = type === 'source' ? concept.source : type === 'hint1' ? concept.hint1 : type === 'hint2' ? concept.hint2 : concept.reference;
  }
  if (action === 'items' && item) item.reported = true;
  if (action === 'actions') {
    if (request.action === 'pause') session.status = 'paused';
    if (request.action === 'resume') session.status = 'active';
    if (request.action === 'abandon') session.status = 'abandoned';
    if (request.action === 'finish') { if (item?.draft || item?.check_result) finishItem(session); session.status = 'completed'; session.current = null; }
    if (request.action === 'unknown' && item) item.phase = 'repair';
    if (request.action === 'self_check' && item) item.self_check = String(request.self_check);
    if (request.action === 'skip') advance(session, true);
    if (request.action === 'advance' && item) {
      if (item.phase === 'check_feedback') advance(session);
      else { item.check = copy(concepts[item.position % concepts.length].check); item.phase = 'check_answering'; }
    }
  }
  session.revision += 1; if (session.current) session.current.revision += 1; syncActions(session);
  return copy(session) as T;
}
