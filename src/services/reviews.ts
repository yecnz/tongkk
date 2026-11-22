import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';
import type { Feedback } from './learningSessions';

export type ReviewCard = { id: string; concept_id: string; title: string; due_at: string; source_changed: boolean; interval_days: number; successful_reviews: number };
export type ReviewAttempt = { id: string; answer: string; assisted: boolean; status: 'pending' | 'graded' | 'ungraded'; feedback: Feedback | null;
  check_result: { selected: number; answer_index: number; correct: boolean; explanation: string } | null; eligible_for_schedule: boolean };
export type ReviewView = { id: string; title: string; question: string; due_at: string; source_changed: boolean; latest: ReviewAttempt | null;
  check: { question: string; options: string[] } | null; baseline: { answer: string | null; feedback: Feedback | null } | null; previous: ReviewAttempt | null };
export class ReviewError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function reviewRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}/reviews${path}`, { method, headers: await getJsonRequestHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new ReviewError(await parseApiError(response), response.status);
  return response.json();
}
