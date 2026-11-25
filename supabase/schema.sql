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
  page_range text not null default '',
  focus_prompt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint summaries_dedup_key unique (course_id, template, material_ids, page_range, focus_prompt)
);

-- 페이지 범위·추가 지시가 다르면 다른 요약으로 본다(#92). 기존 DB 마이그레이션.
alter table public.summaries
add column if not exists page_range text not null default '';

alter table public.summaries
add column if not exists focus_prompt text not null default '';

alter table public.summaries
drop constraint if exists summaries_course_id_template_material_ids_key;

alter table public.summaries
drop constraint if exists summaries_dedup_key;

alter table public.summaries
add constraint summaries_dedup_key unique (course_id, template, material_ids, page_range, focus_prompt);

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

create table if not exists public.summary_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid references public.summaries(id) on delete cascade,
  material_id text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (summary_id is not null or material_id is not null)
);

alter table public.summary_chat_messages
add column if not exists session_id uuid references public.summary_chat_sessions(id) on delete cascade;

alter table public.summary_chat_messages
alter column summary_id drop not null;

create index if not exists summary_chat_messages_summary_created_idx
on public.summary_chat_messages (summary_id, created_at);

create index if not exists summary_chat_sessions_summary_updated_idx
on public.summary_chat_sessions (summary_id, updated_at desc);

create index if not exists summary_chat_sessions_material_updated_idx
on public.summary_chat_sessions (material_id, updated_at desc);

create index if not exists summary_chat_messages_session_created_idx
on public.summary_chat_messages (session_id, created_at);

create table if not exists public.quiz_sets (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  difficulty text not null check (difficulty in ('쉬움', '보통', '어려움')),
  question_type text not null check (question_type in ('객관식', 'OX', '단답형', '주관식')),
  count integer not null check (count between 1 and 30),
  material_ids text[] not null default '{}',
  questions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quiz_sets
drop constraint if exists quiz_sets_question_type_check;

alter table public.quiz_sets
add constraint quiz_sets_question_type_check
check (question_type in ('객관식', 'OX', '단답형', '주관식'));

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quiz_set_id uuid references public.quiz_sets(id) on delete set null,
  difficulty text not null check (difficulty in ('쉬움', '보통', '어려움')),
  question_type text not null check (question_type in ('객관식', 'OX', '단답형', '주관식')),
  count integer not null check (count between 1 and 30),
  correct_count integer not null default 0,
  score_percent integer not null default 0,
  weak_topics text[] not null default '{}',
  answers jsonb not null,
  duration_seconds integer,
  timed_out boolean not null default false,
  material_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 과목별 오답 분석(취약점/공부 포인트/암기 항목). 과목당 최신 1건만 유지(course_id unique upsert).
create table if not exists public.wrong_answer_analyses (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  analysis jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id)
);

