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
  file_path text,
  mime_type text,
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

alter table public.materials
add column if not exists file_path text;

alter table public.materials
add column if not exists mime_type text;

create table if not exists public.summary_chat_messages (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.summaries(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists summary_chat_messages_summary_created_idx
on public.summary_chat_messages (summary_id, created_at);

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
  key text not null check (key in ('ddays', 'plans')),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  avatar_url text,
  dark_mode boolean not null default false,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('course-materials', 'course-materials', false)
on conflict (id) do update set public = excluded.public;

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

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.courses enable row level security;
alter table public.materials enable row level security;
alter table public.summaries enable row level security;
alter table public.summary_chat_messages enable row level security;
alter table public.quiz_sets enable row level security;
alter table public.dashboard_state enable row level security;
alter table public.profiles enable row level security;

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

drop policy if exists "users can manage own summary chat messages" on public.summary_chat_messages;
create policy "users can manage own summary chat messages"
on public.summary_chat_messages
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

drop policy if exists "users can view profiles" on public.profiles;
create policy "users can view profiles"
on public.profiles
for select
using (auth.role() = 'authenticated');

drop policy if exists "users can manage own profile" on public.profiles;
create policy "users can manage own profile"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "users can view avatar files" on storage.objects;
create policy "users can view avatar files"
on storage.objects
for select
using (bucket_id = 'avatars');

drop policy if exists "users can view own course material files" on storage.objects;
create policy "users can view own course material files"
on storage.objects
for select
using (
  bucket_id = 'course-materials'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can insert own avatar files" on storage.objects;
create policy "users can insert own avatar files"
on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can insert own course material files" on storage.objects;
create policy "users can insert own course material files"
on storage.objects
for insert
with check (
  bucket_id = 'course-materials'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can update own avatar files" on storage.objects;
create policy "users can update own avatar files"
on storage.objects
for update
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can update own course material files" on storage.objects;
create policy "users can update own course material files"
on storage.objects
for update
using (
  bucket_id = 'course-materials'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'course-materials'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can delete own avatar files" on storage.objects;
create policy "users can delete own avatar files"
on storage.objects
for delete
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can delete own course material files" on storage.objects;
create policy "users can delete own course material files"
on storage.objects
for delete
using (
  bucket_id = 'course-materials'
  and auth.uid()::text = (storage.foldername(name))[1]
);
