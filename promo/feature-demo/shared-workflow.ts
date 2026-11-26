import { handleLearningRequest } from './learning-workflow';
import { handlePlanningRequest } from './planning-workflow';
import { handleIntegrationRequest } from './integrations-data';
export class WorkflowError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const issueLabels = { needs_confirmation: '확인 필요', in_progress: '복습 중', awaiting_reassessment: '다시 확인 예정', resolved: '평가로 확인됨', closed: '직접 확인함' };
export async function workflowRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  for (const handler of [handleLearningRequest, handlePlanningRequest, handleIntegrationRequest]) {
    const result = await handler(path, method, body);
    if (result !== undefined) return result as T;
  }
  throw new WorkflowError(`이 요청은 예시에 포함되지 않았어요: ${path}`);
}