create table if not exists public.dashboard_state (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('ddays', 'plans', 'pacePlans', 'paceLog', 'community', 'resume', 'menubarReminders') or key like 'todayBudget:%'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.dashboard_state
drop constraint if exists dashboard_state_key_check;

alter table public.dashboard_state
add constraint dashboard_state_key_check
check (key in ('ddays', 'plans', 'pacePlans', 'paceLog', 'community', 'resume', 'menubarReminders') or key like 'todayBudget:%');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  avatar_url text,
  school text,
  department text,
  dark_mode boolean not null default false,
  notifications_enabled boolean not null default true,
  hide_summary_notice boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기존 DB(profiles 테이블이 이미 있는 경우)에도 컬럼이 적용되도록 마이그레이션 추가.
-- create table if not exists는 기존 테이블에 새 컬럼을 넣지 않으므로 alter로 보강한다.
alter table public.profiles
add column if not exists hide_summary_notice boolean not null default false;
alter table public.profiles
add column if not exists school text;
alter table public.profiles
add column if not exists department text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-materials',
  'course-materials',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/markdown',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

drop trigger if exists set_summary_chat_sessions_updated_at on public.summary_chat_sessions;
create trigger set_summary_chat_sessions_updated_at
before update on public.summary_chat_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_quiz_sets_updated_at on public.quiz_sets;
create trigger set_quiz_sets_updated_at
before update on public.quiz_sets
for each row execute function public.set_updated_at();

create index if not exists quiz_attempts_course_created_idx
on public.quiz_attempts (course_id, created_at desc);

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
alter table public.summary_chat_sessions enable row level security;
alter table public.summary_chat_messages enable row level security;
alter table public.quiz_sets enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.wrong_answer_analyses enable row level security;
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

drop policy if exists "users can manage own summary chat sessions" on public.summary_chat_sessions;
create policy "users can manage own summary chat sessions"
on public.summary_chat_sessions
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

drop policy if exists "users can manage own quiz attempts" on public.quiz_attempts;
create policy "users can manage own quiz attempts"
on public.quiz_attempts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can manage own wrong answer analyses" on public.wrong_answer_analyses;
create policy "users can manage own wrong answer analyses"
on public.wrong_answer_analyses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can manage own dashboard state" on public.dashboard_state;
create policy "users can manage own dashboard state"
on public.dashboard_state
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 프로필은 본인 것만 조회 가능. (앱은 타인 프로필을 조회하지 않으므로 전체 공개가 불필요)
-- 향후 닉네임/아바타를 다른 사용자에게 노출하는 기능(커뮤니티·랭킹 등)이 생기면 별도 공유 정책을 추가한다.
drop policy if exists "users can view profiles" on public.profiles;
create policy "users can view profiles"
on public.profiles
for select
using (auth.uid() = id);

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

-- Learning sessions (keep synchronized with migrations/202611220001_learning_sessions.sql)
-- Apply once with a database owner, after the existing schema.sql.
-- New session data is accessible only through the authenticated FastAPI server.
begin;

create unique index if not exists courses_id_owner_key on public.courses(id, user_id);
create unique index if not exists materials_id_owner_key on public.materials(course_id, id, user_id);

create table public.learning_session_packs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null,
  material_id text not null,
  material_name text not null,
  preparation_key text not null,
  source_hash text not null,
  selected_scope jsonb not null,
  source_snapshot text not null check (length(source_snapshot) between 1 and 12000),
  source_units jsonb not null,
  concept_count integer not null check (concept_count between 1 and 3),
  content_version text not null,
  content jsonb,
  status text not null check (status in ('preparing','ready','failed')),
  check(status<>'ready' or content is not null),
  unique(user_id, preparation_key),
  unique(id, user_id, course_id),
  foreign key(course_id, user_id) references public.courses(id, user_id) on delete cascade,
  foreign key(course_id, material_id, user_id) references public.materials(course_id, id, user_id) on delete cascade
);
create table public.learning_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null,
  pack_id uuid not null,
  status text not null check(status in ('preparing','active','paused','completed','abandoned','failed')),
  familiarity text not null check(familiarity in ('new','attended')),
  target_minutes integer not null check(target_minutes between 5 and 60),
  current_item_id uuid,
  revision integer not null check(revision >= 0),
  version integer not null check(version >= 0),
  calls integer not null check(calls >= 0),
  repeated boolean not null default false,
  result jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(id, user_id),
  foreign key(pack_id, user_id, course_id) references public.learning_session_packs(id, user_id, course_id) on delete cascade
);
create unique index learning_sessions_one_open_pack on public.learning_sessions(user_id, pack_id)
  where status in ('preparing','active','paused');
create index learning_sessions_resume on public.learning_sessions(user_id, status, updated_at desc, id);

create table public.learning_session_items (
  id uuid primary key,
  session_id uuid not null,
  user_id uuid not null,
  position integer not null check(position between 0 and 2),
  phase text not null check(phase in ('recall_answering','recall_evaluating','recall_feedback','repair',
                                    'check_answering','check_feedback','done')),
  revision integer not null check(revision >= 0),
  data jsonb not null,
  unique(session_id, position),
  unique(session_id, id),
  unique(id, session_id, user_id),
  foreign key(session_id, user_id) references public.learning_sessions(id, user_id) on delete cascade
);
alter table public.learning_sessions add constraint learning_session_current_item_fk
  foreign key(id, current_item_id) references public.learning_session_items(session_id, id)
  deferrable initially deferred;

create table public.learning_session_attempts (
  id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  item_id uuid not null,
  kind text not null check(kind in ('recall','check')),
  answer jsonb not null,
  status text not null check(status in ('pending','graded','ungraded')),
  result jsonb,
  method text not null check(method in ('ai','exact')),
  assistance jsonb not null,
  created_at timestamptz not null default now(),
  unique(item_id, kind),
  foreign key(item_id, session_id, user_id) references public.learning_session_items(id, session_id, user_id) on delete cascade
);
create index learning_session_attempts_session on public.learning_session_attempts(session_id);

