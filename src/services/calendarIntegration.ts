import { workflowRequest } from './workflow';
export const CALENDAR_CALLBACK_PATH = '/integrations/google-calendar/callback';
export type CalendarConnection = { id: string; status: 'connected' | 'reconnect' | 'disconnected'; revision: number; last_synced_at: string | null; last_error: string | null; sync_enabled?: boolean; sync_interval_minutes?: number; next_sync_at?: string | null };
export type CalendarIntegration = { configured: boolean; worker_enabled: boolean; connection: CalendarConnection | null; job?: { status: string; error_code: string | null } | null };
const callbacks = new Map<string, Promise<unknown>>();
export function completeCalendarConnection(userId: string, state: string, code: string) {
  const key = `${userId}:${state}`;
  let request = callbacks.get(key);
  if (!request) {
    request = workflowRequest('/integrations/google-calendar/callback', 'POST', { state, code });
    callbacks.set(key, request);
    if (callbacks.size > 20) callbacks.delete(callbacks.keys().next().value!);
  }
  return request;
}
