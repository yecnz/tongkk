import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type DashboardStateKey = 'ddays' | 'plans' | 'pacePlans' | 'paceLog' | 'resume' | `todayBudget:${string}`;

type DashboardStateRow<T> = {
  value: T;
};

export async function loadDashboardState<T>(key: DashboardStateKey, fallback: T): Promise<T> {
  await requireSupabaseUser();
  const { data, error } = await supabase
    .from('dashboard_state')
    .select('value')
    .eq('key', key)
    .maybeSingle<DashboardStateRow<T>>();

  if (error) throw new Error(formatSupabaseError(error));
  return data?.value ?? fallback;
}

export async function saveDashboardState<T>(key: DashboardStateKey, value: T): Promise<void> {
  const user = await requireSupabaseUser();
  const { error } = await supabase
    .from('dashboard_state')
    .upsert({
      user_id: user.id,
      key,
      value,
    }, {
      onConflict: 'user_id,key',
    });

  if (error) throw new Error(formatSupabaseError(error));
}

export async function removeDashboardState(key: DashboardStateKey): Promise<void> {
  await requireSupabaseUser();
  const { error } = await supabase
    .from('dashboard_state')
    .delete()
    .eq('key', key);

  if (error) throw new Error(formatSupabaseError(error));
}

// 대시보드 "이어서 하기" — 마지막으로 보던 화면. state는 그 페이지로 navigate할 때 넘기는 location.state 그대로.
export type ResumePoint = {
  route: '/summary' | '/quiz';
  course: string;
  title: string;
  activity: string;
  state: Record<string, unknown>;
  at: number;
};

let lastResumeJson = '';
export function saveResumePoint(point: Omit<ResumePoint, 'at'>): void {
  const json = JSON.stringify(point);
  if (json === lastResumeJson) return;
  lastResumeJson = json;
  saveDashboardState<ResumePoint>('resume', { ...point, at: Date.now() }).catch(console.warn);
}