create table public.learning_session_operations (
  id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  command_key uuid not null,
  input_hash text not null,
  kind text not null check(kind in ('prepare','evaluate','create','answers','help','actions','report')),
  status text not null check(status in ('running','succeeded','failed','expired')),
  data jsonb not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_no integer not null check(attempt_no >= 1),
  error_code text,
  metrics jsonb not null default '{}',
  check(status<>'running' or (lease_token is not null and lease_expires_at is not null)),
  created_at timestamptz not null default now(),
  unique(user_id, command_key),
  foreign key(session_id, user_id) references public.learning_sessions(id, user_id) on delete cascade
);
create index learning_session_operations_session on public.learning_session_operations(session_id, created_at);
create index learning_session_operations_lease on public.learning_session_operations(user_id, status, lease_expires_at);

alter table public.learning_session_packs enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.learning_session_items enable row level security;
alter table public.learning_session_attempts enable row level security;
alter table public.learning_session_operations enable row level security;
revoke all on public.learning_session_packs, public.learning_sessions, public.learning_session_items,
  public.learning_session_attempts, public.learning_session_operations from public, anon, authenticated;
grant select, insert, update, delete on public.learning_session_packs, public.learning_sessions, public.learning_session_items,
  public.learning_session_attempts, public.learning_session_operations to service_role;

create function public.learning_session_read(p_user uuid, p_session uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_catalog as $$
 select jsonb_build_object(
   'session', to_jsonb(s), 'pack', to_jsonb(p),
   'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.learning_session_items i
                     where i.session_id=s.id and i.user_id=p_user), '[]'::jsonb),
   'attempts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id) from public.learning_session_attempts a
                        where a.session_id=s.id and a.user_id=p_user), '[]'::jsonb),
   'operations', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('lease_expired',
                            o.status='running' and o.lease_expires_at<=clock_timestamp()) order by o.created_at, o.id) from public.learning_session_operations o
                          where o.session_id=s.id and o.user_id=p_user), '[]'::jsonb),
   'source_changed', p.source_hash <> encode(sha256(convert_to(m.markdown, 'UTF8')), 'hex'))
 from public.learning_sessions s
 join public.learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 join public.materials m on m.course_id=p.course_id and m.id=p.material_id and m.user_id=p_user
 where s.id=p_session and s.user_id=p_user;
$$;

create function public.learning_session_find_command(p_user uuid, p_key uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_catalog as $$
 select to_jsonb(o) from public.learning_session_operations o where o.user_id=p_user and o.command_key=p_key;
$$;

create function public.learning_session_cached_pack(p_user uuid, p_key text) returns jsonb
language sql stable security invoker set search_path = public, pg_catalog as $$
 select to_jsonb(p) from public.learning_session_packs p
 where p.user_id=p_user and p.preparation_key=p_key and p.status in ('ready','failed');
$$;

create function public.learning_session_list(p_user uuid, p_limit integer) returns jsonb
language sql stable security invoker set search_path = public, pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc, r.id), '[]'::jsonb) from (
   select s.id, p.material_name, s.status, s.updated_at from public.learning_sessions s
   join public.learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
   where s.user_id=p_user and s.status in ('preparing','active','paused','failed')
   order by s.updated_at desc, s.id limit greatest(1, least(p_limit, 30))
 ) r;
$$;

create function public.learning_session_open(p_user uuid, p_key text) returns jsonb
language sql stable security invoker set search_path = public, pg_catalog as $$
 select public.learning_session_read(p_user,s.id)
 from public.learning_sessions s join public.learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 where s.user_id=p_user and p.preparation_key=p_key and s.status in ('preparing','active','paused','failed')
 order by case when s.status='failed' then 1 else 0 end, s.updated_at desc limit 1;
$$;

