begin;

alter table public.dashboard_state
  drop constraint if exists dashboard_state_key_check;

alter table public.dashboard_state
  add constraint dashboard_state_key_check
  check (key in ('ddays', 'plans', 'pacePlans', 'paceLog', 'community', 'resume', 'menubarReminders')
    or key like 'todayBudget:%');

commit;
