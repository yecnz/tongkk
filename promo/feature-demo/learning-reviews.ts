import { demoFeedback, type Feedback } from './learning-sessions';
export type ReviewCard = { paused?: boolean; revision?: number; id: string; concept_id: string; title: string; due_at: string; source_changed: boolean; interval_days: number; successful_reviews: number };
export type ReviewAttempt = { id: string; question_id?: string | null; question?: string; answer: string; assisted: boolean; status: string; feedback: Feedback | null; check_result: { selected: number; answer_index: number; correct: boolean; explanation: string } | null; eligible_for_schedule: boolean };
export type ReviewView = { auto_questions?: boolean; next_question?: string; question_id?: string | null; question_status?: string | null; paused?: boolean; id: string; title: string; question: string; due_at: string; source_changed: boolean; latest: ReviewAttempt | null; check: { question: string; options: string[] } | null; baseline: { answer: string | null; feedback: Feedback | null } | null; previous: ReviewAttempt | null };
export class ReviewError extends Error { constructor(message: string, public status: number) { super(message); } }
const copy = <T,>(value: T): T => structuredClone(value);
let cards: ReviewCard[] = [];
const views: Record<string, ReviewView> = {};
export function resetLearningReviews() { cards = ['퀵 정렬의 최악 시간 복잡도', '정렬의 안정성'].map((title, i) => ({ id: `review-demo-${i}`, concept_id: i ? 'stable-demo' : 'quick-demo', title, due_at: new Date(Date.now() - i * 3600000).toISOString(), source_changed: false, interval_days: 3, successful_reviews: 2 - i, revision: 1, paused: false })); Object.keys(views).forEach(id => delete views[id]); }
resetLearningReviews();
export function getDemoReviewCards(dueOnly = false) { return copy(cards.filter(card => !dueOnly || (!card.paused && Date.parse(card.due_at) <= Date.now()))); }
export function changeDemoReview(id: string, action: string) {
  const card = cards.find(c => c.id === id); if (!card) return null;
  if (action === 'pause') card.paused = true;
  if (action === 'resume') card.paused = false;
  if (action === 'postpone') card.due_at = new Date(Date.now() + 86400000).toISOString();
  card.revision = (card.revision || 0) + 1; if (views[id]) { views[id].paused = card.paused; views[id].due_at = card.due_at; } return copy(card);
}
function viewFor(id: string): ReviewView {
  const card = cards.find(c => c.id === id) || cards[0];
  return views[id] ||= { id, title: card.title, question: '퀵 정렬이 한쪽으로 치우치게 분할될 때, 전체 비교 횟수가 늘어나는 이유를 설명해보세요.', due_at: card.due_at, source_changed: false, paused: card.paused, auto_questions: false, latest: null,
    check: { question: '매 단계에서 n−1개를 다시 정렬하는 상황의 시간 복잡도는?', options: ['O(log n)', 'O(n)', 'O(n log n)', 'O(n²)'] },
    baseline: { answer: '퀵 정렬은 데이터를 반으로 나누어서 빠릅니다.', feedback: demoFeedback('퀵 정렬은 데이터를 반으로 나누어서 빠릅니다.') }, previous: null };
}
export async function reviewRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const request = (body || {}) as Record<string, unknown>;
  if (path === '/stats') return { completed_sessions: 8, initial_checks: 16, initial_correct: 12, due_cards: getDemoReviewCards(true).length, changed_cards: 0, retention_checks: 9, retention_correct: 7 } as T;
  if (!path && method === 'POST') return { id: cards[0].id } as T;
  if (!path || path.startsWith('?')) return { cards: getDemoReviewCards(path.includes('due_only=true')) } as T;
  const [, id, action] = path.split('/'); const view = viewFor(id);
  if (action === 'questions') { view.question_id = `question-${crypto.randomUUID()}`; view.question_status = 'ready'; view.next_question = '이미 정렬된 배열에서 첫 원소를 항상 피벗으로 고릅니다. 어떤 분할이 반복되고, 시간 복잡도는 어떻게 될까요?'; }
  if (action === 'answers') { view.previous = view.latest ? copy(view.latest) : null; view.latest = { id: String(request.attempt_id || crypto.randomUUID()), answer: String(request.answer || ''), assisted: request.assisted === true, status: 'graded', feedback: demoFeedback(String(request.answer || '')), check_result: null, eligible_for_schedule: true }; }
  if (action === 'check' && view.latest) { const selected = Number(request.selected); view.latest.check_result = { selected, answer_index: 3, correct: selected === 3, explanation: '비교가 (n−1)+(n−2)+…+1번 필요하므로 O(n²)입니다.' }; view.due_at = new Date(Date.now() + 3 * 86400000).toISOString(); const card = cards.find(c => c.id === id); if (card) { card.due_at = view.due_at; card.successful_reviews += selected === 3 ? 1 : 0; } }
  return copy(view) as T;
}