-- One atomic compare-and-swap for a small (maximum 3 concept) session bundle.
-- Private version serializes storage writes; public revision changes only for commands/results.
create function public.learning_session_write(p_user uuid, p_bundle jsonb, p_expected_version integer) returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog as $$
declare
 s public.learning_sessions;
 p public.learning_session_packs;
 old_session public.learning_sessions;
 old_pack public.learning_session_packs;
 item jsonb;
 a jsonb;
 o jsonb;
 existing_answer jsonb;
 previous_op public.learning_session_operations;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
 s := jsonb_populate_record(null::public.learning_sessions, p_bundle->'session');
 p := jsonb_populate_record(null::public.learning_session_packs, p_bundle->'pack');
 if s.user_id is distinct from p_user or p.user_id is distinct from p_user
    or s.pack_id is distinct from p.id or s.course_id is distinct from p.course_id then
   raise exception 'LS_NOT_FOUND';
 end if;
 select * into old_session from public.learning_sessions where id=s.id and user_id=p_user for update;
 if p_expected_version=-1 then
   if old_session.id is not null then raise exception 'LS_CONFLICT'; end if;
   -- Lock the existing material and recheck owner/source in the same transaction as creation.
   perform 1 from public.materials m join public.courses c on c.id=m.course_id and c.user_id=p_user
     where m.course_id=p.course_id and m.id=p.material_id and m.user_id=p_user
     for share of m, c;
   if not found then raise exception 'LS_NOT_FOUND'; end if;
   if not exists(select 1 from public.materials m where m.course_id=p.course_id and m.id=p.material_id
       and p.source_hash=encode(sha256(convert_to(m.markdown, 'UTF8')), 'hex')) then
     raise exception 'LS_SOURCE_CHANGED';
   end if;
 else
   if old_session.id is null then raise exception 'LS_NOT_FOUND'; end if;
   if old_session.version <> p_expected_version or old_session.pack_id <> p.id then
     raise exception 'LS_CONFLICT';
   end if;
   if old_session.status in ('completed','abandoned') then raise exception 'LS_CONFLICT'; end if;
 end if;
 if s.calls > p.concept_count+2 then raise exception 'LS_CONFLICT'; end if;

 -- Prevent new concurrent model work across all server processes, including different sessions.
 for o in select value from jsonb_array_elements(p_bundle->'operations') loop
   select * into previous_op from public.learning_session_operations where id=(o->>'id')::uuid;
   if previous_op.id is not null and previous_op.status='running' and o->>'status' in ('succeeded','failed')
      and previous_op.lease_expires_at<=clock_timestamp() then
     raise exception 'LS_CONFLICT';
   end if;
   if o->>'status'='running' and not exists(
       select 1 from public.learning_session_operations x where x.id=(o->>'id')::uuid and x.status='running') then
     if exists(select 1 from public.learning_session_operations x
       join public.learning_sessions xs on xs.id=x.session_id
       where x.user_id=p_user and x.status='running' and x.lease_expires_at>clock_timestamp()
         and xs.status not in ('completed','abandoned') and x.id<>(o->>'id')::uuid) then
       raise exception 'LS_BUSY';
     end if;
   end if;
 end loop;

 select * into old_pack from public.learning_session_packs where id=p.id and user_id=p_user;
 if old_pack.id is null then
   insert into public.learning_session_packs select p.*;
 elsif old_pack.status<>'ready' then
   update public.learning_session_packs set content=p.content, status=p.status where id=p.id and user_id=p_user;
 elsif old_pack.content is distinct from p.content then
   raise exception 'LS_CONFLICT';
 end if;
 if p_expected_version=-1 then
   s.updated_at := clock_timestamp();
   s.version := 0;
   insert into public.learning_sessions select s.*;
 else
   update public.learning_sessions set status=s.status, current_item_id=s.current_item_id,
     revision=s.revision, version=old_session.version+1, calls=s.calls, result=s.result,
     completed_at=s.completed_at, updated_at=clock_timestamp() where id=s.id and user_id=p_user;
 end if;
 for item in select value from jsonb_array_elements(p_bundle->'items') loop
   insert into public.learning_session_items(id,session_id,user_id,position,phase,revision,data)
   values((item->>'id')::uuid,s.id,p_user,(item->>'position')::int,item->>'phase',(item->>'revision')::int,item->'data')
   on conflict(id) do update set phase=excluded.phase, revision=excluded.revision, data=excluded.data
   where learning_session_items.session_id=s.id and learning_session_items.user_id=p_user;
   if not found then raise exception 'LS_NOT_FOUND'; end if;
 end loop;
 for a in select value from jsonb_array_elements(p_bundle->'attempts') loop
   select answer into existing_answer from public.learning_session_attempts where id=(a->>'id')::uuid;
   if found and existing_answer is distinct from a->'answer' then raise exception 'LS_CONFLICT'; end if;
   insert into public.learning_session_attempts(id,user_id,session_id,item_id,kind,answer,status,result,method,assistance,created_at)
   values((a->>'id')::uuid,p_user,s.id,(a->>'item_id')::uuid,a->>'kind',a->'answer',a->>'status',
          a->'result',a->>'method',a->'assistance',(a->>'created_at')::timestamptz)
   on conflict(id) do update set status=excluded.status, result=excluded.result
   where learning_session_attempts.session_id=s.id and learning_session_attempts.user_id=p_user;
   if not found then raise exception 'LS_NOT_FOUND'; end if;
 end loop;
 for o in select value from jsonb_array_elements(p_bundle->'operations') loop
   insert into public.learning_session_operations(id,user_id,session_id,command_key,input_hash,kind,status,data,
                                                lease_token,lease_expires_at,attempt_no,error_code,metrics,created_at)
   values((o->>'id')::uuid,p_user,s.id,(o->>'command_key')::uuid,o->>'input_hash',o->>'kind',o->>'status',o->'data',
          (o->>'lease_token')::uuid,
          case when o->>'status'='running' then clock_timestamp() +
            case when o->>'kind'='prepare' then interval '90 seconds' else interval '60 seconds' end
          else (o->>'lease_expires_at')::timestamptz end,(o->>'attempt_no')::int,
          o->>'error_code',o->'metrics',(o->>'created_at')::timestamptz)
   on conflict(id) do update set status=excluded.status, error_code=excluded.error_code, metrics=excluded.metrics
   where learning_session_operations.session_id=s.id and learning_session_operations.user_id=p_user
     and learning_session_operations.input_hash=excluded.input_hash
     and learning_session_operations.lease_token is not distinct from excluded.lease_token;
   if not found then raise exception 'LS_CONFLICT'; end if;
 end loop;
 return public.learning_session_read(p_user,s.id);
