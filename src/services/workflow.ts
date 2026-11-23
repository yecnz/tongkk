import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';

export class WorkflowError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function workflowRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, { method, signal, headers: await getJsonRequestHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const data = await response.clone().json().catch(() => null);
    throw new WorkflowError(typeof data?.detail?.message === 'string' ? data.detail.message : await parseApiError(response), response.status);
  }
  return response.json();
}
export type LearningIssue = { id: string; concept_id: string; title: string; course_id: string; material_id: string;
  status: 'needs_confirmation' | 'in_progress' | 'awaiting_reassessment' | 'resolved' | 'closed'; revision: number; updated_at: string };
export type IssueDetail = { issue: LearningIssue; concept: { id: string; title: string; material_id: string; course_id: string; source_refs: { unit_id: string; quote: string }[] };
  evidence: { id: string; source_kind: string; outcome: string; assisted: boolean; session_id: string; item_id: string; created_at: string; answer: string | number | null }[];
  events: { id: string; action: string; created_at: string }[] };
export const issueLabels: Record<LearningIssue['status'], string> = { needs_confirmation: '확인 필요', in_progress: '보완 중', awaiting_reassessment: '재평가 대기', resolved: '해결', closed: '수동 종료' };
