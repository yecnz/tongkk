import { demoFeedback } from './learning-sessions';
import { changeDemoReview, getDemoReviewCards } from './learning-reviews';
export class WorkflowError extends Error { constructor(message: string, public status: number) { super(message); } }
export const issueLabels = { needs_confirmation: '확인 필요', in_progress: '보완 중', awaiting_reassessment: '재평가 대기', resolved: '해결', closed: '수동 종료' };
type IssueStatus = keyof typeof issueLabels;
const copy = <T,>(value: T): T => structuredClone(value);
const issues = ['퀵 정렬의 최악 시간 복잡도', '정렬의 안정성'].map((title, i) => ({ id: `issue-demo-${i}`, concept_id: i ? 'stable-demo' : 'quick-demo', title, course_id: 'course-demo', material_id: 'material-demo', status: (i ? 'in_progress' : 'needs_confirmation') as IssueStatus, revision: 1, updated_at: new Date().toISOString() }));
const events: Record<string, { id: string; action: string; created_at: string }[]> = {};
function detail(id: string) {
  const issue = issues.find(item => item.id === id) || issues[0];
  return { issue, source_changed: false, review_card_id: `review-demo-${issue.id.endsWith('1') ? 1 : 0}`,
    concept: { id: issue.concept_id, title: issue.title, material_id: issue.material_id, course_id: issue.course_id,
      source_refs: [{ unit_id: 'unit-demo-1', quote: issue.id.endsWith('1') ? '안정성은 같은 키를 가진 원소의 상대 순서를 보존하는 성질이다.' : '퀵 정렬은 평균 O(n log n)이지만, 한쪽으로 치우친 분할이 반복되면 최악 O(n²)이다.' }] },
    evidence: [{ id: `evidence-${id}`, source_kind: 'recall', outcome: 'uncertain', assisted: false, session_id: 'demo-session-completed', item_id: 'item-demo-0', created_at: new Date(Date.now() - 86400000).toISOString(), answer: issue.id.endsWith('1') ? '안정 정렬은 실행 시간이 항상 일정한 정렬입니다.' : '퀵 정렬은 항상 반으로 나누기 때문에 O(n log n)입니다.' }],
    events: events[id] || [{ id: 'event-demo', action: 'evidence', created_at: new Date(Date.now() - 86400000).toISOString() }] };
}
const revisions: Record<string, { title: string; question: string; baseline: string; baseline_feedback: ReturnType<typeof demoFeedback>; source_changed: boolean;
  revision: { id: string; session_id: string; item_id: string; answer: string; revision: number; status: string };
  evaluation: { id: string; status: string; feedback: ReturnType<typeof demoFeedback>; error_code: null } | null }> = {};

// The shared demo transport delegates only these endpoints here.
export async function handleLearningRequest(path: string, method = 'GET', body?: unknown) {
  void method;
  const request = (body || {}) as Record<string, unknown>;
  if (path.startsWith('/learning-issues')) {
    const [, , id, action] = path.split('?')[0].split('/');
    if (!id) return copy({ issues, total: issues.length });
    if (action === 'actions') {
      const issue = issues.find(item => item.id === id);
      if (issue) { const map: Record<string, IssueStatus> = { start: 'in_progress', reassess: 'awaiting_reassessment', close: 'closed', reopen: 'needs_confirmation' };
        issue.status = map[String(request.action)] || issue.status; issue.revision += 1; issue.updated_at = new Date().toISOString();
        (events[id] ||= []).push({ id: crypto.randomUUID(), action: String(request.action), created_at: issue.updated_at }); }
    }
    return copy(detail(id));
  }
  if (path.startsWith('/learning-workflow/reviews/')) {
    const [, , , id, action] = path.split('/');
    if (action === 'actions') return changeDemoReview(id, String(request.action));
    const day = /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : null;
    return { cards: getDemoReviewCards().filter(card => !day || card.due_at.slice(0, 10) === day) };
  }
  if (path.startsWith('/explanation-revisions')) {
    const [, , routeId, action] = path.split('/');
    const id = routeId || String(request.id || crypto.randomUUID());
    if (!revisions[id]) {
      const baseline = '퀵 정렬은 항상 반으로 나누어서 O(n log n)입니다.';
      revisions[id] = { title: '퀵 정렬의 평균과 최악 시간 복잡도', question: '피벗과 분할 크기를 연결해 퀵 정렬의 평균과 최악 시간 복잡도를 설명해보세요.', baseline, baseline_feedback: demoFeedback(baseline), source_changed: false,
        revision: { id, session_id: String(request.session_id || 'demo-session-completed'), item_id: String(request.item_id || 'item-demo-0'), answer: baseline, revision: 1, status: 'draft' }, evaluation: null };
    }
    const view = revisions[id];
    if (action === 'draft') { view.revision.answer = String(request.answer || ''); view.revision.revision += 1; }
    if (action === 'submit') { view.revision.status = 'graded'; view.revision.revision += 1; view.evaluation = { id: String(request.command_key || crypto.randomUUID()), status: 'graded', feedback: demoFeedback(view.revision.answer), error_code: null }; }
    return copy(view);
  }
  return undefined;
}

export async function workflowRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await handleLearningRequest(path, method, body);
  if (result === undefined) throw new WorkflowError('이 기능은 준비된 체험 범위에서 확인할 수 있어요.', 400);
  return result as T;
}