end;
$$;

revoke all on function public.learning_session_read(uuid,uuid), public.learning_session_find_command(uuid,uuid),
 public.learning_session_cached_pack(uuid,text), public.learning_session_list(uuid,integer),
 public.learning_session_open(uuid,text), public.learning_session_write(uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.learning_session_read(uuid,uuid), public.learning_session_find_command(uuid,uuid),
 public.learning_session_cached_pack(uuid,text), public.learning_session_list(uuid,integer),
 public.learning_session_open(uuid,text), public.learning_session_write(uuid,jsonb,integer) to service_role;
commit;

begin;
alter table public.summaries add column if not exists source_hash text;
alter table public.summaries add column if not exists request_key text;
alter table public.summaries add column if not exists generation_config jsonb;
alter table public.summaries add column if not exists generation_id uuid;
alter table public.summaries drop constraint if exists summaries_dedup_key;
alter table public.summaries drop constraint if exists summaries_course_id_template_material_ids_key;
create index if not exists summaries_request_lookup on public.summaries(user_id,course_id,request_key,created_at desc);
create unique index if not exists summaries_generation_key on public.summaries(user_id,generation_id);
-- Legacy rows intentionally keep null identities: the original input cannot be reconstructed safely.
commit;

begin;
create function public.learning_session_history(p_user uuid,p_limit integer) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc,r.id),'[]'::jsonb) from (
 select s.id,p.material_name,s.status,s.updated_at from learning_sessions s
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 where s.user_id=p_user and s.status in ('completed','abandoned')
 order by s.updated_at desc,s.id limit greatest(1,least(p_limit,30))) r;
$$;
revoke all on function public.learning_session_history(uuid,integer) from public,anon,authenticated;
grant execute on function public.learning_session_history(uuid,integer) to service_role;
commit;

