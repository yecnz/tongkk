create extension if not exists pgcrypto;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.materials (
  course_id uuid not null references public.courses(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  size bigint,
  type text not null check (type in ('pdf', 'ppt', 'img', 'file')),
  pages integer,
  slides integer,
  markdown text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (course_id, id)
);

create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template text not null check (template in ('GENERAL', 'LECTURE_NOTE', 'MINDMAP', 'CHEAT_SHEET')),
  content text not null,
  material_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, template, material_ids)
);

create table if not exists public.quiz_sets (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  difficulty text not null check (difficulty in ('쉬움', '보통', '어려움')),
  question_type text not null check (question_type in ('객관식', 'OX', '단답형')),
  count integer not null check (count between 1 and 30),
  material_ids text[] not null default '{}',
  questions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dashboard_state (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('community', 'ddays', 'plans')),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_courses_updated_at on public.courses;
create trigger set_courses_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

drop trigger if exists set_materials_updated_at on public.materials;
create trigger set_materials_updated_at
before update on public.materials
for each row execute function public.set_updated_at();

drop trigger if exists set_summaries_updated_at on public.summaries;
create trigger set_summaries_updated_at
before update on public.summaries
for each row execute function public.set_updated_at();

drop trigger if exists set_quiz_sets_updated_at on public.quiz_sets;
create trigger set_quiz_sets_updated_at
before update on public.quiz_sets
for each row execute function public.set_updated_at();

drop trigger if exists set_dashboard_state_updated_at on public.dashboard_state;
create trigger set_dashboard_state_updated_at
before update on public.dashboard_state
for each row execute function public.set_updated_at();

alter table public.courses enable row level security;
alter table public.materials enable row level security;
alter table public.summaries enable row level security;
alter table public.quiz_sets enable row level security;
alter table public.dashboard_state enable row level security;

drop policy if exists "users can manage own courses" on public.courses;
create policy "users can manage own courses"
on public.courses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can manage own materials" on public.materials;
create policy "users can manage own materials"
on public.materials
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can manage own summaries" on public.summaries;
create policy "users can manage own summaries"
on public.summaries
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can manage own quiz sets" on public.quiz_sets;
create policy "users can manage own quiz sets"
on public.quiz_sets
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can manage own dashboard state" on public.dashboard_state;
create policy "users can manage own dashboard state"
on public.dashboard_state
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
