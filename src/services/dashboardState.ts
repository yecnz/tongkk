import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type DashboardStateKey = 'ddays' | 'plans' | 'pacePlans' | `todayBudget:${string}`;

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