begin;
create table public.learning_concepts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null,material_id text not null,source_hash text not null,concept_key text not null,
 title text not null,source_refs jsonb not null,created_at timestamptz not null default now(),
 unique(user_id,concept_key),unique(id,user_id),
 foreign key(course_id,user_id) references courses(id,user_id) on delete cascade,
 foreign key(course_id,material_id,user_id) references materials(course_id,id,user_id) on delete cascade
);
create table public.learning_item_concepts (
 item_id uuid primary key,session_id uuid not null,user_id uuid not null,concept_id uuid not null,
 foreign key(item_id,session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade,
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade
);
create index learning_item_concepts_concept on public.learning_item_concepts(user_id,concept_id);
alter table public.learning_concepts enable row level security;
alter table public.learning_item_concepts enable row level security;
revoke all on public.learning_concepts,public.learning_item_concepts from public,anon,authenticated;
grant all on public.learning_concepts,public.learning_item_concepts to service_role;

create function public.bind_learning_concept(p_item uuid) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r record;c jsonb;k text;cid uuid;refs jsonb;
begin
 select i.*,p.course_id,p.material_id,p.source_hash,p.content into r from learning_session_items i
 join learning_sessions s on s.id=i.session_id and s.user_id=i.user_id
 join learning_session_packs p on p.id=s.pack_id and p.user_id=i.user_id where i.id=p_item;
 if not found then return; end if;
 c:=r.content->'concepts'->r.position;
 if c is null then return; end if;
 select coalesce(jsonb_agg(x->>'unit_id' order by x->>'unit_id'),'[]'::jsonb) into refs
 from jsonb_array_elements(coalesce(c->'source_refs','[]'::jsonb)) x;
 k:=encode(sha256(convert_to(jsonb_build_array(r.course_id,r.material_id,r.source_hash,
 btrim(regexp_replace(c->>'title','\s+',' ','g')),refs)::text,'UTF8')),'hex');
 insert into learning_concepts(user_id,course_id,material_id,source_hash,concept_key,title,source_refs)
 values(r.user_id,r.course_id,r.material_id,r.source_hash,k,c->>'title',coalesce(c->'source_refs','[]'))
 on conflict(user_id,concept_key) do update set title=excluded.title returning id into cid;
 insert into learning_item_concepts(item_id,session_id,user_id,concept_id) values(r.id,r.session_id,r.user_id,cid)
 on conflict(item_id) do nothing;
end;
$$;
create function public.learning_concept_on_item() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin perform bind_learning_concept(new.id); return new; end;
$$;
create trigger learning_concept_bind after insert on learning_session_items
for each row execute function public.learning_concept_on_item();
select public.bind_learning_concept(id) from public.learning_session_items;

create function public.learning_session_concepts(p_user uuid,p_session uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'source_hash',c.source_hash,
 'item_id',l.item_id,'material_id',c.material_id) order by i.position),'[]'::jsonb)
 from learning_item_concepts l join learning_concepts c on c.id=l.concept_id and c.user_id=p_user
 join learning_session_items i on i.id=l.item_id and i.user_id=p_user
 where l.user_id=p_user and l.session_id=p_session;
$$;
revoke all on function public.bind_learning_concept(uuid),public.learning_concept_on_item(),public.learning_session_concepts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_learning_concept(uuid),public.learning_concept_on_item(),public.learning_session_concepts(uuid,uuid) to service_role;
commit;

begin;
create table public.review_cards (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 concept_id uuid not null,source_session_id uuid not null,source_item_id uuid not null,
 due_at timestamptz not null default now()+interval '1 day',successful_reviews integer not null default 0 check(successful_reviews>=0),
 interval_days integer not null default 1 check(interval_days between 1 and 365),last_reviewed_at timestamptz,
 created_at timestamptz not null default now(),unique(user_id,concept_id),unique(id,user_id),
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(source_item_id,source_session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade
);
create index review_cards_due on review_cards(user_id,due_at,id);
create table public.review_attempts (
 id uuid primary key,user_id uuid not null,card_id uuid not null,answer text not null check(length(answer) between 1 and 4000),
 assisted boolean not null default false,status text not null check(status in ('pending','graded','ungraded')),
 feedback jsonb,metrics jsonb not null default '{}',error_code text,
 lease_expires_at timestamptz not null default now()+interval '90 seconds',created_at timestamptz not null default now(),
 completed_at timestamptz,foreign key(card_id,user_id) references review_cards(id,user_id) on delete cascade
);
create index review_attempts_card on review_attempts(user_id,card_id,created_at desc);
alter table review_cards enable row level security;
alter table review_attempts enable row level security;
revoke all on review_cards,review_attempts from public,anon,authenticated;
grant all on review_cards,review_attempts to service_role;

create function public.review_seed(p_user uuid,p_session uuid,p_item uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare l record;r review_cards;
begin
 select x.*,s.status,i.data into l from learning_item_concepts x join learning_sessions s on s.id=x.session_id and s.user_id=p_user
 join learning_session_items i on i.id=x.item_id and i.user_id=p_user
 where x.user_id=p_user and x.session_id=p_session and x.item_id=p_item;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if l.status<>'completed' or l.data ? 'report' then raise exception 'LS_CONFLICT'; end if;
 insert into review_cards(user_id,concept_id,source_session_id,source_item_id) values(p_user,l.concept_id,p_session,p_item)
 on conflict(user_id,concept_id) do update set concept_id=excluded.concept_id returning * into r;
 return to_jsonb(r);
end;
$$;
create function public.review_list(p_user uuid,p_due_only boolean,p_limit integer) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at,r.id),'[]'::jsonb) from (
 select c.id,c.concept_id,c.due_at,c.successful_reviews,c.interval_days,k.title,k.course_id,k.material_id,
 k.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed
 from review_cards c join learning_concepts k on k.id=c.concept_id and k.user_id=p_user
 join materials m on m.course_id=k.course_id and m.id=k.material_id and m.user_id=p_user
 where c.user_id=p_user and (not p_due_only or c.due_at<=now()) order by c.due_at,c.id limit greatest(1,least(p_limit,100))) r;
$$;
create function public.review_context(p_user uuid,p_card uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('card',to_jsonb(c),'concept',p.content->'concepts'->i.position,
 'pack',to_jsonb(p),'baseline',i.data,'source_changed',p.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex'),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id) from
 (select * from review_attempts a where a.user_id=p_user and a.card_id=p_card order by created_at desc,id limit 10) a),'[]'::jsonb))
 from review_cards c join learning_session_items i on i.id=c.source_item_id and i.user_id=p_user
 join learning_sessions s on s.id=c.source_session_id and s.user_id=p_user
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 join materials m on m.course_id=p.course_id and m.id=p.material_id and m.user_id=p_user
 where c.id=p_card and c.user_id=p_user;
$$;
create function public.review_claim(p_user uuid,p_card uuid,p_id uuid,p_answer text,p_assisted boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c review_cards;a review_attempts;ctx jsonb;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 ctx:=review_context(p_user,p_card);
 if (ctx->>'source_changed')::boolean then raise exception 'LS_SOURCE_CHANGED'; end if;
 select * into a from review_attempts where id=p_id;
 if found then
 if a.user_id<>p_user or a.card_id<>p_card or a.answer<>p_answer or a.assisted<>p_assisted then raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(a); end if;
 update review_attempts set status='ungraded',error_code='EXPIRED',completed_at=now()
 where user_id=p_user and card_id=p_card and status='pending' and lease_expires_at<=now();
 if exists(select 1 from review_attempts where user_id=p_user and card_id=p_card and status='pending') then raise exception 'LS_BUSY'; end if;
 insert into review_attempts(id,user_id,card_id,answer,assisted,status) values(p_id,p_user,p_card,p_answer,p_assisted,'pending') returning * into a;
 return to_jsonb(a);
end;
$$;
create function public.review_finish(p_user uuid,p_card uuid,p_id uuid,p_feedback jsonb,p_metrics jsonb,p_error text,p_interval integer,p_success boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a review_attempts;ctx jsonb;
begin
 perform 1 from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into a from review_attempts where id=p_id and user_id=p_user and card_id=p_card for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if a.status<>'pending' then return to_jsonb(a); end if;
 ctx:=review_context(p_user,p_card);
 if a.lease_expires_at<=now() or (ctx->>'source_changed')::boolean then p_error:='EXPIRED_OR_CHANGED'; end if;
 update review_attempts set status=case when p_error is null then 'graded' else 'ungraded' end,
 feedback=case when p_error is null then p_feedback else null end,metrics=p_metrics,error_code=p_error,completed_at=now()
 where id=p_id returning * into a;
 if p_error is null and p_interval is not null then
 if p_interval<1 or p_interval>365 then raise exception 'LS_CONFLICT'; end if;
 update review_cards set due_at=now()+make_interval(days=>p_interval),interval_days=p_interval,last_reviewed_at=now(),
 successful_reviews=case when p_success then successful_reviews+1 else 0 end where id=p_card;
 end if;
 return to_jsonb(a);
end;
$$;
revoke all on function review_seed(uuid,uuid,uuid),review_list(uuid,boolean,integer),review_context(uuid,uuid),
 review_claim(uuid,uuid,uuid,text,boolean),review_finish(uuid,uuid,uuid,jsonb,jsonb,text,integer,boolean) from public,anon,authenticated;
grant execute on function review_seed(uuid,uuid,uuid),review_list(uuid,boolean,integer),review_context(uuid,uuid),
 review_claim(uuid,uuid,uuid,text,boolean),review_finish(uuid,uuid,uuid,jsonb,jsonb,text,integer,boolean) to service_role;
commit;

begin;
alter table review_attempts add column check_selected integer;
alter table review_attempts add column check_result jsonb;
alter table review_attempts add column eligible_for_schedule boolean not null default false;
create function public.review_start(p_user uuid,p_card uuid,p_id uuid,p_answer text,p_assisted boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare fresh boolean;r jsonb;c review_cards;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 fresh:=not exists(select 1 from review_attempts where id=p_id);
 if fresh and exists(select 1 from review_attempts where user_id=p_user and card_id=p_card and status='graded' and check_selected is null) then raise exception 'LS_BUSY'; end if;
 r:=review_claim(p_user,p_card,p_id,p_answer,p_assisted);
 if fresh then update review_attempts set eligible_for_schedule=(c.due_at<=created_at) where id=p_id returning to_jsonb(review_attempts.*) into r; end if;
 return r||jsonb_build_object('claimed',fresh);
end;
$$;
create function public.review_check(p_user uuid,p_card uuid,p_id uuid,p_selected integer,p_interval integer,p_success boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a review_attempts;ctx jsonb;q jsonb;correct boolean;
begin
 perform 1 from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into a from review_attempts where user_id=p_user and card_id=p_card and id=p_id for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if a.check_selected is not null then
 if a.check_selected<>p_selected then raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(a); end if;
 if a.status<>'graded' then raise exception 'LS_CONFLICT'; end if;
 ctx:=review_context(p_user,p_card);
 if (ctx->>'source_changed')::boolean then raise exception 'LS_SOURCE_CHANGED'; end if;
 q:=ctx->'concept'->'check';
 if p_selected<0 or p_selected>=jsonb_array_length(q->'options') then raise exception 'LS_CONFLICT'; end if;
 correct:=p_selected=(q->>'answer_index')::integer;
 if p_success and (not correct or a.assisted or exists(select 1 from jsonb_array_elements(a.feedback->'criteria') r where r->>'status'<>'met')) then raise exception 'LS_CONFLICT'; end if;
 if p_interval is not null and (p_interval<1 or p_interval>365 or exists(select 1 from jsonb_array_elements(a.feedback->'criteria') r where r->>'status'='uncertain')) then raise exception 'LS_CONFLICT'; end if;
 update review_attempts set check_selected=p_selected,check_result=jsonb_build_object('selected',p_selected,
 'correct',correct,'answer_index',(q->>'answer_index')::integer,'explanation',q->>'explanation') where id=p_id returning * into a;
 if a.eligible_for_schedule and p_interval is not null then
 update review_cards set due_at=now()+make_interval(days=>p_interval),interval_days=p_interval,last_reviewed_at=now(),
 successful_reviews=case when p_success then successful_reviews+1 else 0 end where id=p_card;
 end if;
 return to_jsonb(a);
end;
$$;
revoke all on function review_start(uuid,uuid,uuid,text,boolean),review_check(uuid,uuid,uuid,integer,integer,boolean) from public,anon,authenticated;
grant execute on function review_start(uuid,uuid,uuid,text,boolean),review_check(uuid,uuid,uuid,integer,integer,boolean) to service_role;
commit;
begin;
create function public.review_stats(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 with cards as (
 select c.*,k.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed
 from review_cards c join learning_concepts k on k.id=c.concept_id and k.user_id=p_user
 join materials m on m.course_id=k.course_id and m.id=k.material_id and m.user_id=p_user where c.user_id=p_user
 ), retained as (
 select a.* from review_attempts a join cards c on c.id=a.card_id where a.user_id=p_user
 and not c.source_changed and a.status='graded' and a.eligible_for_schedule and not a.assisted and a.check_result is not null
 and jsonb_array_length(coalesce(a.feedback->'criteria','[]'))>0
 and not exists(select 1 from jsonb_array_elements(a.feedback->'criteria') r where r->>'status'='uncertain')
 )
 select jsonb_build_object(
 'completed_sessions',(select count(*) from learning_sessions where user_id=p_user and status='completed'),
 'initial_checks',(select count(*) from learning_session_attempts where user_id=p_user and kind='check' and status='graded'),
 'initial_correct',(select count(*) from learning_session_attempts where user_id=p_user and kind='check' and status='graded' and (result->>'correct')::boolean),
 'due_cards',(select count(*) from cards where not source_changed and due_at<=now()),
 'changed_cards',(select count(*) from cards where source_changed),
 'retention_checks',(select count(*) from retained),
 'retention_correct',(select count(*) from retained where (check_result->>'correct')::boolean and not exists(
 select 1 from jsonb_array_elements(feedback->'criteria') r where r->>'status'<>'met'))
 );
$$;
revoke all on function review_stats(uuid) from public,anon,authenticated;
grant execute on function review_stats(uuid) to service_role;
commit;
