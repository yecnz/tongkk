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
  key text not null check (key in ('ddays', 'plans', 'pacePlans', 'paceLog', 'community', 'resume') or key like 'todayBudget:%'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.dashboard_state
drop constraint if exists dashboard_state_key_check;

alter table public.dashboard_state
add constraint dashboard_state_key_check
check (key in ('ddays', 'plans', 'pacePlans', 'paceLog', 'community', 'resume') or key like 'todayBudget:%');

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

begin;
create table public.learning_evidence (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 concept_id uuid not null, session_id uuid not null, item_id uuid not null,
 source_kind text not null check(source_kind in ('recall','check','review','revision','quiz')),
 source_id uuid not null, quiz_attempt_id uuid references quiz_attempts(id) on delete cascade, question_index integer, answer_snapshot jsonb, outcome text not null check(outcome in ('met','needs_review','uncertain')),
 assisted boolean not null, independent boolean not null default false,
 policy_version text not null default 'evidence-v1', created_at timestamptz not null default now(),
 unique(user_id,source_kind,source_id), unique(id,user_id),
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(item_id,session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade
);
create index learning_evidence_concept on learning_evidence(user_id,concept_id,created_at desc,id);
create table public.learning_issues (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 concept_id uuid not null, status text not null default 'needs_confirmation'
 check(status in ('needs_confirmation','in_progress','awaiting_reassessment','resolved','closed')),
 revision integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,concept_id), unique(id,user_id),
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade
);
create table public.learning_issue_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, issue_id uuid not null,
 action text not null, command_key uuid, request jsonb, evidence_id uuid,
 created_at timestamptz not null default now(), unique(user_id,command_key),
 foreign key(issue_id,user_id) references learning_issues(id,user_id) on delete cascade,
 foreign key(evidence_id,user_id) references learning_evidence(id,user_id) on delete cascade
);
create index learning_issues_updated on learning_issues(user_id,updated_at desc,id);
create function public.learning_record_evidence(p_user uuid,p_concept uuid,p_session uuid,p_item uuid,p_kind text,p_source uuid,p_outcome text,p_assisted boolean,p_independent boolean) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare e uuid; i learning_issues;
begin
 insert into learning_evidence(user_id,concept_id,session_id,item_id,source_kind,source_id,outcome,assisted,independent)
 values(p_user,p_concept,p_session,p_item,p_kind,p_source,p_outcome,p_assisted,p_independent)
 on conflict(user_id,source_kind,source_id) do nothing returning id into e;
 if e is null then return; end if;
 if p_outcome<>'met' then
 insert into learning_issues(user_id,concept_id) values(p_user,p_concept)
 on conflict(user_id,concept_id) do update set updated_at=now(), revision=learning_issues.revision+1,
 status=case when learning_issues.status in ('resolved','closed') then 'needs_confirmation' else learning_issues.status end returning * into i;
 insert into learning_issue_events(user_id,issue_id,action,evidence_id) values(p_user,i.id,'evidence',e);
 else
 select * into i from learning_issues where user_id=p_user and concept_id=p_concept for update;
 if found then
 -- Repeated source questions are practice evidence, not independent transfer evidence.
 update learning_issues set updated_at=now(),revision=revision+1 where id=i.id;
 insert into learning_issue_events(user_id,issue_id,action,evidence_id) values(p_user,i.id,'practice',e);
 end if;
 end if;
end; $$;
create function public.learning_capture_attempt() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c uuid; result_status text; assisted boolean;
begin
 if new.status<>'graded' or new.result is null then return new; end if;
 select concept_id into c from learning_item_concepts where item_id=new.item_id and user_id=new.user_id;
 if c is null then return new; end if;
 if exists(select 1 from learning_session_items where id=new.item_id and data ? 'report') then return new; end if;
 if new.kind='check' then result_status:=case when (new.result->>'correct')::boolean then 'met' else 'needs_review' end;
 else
 if jsonb_array_length(coalesce(new.result->'criteria','[]'))=0 then return new; end if;
 result_status:=case when exists(select 1 from jsonb_array_elements(new.result->'criteria') r where r->>'status'='uncertain') then 'uncertain'
 when exists(select 1 from jsonb_array_elements(new.result->'criteria') r where r->>'status'<>'met') then 'needs_review' else 'met' end;
 end if;
 assisted:=coalesce((new.assistance->>'during')::boolean,false) or coalesce((new.assistance->>'prior_instruction')::boolean,false);
 perform learning_record_evidence(new.user_id,c,new.session_id,new.item_id,new.kind,new.id,result_status,assisted,
 not assisted and not coalesce((new.assistance->>'prior_exposure')::boolean,false));
 return new;
end; $$;
create trigger learning_evidence_capture after insert or update of status,result on learning_session_attempts
for each row execute function learning_capture_attempt();
create function public.learning_issue_list(p_user uuid,p_limit integer,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('total',(select count(*) from learning_issues where user_id=p_user),
 'issues',coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc,r.id) from (
 select i.*,c.title,c.course_id,c.material_id from learning_issues i join learning_concepts c on c.id=i.concept_id and c.user_id=p_user
 where i.user_id=p_user order by i.updated_at desc,i.id limit greatest(1,least(p_limit,100)) offset greatest(0,p_offset)) r),'[]'::jsonb)); $$;
create function public.learning_issue_detail(p_user uuid,p_issue uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('issue',to_jsonb(i),'concept',to_jsonb(c),
 'evidence',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
 select e.*,coalesce(a.answer,e.answer_snapshot->'studentAnswer') as answer,a.result as feedback from learning_evidence e
 left join learning_session_attempts a on a.id=e.source_id and a.user_id=p_user
 where e.user_id=p_user and e.concept_id=i.concept_id order by e.created_at desc,e.id limit 100) r),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
 select id,action,created_at from learning_issue_events where user_id=p_user and issue_id=p_issue order by created_at desc,id limit 100) r),'[]'::jsonb))
 from learning_issues i join learning_concepts c on c.id=i.concept_id and c.user_id=p_user where i.id=p_issue and i.user_id=p_user; $$;
create function public.learning_issue_action(p_user uuid,p_issue uuid,p_revision integer,p_key uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare i learning_issues; ev learning_issue_events; next_status text;
begin
 select * into i from learning_issues where id=p_issue and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into ev from learning_issue_events where user_id=p_user and command_key=p_key;
 if found then
 if ev.issue_id<>p_issue or ev.request<>jsonb_build_object('action',p_action,'revision',p_revision) then raise exception 'LS_CONFLICT'; end if;
 return learning_issue_detail(p_user,p_issue); end if;
 if i.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 next_status:=case p_action when 'start' then 'in_progress' when 'reassess' then 'awaiting_reassessment' when 'close' then 'closed' when 'reopen' then 'needs_confirmation' else null end;
 if next_status is null or (i.status in ('closed','resolved') and p_action<>'reopen') then raise exception 'LS_CONFLICT'; end if;
 update learning_issues set status=next_status,revision=revision+1,updated_at=now() where id=p_issue;
 insert into learning_issue_events(user_id,issue_id,action,command_key,request)
 values(p_user,p_issue,p_action,p_key,jsonb_build_object('action',p_action,'revision',p_revision));
 return learning_issue_detail(p_user,p_issue);
end; $$;
grant select on public.quiz_attempts to service_role;
create function public.learning_quiz_concepts(p_user uuid,p_attempt uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.title,r.id),'[]'::jsonb) from (
 select c.id,c.title from learning_concepts c join quiz_attempts a on a.course_id=c.course_id and a.user_id=p_user
 where a.id=p_attempt and c.user_id=p_user order by c.title,c.id limit 100) r; $$;
create function public.learning_issue_from_quiz(p_user uuid,p_attempt uuid,p_index integer,p_concept uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a quiz_attempts;q jsonb;l learning_item_concepts;k uuid;i uuid;
begin
 select * into a from quiz_attempts where id=p_attempt and user_id=p_user;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if p_index<0 or p_index>=jsonb_array_length(a.answers) then raise exception 'LS_CONFLICT'; end if;
 q:=a.answers->p_index;
 if coalesce((q->>'isCorrect')::boolean,true) then raise exception 'LS_CONFLICT'; end if;
 if not exists(select 1 from learning_concepts where id=p_concept and user_id=p_user and course_id=a.course_id) then raise exception 'LS_NOT_FOUND'; end if;
 select * into l from learning_item_concepts where user_id=p_user and concept_id=p_concept limit 1;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 k:=md5(p_attempt::text||':'||p_index::text)::uuid;
 -- Existing browser-graded quiz records remain uncertain, explicitly user-mapped evidence.
 perform learning_record_evidence(p_user,p_concept,l.session_id,l.item_id,'quiz',k,'uncertain',true,false);
 update learning_evidence set quiz_attempt_id=p_attempt,question_index=p_index,answer_snapshot=q where user_id=p_user and source_kind='quiz' and source_id=k;
 select id into i from learning_issues where user_id=p_user and concept_id=p_concept;
 return learning_issue_detail(p_user,i);
end; $$;
revoke all on function learning_quiz_concepts(uuid,uuid),learning_issue_from_quiz(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function learning_quiz_concepts(uuid,uuid),learning_issue_from_quiz(uuid,uuid,integer,uuid) to service_role;
alter table learning_evidence enable row level security;
alter table learning_issues enable row level security;
alter table learning_issue_events enable row level security;
revoke all on learning_evidence,learning_issues,learning_issue_events from public,anon,authenticated;
grant all on learning_evidence,learning_issues,learning_issue_events to service_role;
revoke all on function learning_record_evidence(uuid,uuid,uuid,uuid,text,uuid,text,boolean,boolean),learning_capture_attempt(),learning_issue_list(uuid,integer,integer),learning_issue_detail(uuid,uuid),learning_issue_action(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function learning_record_evidence(uuid,uuid,uuid,uuid,text,uuid,text,boolean,boolean),learning_capture_attempt(),learning_issue_list(uuid,integer,integer),learning_issue_detail(uuid,uuid),learning_issue_action(uuid,uuid,integer,uuid,text) to service_role;
-- Backfill already graded attempts with the same trigger and deduplication keys.
update learning_session_attempts set status=status where status='graded';
commit;

begin;
create table public.explanation_revisions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,item_id uuid not null,concept_id uuid not null,parent_id uuid,
 answer text not null default '' check(length(answer)<=4000),assisted boolean not null default true,
 revision integer not null default 0,status text not null default 'draft' check(status in ('draft','pending','graded','ungraded')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id),
 foreign key(item_id,session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade,
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(parent_id,user_id) references explanation_revisions(id,user_id) on delete cascade
);
create table public.explanation_evaluations (
 id uuid primary key,user_id uuid not null,revision_id uuid not null,
 attempt_no integer not null, unique(revision_id,attempt_no),
 status text not null default 'pending' check(status in ('pending','graded','ungraded')),
 feedback jsonb,error_code text,metrics jsonb not null default '{}',lease_expires_at timestamptz not null default now()+interval '90 seconds',
 created_at timestamptz not null default now(),foreign key(revision_id,user_id) references explanation_revisions(id,user_id) on delete cascade
);
create function public.explanation_read(p_user uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('revision',to_jsonb(r),'title',p.content->'concepts'->i.position->>'title',
 'question',p.content->'concepts'->i.position->>'question','baseline',a.answer,'baseline_feedback',a.result,
 'source_changed',p.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex'),
 'evaluation',(select to_jsonb(e)||jsonb_build_object('status',case when e.status='pending' and e.lease_expires_at<=now() then 'ungraded' else e.status end) from explanation_evaluations e where e.revision_id=r.id and e.user_id=p_user order by e.attempt_no desc limit 1))
 from explanation_revisions r join learning_session_items i on i.id=r.item_id and i.user_id=p_user
 join learning_sessions s on s.id=r.session_id and s.user_id=p_user
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 join materials m on m.course_id=p.course_id and m.id=p.material_id and m.user_id=p_user
 join learning_session_attempts a on a.item_id=r.item_id and a.user_id=p_user and a.kind='recall'
 where r.id=p_id and r.user_id=p_user; $$;
create function public.explanation_create(p_user uuid,p_id uuid,p_session uuid,p_item uuid,p_parent uuid default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare l learning_item_concepts;r explanation_revisions; initial text;
begin
 select * into r from explanation_revisions where id=p_id;
 if found then
 if r.user_id<>p_user or r.session_id<>p_session or r.item_id<>p_item or r.parent_id is distinct from p_parent then raise exception 'LS_CONFLICT'; end if;
 return explanation_read(p_user,p_id); end if;
 select x.* into l from learning_item_concepts x join learning_sessions s on s.id=x.session_id and s.user_id=p_user
 where x.item_id=p_item and x.session_id=p_session and x.user_id=p_user and s.status='completed';
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select answer#>>'{}' into initial from learning_session_attempts where item_id=p_item and user_id=p_user and kind='recall';
 if initial is null then raise exception 'LS_CONFLICT'; end if;
 if p_parent is not null then
 select answer into initial from explanation_revisions where id=p_parent and user_id=p_user and item_id=p_item and status in ('graded','ungraded');
 if not found then raise exception 'LS_CONFLICT'; end if; end if;
 insert into explanation_revisions(id,user_id,session_id,item_id,concept_id,parent_id,answer) values(p_id,p_user,p_session,p_item,l.concept_id,p_parent,initial);
 return explanation_read(p_user,p_id);
end; $$;
create function public.explanation_save(p_user uuid,p_id uuid,p_expected integer,p_answer text,p_assisted boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 update explanation_revisions set answer=p_answer,assisted=p_assisted,revision=revision+1,updated_at=now()
 where id=p_id and user_id=p_user and revision=p_expected and status='draft';
 if not found then raise exception 'LS_CONFLICT'; end if;
 return explanation_read(p_user,p_id);
end; $$;
create function public.explanation_submit(p_user uuid,p_id uuid,p_expected integer,p_key uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r explanation_revisions;e explanation_evaluations;
begin
 select * into r from explanation_revisions where id=p_id and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into e from explanation_evaluations where id=p_key;
 if found then
 if e.user_id<>p_user or e.revision_id<>p_id then raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(e)||jsonb_build_object('claimed',false); end if;
 if (explanation_read(p_user,p_id)->>'source_changed')::boolean then raise exception 'LS_SOURCE_CHANGED'; end if;
 if r.revision<>p_expected or length(btrim(r.answer))=0 or r.status='graded' then raise exception 'LS_CONFLICT'; end if;
 if exists(select 1 from explanation_evaluations where revision_id=p_id and status='pending' and lease_expires_at>now()) then raise exception 'LS_BUSY'; end if;
 if (select count(*) from explanation_evaluations where user_id=p_user and revision_id=p_id)>=3 then raise exception 'LS_CONFLICT'; end if;
 insert into explanation_evaluations(id,user_id,revision_id,attempt_no) values(p_key,p_user,p_id,(select count(*)+1 from explanation_evaluations where revision_id=p_id)) returning * into e;
 update explanation_revisions set status='pending',updated_at=now() where id=p_id;
 return to_jsonb(e)||jsonb_build_object('claimed',true);
end; $$;
create function public.explanation_finish(p_user uuid,p_id uuid,p_key uuid,p_feedback jsonb,p_metrics jsonb,p_error text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r explanation_revisions;e explanation_evaluations;outcome text;
begin
 select * into r from explanation_revisions where id=p_id and user_id=p_user for update;
 if not found then return; end if;
 select * into e from explanation_evaluations where id=p_key and user_id=p_user and revision_id=p_id for update;
 if not found or e.status<>'pending' then return; end if;
 if exists(select 1 from explanation_evaluations where revision_id=p_id and attempt_no>e.attempt_no) then
 update explanation_evaluations set status='ungraded',error_code='EXPIRED' where id=p_key; return; end if;
 if e.lease_expires_at<=now() or (explanation_read(p_user,p_id)->>'source_changed')::boolean then p_error:='EXPIRED_OR_CHANGED'; end if;
 update explanation_evaluations set status=case when p_error is null then 'graded' else 'ungraded' end,
 feedback=case when p_error is null then p_feedback else null end,metrics=p_metrics,error_code=p_error where id=p_key;
 update explanation_revisions set status=case when p_error is null then 'graded' else 'ungraded' end,updated_at=now() where id=p_id;
 if p_error is null then
 outcome:=case when exists(select 1 from jsonb_array_elements(p_feedback->'criteria') c where c->>'status'='uncertain') then 'uncertain'
 when exists(select 1 from jsonb_array_elements(p_feedback->'criteria') c where c->>'status'<>'met') then 'needs_review' else 'met' end;
 perform learning_record_evidence(p_user,r.concept_id,r.session_id,r.item_id,'revision',r.id,outcome,true,false);
 update learning_issues set status='awaiting_reassessment',revision=revision+1,updated_at=now() where user_id=p_user and concept_id=r.concept_id and status not in ('closed','resolved');
 end if;
end; $$;
alter table explanation_revisions enable row level security;
alter table explanation_evaluations enable row level security;
revoke all on explanation_revisions,explanation_evaluations from public,anon,authenticated;
grant all on explanation_revisions,explanation_evaluations to service_role;
revoke all on function explanation_read(uuid,uuid),explanation_create(uuid,uuid,uuid,uuid,uuid),explanation_save(uuid,uuid,integer,text,boolean),explanation_submit(uuid,uuid,integer,uuid),explanation_finish(uuid,uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function explanation_read(uuid,uuid),explanation_create(uuid,uuid,uuid,uuid,uuid),explanation_save(uuid,uuid,integer,text,boolean),explanation_submit(uuid,uuid,integer,uuid),explanation_finish(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
commit;

begin;
create table public.learning_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 auto_review boolean not null default false,timezone text not null default 'Asia/Seoul'
);
create table public.background_jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('session','review','revision','preparation','calendar_sync')),
 target_id uuid not null,generation integer not null default 1,
 session_id uuid,review_card_id uuid,revision_id uuid,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
 attempts integer not null default 0,max_attempts integer not null default 2,
 run_after timestamptz not null default now(),lease_token uuid,lease_expires_at timestamptz,
 error_code text,created_at timestamptz not null default now(),unique(user_id,kind,target_id,generation),
 foreign key(session_id,user_id) references learning_sessions(id,user_id) on delete cascade,
 foreign key(review_card_id,user_id) references review_cards(id,user_id) on delete cascade,
 foreign key(revision_id,user_id) references explanation_revisions(id,user_id) on delete cascade
);
create index workflow_jobs_ready on background_jobs(status,run_after,created_at);
create function public.workflow_capture_job() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if tg_table_name='learning_session_operations' and new.status='running' then
 insert into background_jobs(user_id,kind,target_id,generation,session_id) values(new.user_id,'session',new.id,new.attempt_no,new.session_id) on conflict do nothing;
 elsif tg_table_name='review_attempts' and new.status='pending' then
 insert into background_jobs(user_id,kind,target_id,review_card_id) values(new.user_id,'review',new.id,new.card_id) on conflict do nothing;
 elsif tg_table_name='explanation_evaluations' and new.status='pending' then
 insert into background_jobs(user_id,kind,target_id,revision_id) values(new.user_id,'revision',new.id,new.revision_id) on conflict do nothing;
 end if;
 return new;
end; $$;
create trigger session_durable_job after insert or update of status,attempt_no on learning_session_operations for each row execute function workflow_capture_job();
create trigger review_durable_job after insert on review_attempts for each row execute function workflow_capture_job();
create trigger revision_durable_job after insert on explanation_evaluations for each row execute function workflow_capture_job();
create function public.workflow_claim() returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;s learning_sessions;o learning_session_operations;
begin
 -- Exhausted leases become visible failures rather than running forever.
 update background_jobs set status='failed',error_code='WORKER_EXPIRED' where status='running' and lease_expires_at<=now() and attempts>=max_attempts;
 select * into j from background_jobs where (status='queued' and run_after<=now()) or (status='running' and lease_expires_at<=now() and attempts<max_attempts)
 order by run_after,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock(hashtextextended(j.user_id::text,0)) then return null; end if;
 if (select count(*) from background_jobs where user_id=j.user_id and status='running' and lease_expires_at>now() and id<>j.id)>=2 then return null; end if;
 if j.kind='session' then
 select * into o from learning_session_operations where id=j.target_id and user_id=j.user_id for update;
 if not found or o.status<>'running' then update background_jobs set status='succeeded' where id=j.id; return null; end if;
 select * into s from learning_sessions where id=j.session_id and user_id=j.user_id for update;
 if s.status in ('completed','abandoned') or (j.attempts>0 and s.calls>=(select concept_count+2 from learning_session_packs where id=s.pack_id)) then
 update background_jobs set status='cancelled' where id=j.id; return null; end if;
 if j.attempts>0 then update learning_sessions set calls=calls+1 where id=s.id; end if;
 update learning_session_operations set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '120 seconds' where id=o.id;
 elsif j.kind='review' then
 if not exists(select 1 from review_attempts where id=j.target_id and user_id=j.user_id and status='pending') then update background_jobs set status='succeeded' where id=j.id; return null; end if;
 update review_attempts set lease_expires_at=now()+interval '120 seconds' where id=j.target_id;
 elsif j.kind='revision' then
 if not exists(select 1 from explanation_evaluations where id=j.target_id and user_id=j.user_id and status='pending') then update background_jobs set status='succeeded' where id=j.id; return null; end if;
 update explanation_evaluations set lease_expires_at=now()+interval '120 seconds' where id=j.target_id;
 end if;
 update background_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '120 seconds' where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;
create function public.workflow_complete(p_job uuid,p_token uuid,p_feedback jsonb,p_metrics jsonb,p_error text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;
begin
 select * into j from background_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.lease_token<>p_token or j.lease_expires_at<=now() then return false; end if;
 if j.kind='review' then
 perform review_finish(j.user_id,j.review_card_id,j.target_id,p_feedback,coalesce(p_metrics,'{}'),p_error,null,false);
 elsif j.kind='revision' then
 perform explanation_finish(j.user_id,j.revision_id,j.target_id,p_feedback,coalesce(p_metrics,'{}'),p_error);
 end if;
 update background_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,error_code=p_error where id=j.id;
 return true;
end; $$;
create function public.learning_preferences_get(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce((select to_jsonb(p) from learning_preferences p where user_id=p_user),jsonb_build_object('auto_review',false,'timezone','Asia/Seoul')); $$;
create function public.learning_preferences_set(p_user uuid,p_auto boolean,p_timezone text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 insert into learning_preferences(user_id,auto_review,timezone) values(p_user,p_auto,p_timezone)
 on conflict(user_id) do update set auto_review=excluded.auto_review,timezone=excluded.timezone;
 return learning_preferences_get(p_user);
end; $$;
create function public.learning_auto_review() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare i record;
begin
 if new.status='completed' and old.status<>'completed' and coalesce((select auto_review from learning_preferences where user_id=new.user_id),false) then
 for i in select x.id from learning_session_items x where x.session_id=new.id and x.user_id=new.user_id and not (x.data ? 'report')
 and exists(select 1 from learning_session_attempts a where a.item_id=x.id and a.kind='recall' and a.status='graded') loop
 perform review_seed(new.user_id,new.id,i.id);
 end loop; end if;
 return new;
end; $$;
create trigger learning_auto_review_complete after update of status on learning_sessions for each row execute function learning_auto_review();
alter table review_cards add column paused boolean not null default false;
alter table review_cards add column revision integer not null default 0;
alter table review_cards add column original_due_at timestamptz;
create table public.review_schedule_events (
 id uuid primary key,user_id uuid not null,card_id uuid not null,request jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(card_id,user_id) references review_cards(id,user_id) on delete cascade
);
create function public.workflow_review_action(p_user uuid,p_card uuid,p_revision integer,p_key uuid,p_action text,p_days integer default 1) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c review_cards;e review_schedule_events;req jsonb;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 req:=jsonb_build_object('revision',p_revision,'action',p_action,'days',p_days);
 select * into e from review_schedule_events where id=p_key;
 if found then
 if e.user_id<>p_user or e.card_id<>p_card or e.request<>req then raise exception 'LS_CONFLICT'; end if;
 return e.result; end if;
 if c.revision<>p_revision or p_action not in ('pause','resume','postpone') or p_days<1 or p_days>30 then raise exception 'LS_CONFLICT'; end if;
 if exists(select 1 from review_attempts where card_id=p_card and user_id=p_user and (status='pending' and lease_expires_at>now() or status='graded' and check_selected is null)) then raise exception 'LS_BUSY'; end if;
 update review_cards set paused=case p_action when 'pause' then true when 'resume' then false else paused end,
 original_due_at=case when p_action='postpone' then coalesce(original_due_at,due_at) else original_due_at end,
 due_at=case when p_action='postpone' then now()+make_interval(days=>p_days) else due_at end,revision=revision+1 where id=p_card returning * into c;
 insert into review_schedule_events(id,user_id,card_id,request,result) values(p_key,p_user,p_card,req,to_jsonb(c));
 return to_jsonb(c);
end; $$;
create function public.workflow_review_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if exists(select 1 from review_cards where id=new.card_id and paused) then raise exception 'LS_CONFLICT'; end if;
 return new;
end; $$;
create trigger paused_review_guard before insert on review_attempts for each row execute function workflow_review_guard();
create function public.workflow_reviews_range(p_user uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at,r.id),'[]'::jsonb) from (
 select r.id,r.concept_id,c.title,c.course_id,c.material_id,r.due_at,r.paused,r.revision,
 c.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed
 from review_cards r join learning_concepts c on c.id=r.concept_id and c.user_id=p_user
 join materials m on m.course_id=c.course_id and m.id=c.material_id and m.user_id=p_user
 where r.user_id=p_user and r.due_at>=p_from and r.due_at<p_to order by r.due_at,r.id limit 500) r; $$;
-- Preserve existing RPC contracts and add pause/revision metadata.
create or replace function public.review_list(p_user uuid,p_due_only boolean,p_limit integer) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at,r.id),'[]'::jsonb) from (
 select c.id,c.concept_id,c.due_at,c.successful_reviews,c.interval_days,c.paused,c.revision,k.title,k.course_id,k.material_id,
 k.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed
 from review_cards c join learning_concepts k on k.id=c.concept_id and k.user_id=p_user
 join materials m on m.course_id=k.course_id and m.id=k.material_id and m.user_id=p_user
 where c.user_id=p_user and (not p_due_only or not c.paused and c.due_at<=now()) order by c.due_at,c.id limit greatest(1,least(p_limit,100))) r; $$;
alter table background_jobs enable row level security;
alter table learning_preferences enable row level security;
alter table review_schedule_events enable row level security;
revoke all on background_jobs,learning_preferences,review_schedule_events from public,anon,authenticated;
grant all on background_jobs,learning_preferences,review_schedule_events to service_role;
revoke all on function workflow_capture_job(),workflow_claim(),workflow_complete(uuid,uuid,jsonb,jsonb,text),learning_preferences_get(uuid),learning_preferences_set(uuid,boolean,text),learning_auto_review(),workflow_review_action(uuid,uuid,integer,uuid,text,integer),workflow_review_guard(),workflow_reviews_range(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function workflow_capture_job(),workflow_claim(),workflow_complete(uuid,uuid,jsonb,jsonb,text),learning_preferences_get(uuid),learning_preferences_set(uuid,boolean,text),learning_auto_review(),workflow_review_action(uuid,uuid,integer,uuid,text,integer),workflow_review_guard(),workflow_reviews_range(uuid,timestamptz,timestamptz) to service_role;
create or replace function public.review_stats(p_user uuid) returns jsonb
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
 'due_cards',(select count(*) from cards where not source_changed and not paused and due_at<=now()),
 'changed_cards',(select count(*) from cards where source_changed),
 'retention_checks',(select count(*) from retained),
 'retention_correct',(select count(*) from retained where (check_result->>'correct')::boolean and not exists(
 select 1 from jsonb_array_elements(feedback->'criteria') r where r->>'status'<>'met'))
 );
$$;

create or replace function public.learning_issue_detail(p_user uuid,p_issue uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('issue',to_jsonb(i),'concept',to_jsonb(c),
 'evidence',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
 select e.*,coalesce(a.answer,e.answer_snapshot->'studentAnswer') as answer,a.result as feedback from learning_evidence e
 left join learning_session_attempts a on a.id=e.source_id and a.user_id=p_user
 where e.user_id=p_user and e.concept_id=i.concept_id order by e.created_at desc,e.id limit 100) r),'[]'::jsonb),
 'review_card_id',(select id from review_cards where user_id=p_user and concept_id=i.concept_id),'events',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
 select id,action,created_at from learning_issue_events where user_id=p_user and issue_id=p_issue order by created_at desc,id limit 100) r),'[]'::jsonb))
 from learning_issues i join learning_concepts c on c.id=i.concept_id and c.user_id=p_user where i.id=p_issue and i.user_id=p_user; $$;
create or replace function public.learning_issue_action(p_user uuid,p_issue uuid,p_revision integer,p_key uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare i learning_issues; ev learning_issue_events; next_status text;l learning_item_concepts;
begin
 select * into i from learning_issues where id=p_issue and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into ev from learning_issue_events where user_id=p_user and command_key=p_key;
 if found then
 if ev.issue_id<>p_issue or ev.request<>jsonb_build_object('action',p_action,'revision',p_revision) then raise exception 'LS_CONFLICT'; end if;
 return learning_issue_detail(p_user,p_issue); end if;
 if i.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 next_status:=case p_action when 'start' then 'in_progress' when 'reassess' then 'awaiting_reassessment' when 'close' then 'closed' when 'reopen' then 'needs_confirmation' else null end;
 if next_status is null or (i.status in ('closed','resolved') and p_action<>'reopen') then raise exception 'LS_CONFLICT'; end if;
 if p_action='reassess' then
 select x.* into l from learning_item_concepts x join learning_sessions t on t.id=x.session_id and t.user_id=p_user where x.user_id=p_user and x.concept_id=i.concept_id and t.status='completed' order by t.updated_at desc limit 1;
 if not found then raise exception 'LS_CONFLICT'; end if;
 perform review_seed(p_user,l.session_id,l.item_id); end if;
 update learning_issues set status=next_status,revision=revision+1,updated_at=now() where id=p_issue;
 insert into learning_issue_events(user_id,issue_id,action,command_key,request)
 values(p_user,p_issue,p_action,p_key,jsonb_build_object('action',p_action,'revision',p_revision));
 return learning_issue_detail(p_user,p_issue);
end; $$;
create function public.learning_capture_review() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c review_cards; outcome text;
begin
 if new.check_selected is null or new.status<>'graded' then return new; end if;
 select * into c from review_cards where id=new.card_id and user_id=new.user_id;
 if not found then return new; end if;
 outcome:=case when exists(select 1 from jsonb_array_elements(new.feedback->'criteria') f where f->>'status'='uncertain') then 'uncertain'
 when not (new.check_result->>'correct')::boolean or exists(select 1 from jsonb_array_elements(new.feedback->'criteria') f where f->>'status'<>'met') then 'needs_review' else 'met' end;
 perform learning_record_evidence(new.user_id,c.concept_id,c.source_session_id,c.source_item_id,'review',new.id,outcome,new.assisted,false);
 return new;
end; $$;
create trigger learning_review_evidence after update of check_selected on review_attempts for each row execute function learning_capture_review();
revoke all on function learning_capture_review() from public,anon,authenticated;
grant execute on function learning_capture_review() to service_role;

commit;

begin;
alter table summary_chat_sessions add column course_id uuid;
alter table summary_chat_sessions add column source_hash text;
alter table summary_chat_sessions add constraint mate_material_owner_fk foreign key(course_id,material_id,user_id) references materials(course_id,id,user_id) on delete cascade;
create index mate_chat_scope on summary_chat_sessions(user_id,course_id,material_id,source_hash,updated_at desc);
create table public.learning_assessment_locks (
 user_id uuid not null references auth.users(id) on delete cascade,token uuid not null,
 expires_at timestamptz not null,sequence integer not null,active boolean not null,updated_at timestamptz not null default now(),primary key(user_id,token)
);
create function public.learning_assessment_lock(p_user uuid,p_token uuid,p_active boolean,p_sequence integer) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 delete from learning_assessment_locks where updated_at<now()-interval '1 day';
 insert into learning_assessment_locks(user_id,token,expires_at,sequence,active)
 values(p_user,p_token,now()+interval '90 seconds',p_sequence,p_active)
 on conflict(user_id,token) do update set expires_at=excluded.expires_at,sequence=excluded.sequence,active=excluded.active,updated_at=now()
 where learning_assessment_locks.sequence<excluded.sequence;
 return true;
end; $$;
create function public.learning_assessment_active(p_user uuid) returns boolean
language sql stable security invoker set search_path=public,pg_catalog as $$
 select exists(select 1 from learning_sessions s join learning_session_items i on i.id=s.current_item_id and i.user_id=p_user
 where s.user_id=p_user and s.status='active' and i.phase in ('recall_answering','recall_evaluating','check_answering'))
 or exists(select 1 from learning_assessment_locks where user_id=p_user and active and expires_at>now()); $$;
alter table learning_assessment_locks enable row level security;
revoke all on learning_assessment_locks from public,anon,authenticated;
grant all on learning_assessment_locks to service_role;
revoke all on function learning_assessment_lock(uuid,uuid,boolean,integer),learning_assessment_active(uuid) from public,anon,authenticated;
grant execute on function learning_assessment_lock(uuid,uuid,boolean,integer),learning_assessment_active(uuid) to service_role;
commit;

begin;
create table public.preparation_requests (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null,material_id text not null,source_hash text not null,request_key text not null,
 source_snapshot text not null check(length(source_snapshot) between 1 and 12000),config jsonb not null,
 created_at timestamptz not null default now(),unique(user_id,request_key),unique(id,user_id),
 foreign key(course_id,material_id,user_id) references materials(course_id,id,user_id) on delete cascade
);
create table public.preparation_artifacts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,request_id uuid not null,
 kind text not null check(kind in ('summary','quiz','pack')),generation integer not null default 1,
 status text not null default 'queued' check(status in ('queued','ready','failed','applied','discarded')),
 result jsonb,metrics jsonb not null default '{}',error_code text,applied_id uuid,
 created_at timestamptz not null default now(),unique(request_id,kind),unique(id,user_id),
 foreign key(request_id,user_id) references preparation_requests(id,user_id) on delete cascade
);
alter table background_jobs add column preparation_id uuid;
alter table background_jobs add constraint preparation_job_owner_fk foreign key(preparation_id,user_id) references preparation_artifacts(id,user_id) on delete cascade;
create function public.preparation_read(p_user uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('request',to_jsonb(r),'source_changed',r.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex'),
 'artifacts',coalesce((select jsonb_agg(to_jsonb(a) order by a.kind) from preparation_artifacts a where a.request_id=r.id and a.user_id=p_user),'[]'::jsonb))
 from preparation_requests r join materials m on m.course_id=r.course_id and m.id=r.material_id and m.user_id=p_user where r.id=p_id and r.user_id=p_user; $$;
create function public.preparation_list(p_user uuid,p_course uuid,p_material text) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(preparation_read(p_user,r.id) order by r.created_at desc),'[]'::jsonb) from (
 select id,created_at from preparation_requests where user_id=p_user and course_id=p_course and material_id=p_material order by created_at desc,id limit 10) r; $$;
create function public.preparation_create(p_user uuid,p_id uuid,p_course uuid,p_material text,p_hash text,p_key text,p_snapshot text,p_config jsonb,p_kinds text[]) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r preparation_requests;a preparation_artifacts;k text;m materials;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 select * into r from preparation_requests where user_id=p_user and request_key=p_key;
 if found then return preparation_read(p_user,r.id); end if;
 if exists(select 1 from preparation_requests where id=p_id) then raise exception 'LS_CONFLICT'; end if;
 select * into m from materials where course_id=p_course and id=p_material and user_id=p_user for share;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if encode(sha256(convert_to(m.markdown,'UTF8')),'hex')<>p_hash then raise exception 'LS_SOURCE_CHANGED'; end if;
 if cardinality(p_kinds)<1 or cardinality(p_kinds)>3 then raise exception 'LS_CONFLICT'; end if;
 if (select count(*) from preparation_artifacts where user_id=p_user and created_at>now()-interval '1 day')+cardinality(p_kinds)>30 then raise exception 'LS_BUSY'; end if;
 insert into preparation_requests values(p_id,p_user,p_course,p_material,p_hash,p_key,p_snapshot,p_config,now()) returning * into r;
 foreach k in array p_kinds loop
 insert into preparation_artifacts(user_id,request_id,kind) values(p_user,p_id,k) returning * into a;
 insert into background_jobs(user_id,kind,target_id,preparation_id) values(p_user,'preparation',a.id,a.id);
 end loop;
 return preparation_read(p_user,r.id);
end; $$;
create function public.preparation_context(p_user uuid,p_artifact uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select preparation_read(p_user,a.request_id)||jsonb_build_object('artifact',to_jsonb(a)) from preparation_artifacts a where a.user_id=p_user and a.id=p_artifact; $$;
create function public.preparation_finish(p_user uuid,p_artifact uuid,p_generation integer,p_result jsonb,p_metrics jsonb,p_error text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare ctx jsonb;a preparation_artifacts;
begin
 select * into a from preparation_artifacts where id=p_artifact and user_id=p_user for update;
 if not found or a.status<>'queued' or a.generation<>p_generation then return; end if;
 ctx:=preparation_read(p_user,a.request_id);
 if (ctx->>'source_changed')::boolean then p_error:='SOURCE_CHANGED'; end if;
 update preparation_artifacts set status=case when p_error is null then 'ready' else 'failed' end,
 result=case when p_error is null then p_result else null end,metrics=coalesce(p_metrics,'{}'),error_code=p_error where id=p_artifact;
end; $$;
create function public.preparation_apply(p_user uuid,p_artifact uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a preparation_artifacts;r preparation_requests;target uuid;identity jsonb;pack jsonb;
begin
 perform 1 from background_jobs where preparation_id=p_artifact and user_id=p_user for update;
 select * into a from preparation_artifacts where id=p_artifact and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if a.status='applied' then return to_jsonb(a); end if;
 if a.status<>'ready' then raise exception 'LS_CONFLICT'; end if;
 select * into r from preparation_requests where id=a.request_id and user_id=p_user;
 perform 1 from materials where course_id=r.course_id and id=r.material_id and user_id=p_user
 and encode(sha256(convert_to(markdown,'UTF8')),'hex')=r.source_hash for share;
 if not found then raise exception 'LS_SOURCE_CHANGED'; end if;
 target:=(a.result->>'reused_id')::uuid;
 if target is not null then
 if a.kind='summary' and not exists(select 1 from summaries where id=target and user_id=p_user) then target:=null;
 elsif a.kind='pack' and not exists(select 1 from learning_session_packs where id=target and user_id=p_user) then target:=null; end if; end if;
 if target is null then
 target:=a.id;
 if a.kind='summary' then
 identity:=r.config->'summary_identity';
 insert into summaries(id,user_id,course_id,template,content,material_ids,page_range,source_hash,request_key,generation_config,generation_id)
 values(target,p_user,r.course_id,'GENERAL',a.result->>'content',array[r.material_id],r.config->>'pages',r.source_hash,
 identity->>'request_key',identity->'generation_config',a.id);
 elsif a.kind='quiz' then
 insert into quiz_sets(id,user_id,course_id,title,difficulty,question_type,count,material_ids,questions)
 values(target,p_user,r.course_id,(r.config->>'material_name')||' 준비 퀴즈','보통','객관식',jsonb_array_length(a.result->'questions'),array[r.material_id],a.result->'questions');
 else
 pack:=r.config->'pack';
 select id into target from learning_session_packs where user_id=p_user and preparation_key=pack->>'preparation_key' and status='ready';
 if target is null then target:=a.id;
 insert into learning_session_packs(id,user_id,course_id,material_id,material_name,preparation_key,source_hash,selected_scope,source_snapshot,source_units,concept_count,content_version,content,status)
 values(target,p_user,r.course_id,r.material_id,r.config->>'material_name',pack->>'preparation_key',r.source_hash,
 pack->'selected_scope',r.source_snapshot,pack->'source_units',2,pack->>'content_version',a.result->'content','ready');
 end if;
 end if;
 end if;
 update preparation_artifacts set status='applied',applied_id=target where id=a.id returning * into a;
 return to_jsonb(a);
end; $$;
create function public.preparation_action(p_user uuid,p_artifact uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a preparation_artifacts;
begin
 perform 1 from background_jobs where preparation_id=p_artifact and user_id=p_user for update;
 select * into a from preparation_artifacts where id=p_artifact and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if p_action='apply' then return preparation_apply(p_user,p_artifact); end if;
 if p_action='discard' and a.status<>'applied' then
 update preparation_artifacts set status='discarded',result=null where id=a.id;
 update background_jobs set status='cancelled' where preparation_id=a.id and status in ('queued','running');
 elsif p_action='retry' and a.status='failed' and a.generation<3 then
 update preparation_artifacts set status='queued',result=null,error_code=null,generation=generation+1 where id=a.id returning * into a;
 insert into background_jobs(user_id,kind,target_id,generation,preparation_id) values(p_user,'preparation',a.id,a.generation,a.id);
 else raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(a);
end; $$;
create function public.preparation_summary_lookup(p_user uuid,p_key text) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('reused_id',id,'content',content) from summaries where user_id=p_user and request_key=p_key order by created_at desc,id limit 1; $$;
alter table preparation_requests enable row level security;
alter table preparation_artifacts enable row level security;
revoke all on preparation_requests,preparation_artifacts from public,anon,authenticated;
grant all on preparation_requests,preparation_artifacts to service_role;
grant select,insert on summaries,quiz_sets to service_role;
revoke all on function preparation_read(uuid,uuid),preparation_list(uuid,uuid,text),preparation_create(uuid,uuid,uuid,text,text,text,text,jsonb,text[]),preparation_context(uuid,uuid),preparation_finish(uuid,uuid,integer,jsonb,jsonb,text),preparation_apply(uuid,uuid),preparation_action(uuid,uuid,text),preparation_summary_lookup(uuid,text) from public,anon,authenticated;
grant execute on function preparation_read(uuid,uuid),preparation_list(uuid,uuid,text),preparation_create(uuid,uuid,uuid,text,text,text,text,jsonb,text[]),preparation_context(uuid,uuid),preparation_finish(uuid,uuid,integer,jsonb,jsonb,text),preparation_apply(uuid,uuid),preparation_action(uuid,uuid,text),preparation_summary_lookup(uuid,text) to service_role;
create or replace function public.workflow_complete(p_job uuid,p_token uuid,p_feedback jsonb,p_metrics jsonb,p_error text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;
begin
 select * into j from background_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.lease_token<>p_token or j.lease_expires_at<=now() then return false; end if;
 if j.kind='preparation' then
 perform preparation_finish(j.user_id,j.preparation_id,j.generation,p_feedback,p_metrics,p_error);
 elsif j.kind='review' then
 perform review_finish(j.user_id,j.review_card_id,j.target_id,p_feedback,coalesce(p_metrics,'{}'),p_error,null,false);
 elsif j.kind='revision' then
 perform explanation_finish(j.user_id,j.revision_id,j.target_id,p_feedback,coalesce(p_metrics,'{}'),p_error);
 end if;
 update background_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,error_code=p_error where id=j.id;
 return true;
end; $$;

create function public.preparation_job_failed() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if new.kind='preparation' and new.status='failed' then
 update preparation_artifacts set status='failed',error_code=coalesce(new.error_code,'WORKER_FAILED')
 where id=new.preparation_id and user_id=new.user_id and generation=new.generation and status='queued'; end if;
 return new;
end; $$;
create trigger preparation_job_failed after update of status on background_jobs for each row execute function preparation_job_failed();
revoke all on function preparation_job_failed() from public,anon,authenticated;
grant execute on function preparation_job_failed() to service_role;

commit;

begin;
create view public.concept_learning_state with (security_invoker=true) as
select c.id,c.user_id,c.course_id,c.material_id,c.title,c.source_hash,
 c.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed,
 coalesce(e.evidence_count,0) as evidence_count,coalesce(e.independent_questions,0) as independent_questions,
 coalesce(e.assisted_count,0) as assisted_count,coalesce(r.delayed_practice,0) as delayed_practice,
 e.last_outcome,e.last_evaluated_at,'concept-state-v1'::text as policy_version,
 case when c.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') then 'source_changed'
 when coalesce(e.evidence_count,0)=0 then 'unassessed'
 when e.last_verified_outcome='needs_review' or e.recent_failures>=2 then 'needs_review'
 when e.last_outcome='uncertain' then 'needs_confirmation'
 when e.independent_questions>=2 and coalesce(r.delayed_practice,0)>=1 and e.recent_failures=0 then 'recent_stable'
 when exists(select 1 from learning_issues i where i.concept_id=c.id and i.user_id=c.user_id and i.status='awaiting_reassessment') then 'awaiting_reassessment'
 else 'needs_confirmation' end as state
from learning_concepts c join materials m on m.course_id=c.course_id and m.id=c.material_id and m.user_id=c.user_id
left join lateral (
 select count(*) as evidence_count,count(*) filter(where v.assisted) as assisted_count,
 count(distinct md5(p.content->'concepts'->i.position->>'question')) filter(where v.independent and not v.assisted and v.source_kind='recall' and v.outcome='met') as independent_questions,
 count(*) filter(where v.outcome='needs_review' and v.created_at>=now()-interval '14 days') as recent_failures,
 (array_agg(v.outcome order by v.created_at desc,v.id desc) filter(where v.source_kind not in ('quiz','revision') and (v.outcome='needs_review' or v.independent and v.outcome='met')))[1] as last_verified_outcome,
 (array_agg(v.outcome order by v.created_at desc,v.id desc))[1] as last_outcome,max(v.created_at) as last_evaluated_at
 from learning_evidence v join learning_session_items i on i.id=v.item_id and i.user_id=c.user_id
 join learning_sessions s on s.id=v.session_id and s.user_id=c.user_id
 join learning_session_packs p on p.id=s.pack_id and p.user_id=c.user_id
 where v.concept_id=c.id and v.user_id=c.user_id and not (i.data ? 'report')
) e on true
left join lateral (
 select count(*) as delayed_practice from review_cards k join review_attempts a on a.card_id=k.id and a.user_id=c.user_id
 join learning_session_items ri on ri.id=k.source_item_id and ri.user_id=c.user_id
 where k.concept_id=c.id and k.user_id=c.user_id and not (ri.data ? 'report') and a.status='graded' and a.eligible_for_schedule and not a.assisted
 and coalesce((a.check_result->>'correct')::boolean,false) and jsonb_array_length(coalesce(a.feedback->'criteria','[]'))>0
 and not exists(select 1 from jsonb_array_elements(a.feedback->'criteria') f where f->>'status'<>'met')
) r on true;
revoke all on concept_learning_state from public,anon,authenticated;
grant select on concept_learning_state to service_role;
create function public.learning_concept_history_list(p_user uuid,p_limit integer,p_offset integer) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('total',(select count(*) from concept_learning_state where user_id=p_user),
 'concepts',coalesce((select jsonb_agg(to_jsonb(r) order by r.last_evaluated_at desc nulls last,r.id) from (
 select * from concept_learning_state where user_id=p_user order by last_evaluated_at desc nulls last,id limit greatest(1,least(p_limit,100)) offset greatest(0,p_offset)) r),'[]'::jsonb)); $$;
create function public.learning_concept_history_detail(p_user uuid,p_concept uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('concept',to_jsonb(c),
 'evidence',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (select * from learning_evidence where user_id=p_user and concept_id=p_concept order by created_at desc,id limit 100) r),'[]'::jsonb),
 'revisions',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (select id,session_id,status,created_at from explanation_revisions where user_id=p_user and concept_id=p_concept order by created_at desc,id limit 30) r),'[]'::jsonb),
 'issue_id',(select id from learning_issues where user_id=p_user and concept_id=p_concept)) from concept_learning_state c where c.user_id=p_user and c.id=p_concept; $$;
create function public.learning_resolve_issue() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare i learning_issues;
begin
 if exists(select 1 from concept_learning_state where id=new.concept_id and user_id=new.user_id and state='recent_stable') then
 update learning_issues set status='resolved',revision=revision+1,updated_at=now() where user_id=new.user_id and concept_id=new.concept_id and status not in ('closed','resolved') returning * into i;
 if found then insert into learning_issue_events(user_id,issue_id,action,evidence_id) values(new.user_id,i.id,'resolved',new.id); end if;
 end if; return new;
end; $$;
create trigger learning_issue_resolution after insert on learning_evidence for each row execute function learning_resolve_issue();
create function public.learning_report_reopen() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare i learning_issues;c uuid;
begin
 if new.data ? 'report' and not (old.data ? 'report') then
 select concept_id into c from learning_item_concepts where item_id=new.id and user_id=new.user_id;
 update learning_issues set status='needs_confirmation',revision=revision+1,updated_at=now() where user_id=new.user_id and concept_id=c and status<>'closed' returning * into i;
 if found then insert into learning_issue_events(user_id,issue_id,action) values(new.user_id,i.id,'quality_report'); end if;
 end if; return new;
end; $$;
create trigger learning_quality_report after update of data on learning_session_items for each row execute function learning_report_reopen();
create function public.learning_issue_recommendations(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc,r.id),'[]'::jsonb) from (
 select i.id,c.id as concept_id,c.title,c.state,c.evidence_count,i.updated_at from learning_issues i join concept_learning_state c on c.id=i.concept_id and c.user_id=p_user
 where i.user_id=p_user and i.status not in ('resolved','closed') and not c.source_changed order by i.updated_at desc,i.id limit 3) r; $$;
revoke all on function learning_concept_history_list(uuid,integer,integer),learning_concept_history_detail(uuid,uuid),learning_resolve_issue(),learning_report_reopen(),learning_issue_recommendations(uuid) from public,anon,authenticated;
grant execute on function learning_concept_history_list(uuid,integer,integer),learning_concept_history_detail(uuid,uuid),learning_resolve_issue(),learning_report_reopen(),learning_issue_recommendations(uuid) to service_role;
create or replace function public.learning_record_evidence(p_user uuid,p_concept uuid,p_session uuid,p_item uuid,p_kind text,p_source uuid,p_outcome text,p_assisted boolean,p_independent boolean) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare e uuid; i learning_issues; occurred timestamptz;
begin
 if p_kind in ('recall','check') then select created_at into occurred from learning_session_attempts where id=p_source and user_id=p_user;
 elsif p_kind='review' then select created_at into occurred from review_attempts where id=p_source and user_id=p_user;
 elsif p_kind='revision' then select updated_at into occurred from explanation_revisions where id=p_source and user_id=p_user; end if;
 insert into learning_evidence(user_id,concept_id,session_id,item_id,source_kind,source_id,outcome,assisted,independent,created_at)
 values(p_user,p_concept,p_session,p_item,p_kind,p_source,p_outcome,p_assisted,p_independent,coalesce(occurred,now()))
 on conflict(user_id,source_kind,source_id) do nothing returning id into e;
 if e is null then return; end if;
 if p_outcome<>'met' then
 insert into learning_issues(user_id,concept_id) values(p_user,p_concept)
 on conflict(user_id,concept_id) do update set updated_at=now(), revision=learning_issues.revision+1,
 status=case when learning_issues.status in ('resolved','closed') then 'needs_confirmation' else learning_issues.status end returning * into i;
 insert into learning_issue_events(user_id,issue_id,action,evidence_id) values(p_user,i.id,'evidence',e);
 else
 select * into i from learning_issues where user_id=p_user and concept_id=p_concept for update;
 if found then
 -- Repeated source questions are practice evidence, not independent transfer evidence.
 update learning_issues set updated_at=now(),revision=revision+1 where id=i.id;
 insert into learning_issue_events(user_id,issue_id,action,evidence_id) values(p_user,i.id,'practice',e);
 end if;
 end if;
end; $$;

update learning_evidence e set created_at=a.created_at from learning_session_attempts a where e.user_id=a.user_id and e.source_id=a.id and e.source_kind in ('recall','check');
commit;

begin;
create table public.external_connections (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null default 'google_calendar' check(provider='google_calendar'),
 status text not null default 'disconnected' check(status in ('connected','reconnect','disconnected')),
 tokens_ciphertext text,revision integer not null default 0,sync_sequence integer not null default 0,
 last_synced_at timestamptz,last_error text,created_at timestamptz not null default now(),unique(user_id,provider),unique(id,user_id)
);
create table public.integration_oauth_states (
 state_hash text primary key,user_id uuid not null,connection_id uuid not null,expected_revision integer not null,
 status text not null default 'pending' check(status in ('pending','consumed','done')),
 code_hash text,expires_at timestamptz not null default now()+interval '10 minutes',created_at timestamptz not null default now(),
 foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade
);
create table public.external_calendar_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,connection_id uuid not null,external_id text not null,
 title text not null,start_value text not null,end_value text not null,all_day boolean not null,
 start_at timestamptz not null,end_at timestamptz not null,unique(connection_id,external_id),unique(id,user_id),
 foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade
);
create index external_events_day on external_calendar_events(user_id,start_at,end_at);
create table public.external_event_courses (
 event_id uuid primary key,user_id uuid not null,course_id uuid not null,
 foreign key(event_id,user_id) references external_calendar_events(id,user_id) on delete cascade,
 foreign key(course_id,user_id) references courses(id,user_id) on delete cascade
);
alter table background_jobs add column connection_id uuid;
alter table background_jobs add column connection_revision integer;
alter table background_jobs add constraint integration_job_owner_fk foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade;
create function public.integration_connection(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select to_jsonb(c) from external_connections c where user_id=p_user and provider='google_calendar'; $$;
create function public.integration_begin(p_user uuid,p_state text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 delete from integration_oauth_states where expires_at<now()-interval '1 day';
 insert into external_connections(user_id) values(p_user) on conflict(user_id,provider) do nothing;
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 insert into integration_oauth_states(state_hash,user_id,connection_id,expected_revision) values(p_state,p_user,c.id,c.revision);
end; $$;
create function public.integration_consume(p_user uuid,p_state text,p_code text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare s integration_oauth_states;
begin
 select * into s from integration_oauth_states where state_hash=p_state and user_id=p_user for update;
 if not found or s.expires_at<=now() then raise exception 'LS_NOT_FOUND'; end if;
 if s.status='done' and s.code_hash=p_code then return to_jsonb(s); end if;
 if s.status<>'pending' then raise exception 'LS_CONFLICT'; end if;
 update integration_oauth_states set status='consumed',code_hash=p_code where state_hash=p_state returning * into s;
 return to_jsonb(s);
end; $$;
create function public.integration_connect(p_user uuid,p_state text,p_cipher text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare s integration_oauth_states;c external_connections;
begin
 select * into s from integration_oauth_states where state_hash=p_state and user_id=p_user and status='consumed' and expires_at>now() for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into c from external_connections where id=s.connection_id and user_id=p_user for update;
 if c.revision<>s.expected_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='connected',tokens_ciphertext=p_cipher,revision=revision+1,last_error=null where id=c.id returning * into c;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 update integration_oauth_states set status='done' where state_hash=p_state;
 return to_jsonb(c);
end; $$;
create function public.integration_refresh(p_user uuid,p_id uuid,p_revision integer,p_cipher text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 update external_connections set tokens_ciphertext=p_cipher where id=p_id and user_id=p_user and revision=p_revision and status='connected';
 return found;
end; $$;
create function public.integration_queue(p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;j background_jobs;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status<>'connected' then raise exception 'LS_NOT_FOUND'; end if;
 select * into j from background_jobs where connection_id=c.id and connection_revision=c.revision and status in ('queued','running') order by created_at desc limit 1;
 if found then return to_jsonb(j); end if;
 if (select count(*) from background_jobs where user_id=p_user and kind='calendar_sync' and created_at>now()-interval '1 hour')>=10 then raise exception 'LS_BUSY'; end if;
 update external_connections set sync_sequence=sync_sequence+1 where id=c.id returning * into c;
 insert into background_jobs(user_id,kind,target_id,generation,connection_id,connection_revision)
 values(p_user,'calendar_sync',c.id,c.sync_sequence,c.id,c.revision) returning * into j;
 return to_jsonb(j);
end; $$;
create function public.integration_disconnect(p_user uuid,p_revision integer,p_delete boolean) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status='disconnected' then return true; end if;
 if c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='disconnected',tokens_ciphertext=null,revision=revision+1,last_error=null where id=c.id;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 delete from integration_oauth_states where user_id=p_user;
 if p_delete then delete from external_calendar_events where user_id=p_user and connection_id=c.id; end if;
 return true;
end; $$;
create function public.integration_sync_finish(p_job uuid,p_token uuid,p_events jsonb,p_error text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;c external_connections;e jsonb;ids text[];
begin
 -- Lock connection before its jobs, as disconnect and reconnect do.
 select x.* into c from external_connections x join background_jobs b on b.connection_id=x.id and b.user_id=x.user_id where b.id=p_job for update of x;
 if not found then return false; end if;
 select * into j from background_jobs where id=p_job for update;
 if j.status<>'running' or j.lease_token<>p_token or j.lease_expires_at<=now() or c.status<>'connected' or c.revision<>j.connection_revision then return false; end if;
 if p_error is null then
 if jsonb_array_length(p_events)>1000 then raise exception 'LS_CONFLICT'; end if;
 select coalesce(array_agg(x->>'external_id'),'{}') into ids from jsonb_array_elements(p_events) x;
 for e in select value from jsonb_array_elements(p_events) loop
 insert into external_calendar_events(user_id,connection_id,external_id,title,start_value,end_value,all_day,start_at,end_at)
 values(c.user_id,c.id,e->>'external_id',e->>'title',e->>'start_value',e->>'end_value',(e->>'all_day')::boolean,(e->>'start_at')::timestamptz,(e->>'end_at')::timestamptz)
 on conflict(connection_id,external_id) do update set title=excluded.title,start_value=excluded.start_value,end_value=excluded.end_value,all_day=excluded.all_day,start_at=excluded.start_at,end_at=excluded.end_at;
 end loop;
 delete from external_calendar_events where connection_id=c.id and user_id=c.user_id and not (external_id=any(ids));
 update external_connections set last_synced_at=now(),last_error=null where id=c.id;
 else
 update external_connections set last_error=p_error,status=case when p_error='RECONNECT_REQUIRED' then 'reconnect' else status end where id=c.id;
 end if;
 update background_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,error_code=p_error where id=j.id;
 return true;
end; $$;
create function public.integration_events(p_user uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.start_at,r.id),'[]'::jsonb) from (
 select e.*,l.course_id from external_calendar_events e left join external_event_courses l on l.event_id=e.id and l.user_id=p_user
 where e.user_id=p_user and e.start_at<p_to and e.end_at>p_from order by e.start_at,e.id limit 500) r; $$;
create function public.integration_event_course(p_user uuid,p_event uuid,p_course uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 perform 1 from external_calendar_events where id=p_event and user_id=p_user for share;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if p_course is null then delete from external_event_courses where event_id=p_event and user_id=p_user; return true; end if;
 if not exists(select 1 from courses where id=p_course and user_id=p_user) then raise exception 'LS_NOT_FOUND'; end if;
 insert into external_event_courses(event_id,user_id,course_id) values(p_event,p_user,p_course) on conflict(event_id) do update set course_id=excluded.course_id;
 return true;
end; $$;
alter table external_connections enable row level security;
alter table integration_oauth_states enable row level security;
alter table external_calendar_events enable row level security;
alter table external_event_courses enable row level security;
revoke all on external_connections,integration_oauth_states,external_calendar_events,external_event_courses from public,anon,authenticated;
grant all on external_connections,integration_oauth_states,external_calendar_events,external_event_courses to service_role;
revoke all on function integration_connection(uuid),integration_begin(uuid,text),integration_consume(uuid,text,text),integration_connect(uuid,text,text),integration_refresh(uuid,uuid,integer,text),integration_queue(uuid),integration_disconnect(uuid,integer,boolean),integration_sync_finish(uuid,uuid,jsonb,text),integration_events(uuid,timestamptz,timestamptz),integration_event_course(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function integration_connection(uuid),integration_begin(uuid,text),integration_consume(uuid,text,text),integration_connect(uuid,text,text),integration_refresh(uuid,uuid,integer,text),integration_queue(uuid),integration_disconnect(uuid,integer,boolean),integration_sync_finish(uuid,uuid,jsonb,text),integration_events(uuid,timestamptz,timestamptz),integration_event_course(uuid,uuid,uuid) to service_role;
create function public.integration_job_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('status',b.status,'error_code',b.error_code) from background_jobs b join external_connections c on c.id=b.connection_id and c.user_id=p_user
 where b.user_id=p_user and c.revision=b.connection_revision order by b.generation desc limit 1; $$;
create function public.learning_workflow_clear(p_user uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 delete from background_jobs where user_id=p_user;
 delete from external_connections where user_id=p_user;
 delete from preparation_requests where user_id=p_user;
 delete from learning_session_packs where user_id=p_user;
 delete from learning_concepts where user_id=p_user;
 delete from learning_preferences where user_id=p_user;
 delete from learning_assessment_locks where user_id=p_user;
 delete from summary_chat_sessions where user_id=p_user;
 return true;
end; $$;
grant delete on summary_chat_sessions to service_role;
revoke all on function integration_job_status(uuid),learning_workflow_clear(uuid) from public,anon,authenticated;
grant execute on function integration_job_status(uuid),learning_workflow_clear(uuid) to service_role;

commit;

begin;
grant select,delete on public.summary_chat_sessions to service_role;
grant select,update on public.courses,public.materials to service_role;
create or replace function public.workflow_claim() returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;s learning_sessions;o learning_session_operations;
begin
 -- Exhausted leases become visible failures rather than running forever.
 update background_jobs set status='failed',error_code='WORKER_EXPIRED' where status='running' and lease_expires_at<=now() and attempts>=max_attempts;
 select * into j from background_jobs where (status='queued' and run_after<=now()) or (status='running' and lease_expires_at<=now() and attempts<max_attempts)
 order by run_after,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock(hashtextextended(j.user_id::text,0)) then return null; end if;
 if (select count(*) from background_jobs where user_id=j.user_id and status='running' and lease_expires_at>now() and id<>j.id)>=2 then return null; end if;
 if j.kind='session' then
 select * into o from learning_session_operations where id=j.target_id and user_id=j.user_id for update;
 if not found or o.status<>'running' or o.attempt_no<>j.generation then update background_jobs set status='succeeded' where id=j.id; return null; end if;
 select * into s from learning_sessions where id=j.session_id and user_id=j.user_id for update;
 if s.status in ('completed','abandoned') or (j.attempts>0 and s.calls>=(select concept_count+2 from learning_session_packs where id=s.pack_id)) then
 update background_jobs set status='cancelled' where id=j.id; return null; end if;
 if j.attempts>0 then update learning_sessions set calls=calls+1 where id=s.id; end if;
 update learning_session_operations set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '300 seconds' where id=o.id;
 elsif j.kind='review' then
 if not exists(select 1 from review_attempts where id=j.target_id and user_id=j.user_id and status='pending') then update background_jobs set status='succeeded' where id=j.id; return null; end if;
 update review_attempts set lease_expires_at=now()+interval '300 seconds' where id=j.target_id;
 elsif j.kind='revision' then
 if not exists(select 1 from explanation_evaluations where id=j.target_id and user_id=j.user_id and status='pending') then update background_jobs set status='succeeded' where id=j.id; return null; end if;
 update explanation_evaluations set lease_expires_at=now()+interval '300 seconds' where id=j.target_id;
 end if;
 update background_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '300 seconds' where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;
create or replace function public.preparation_apply(p_user uuid,p_artifact uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a preparation_artifacts;r preparation_requests;target uuid;identity jsonb;pack jsonb;
begin
 perform 1 from background_jobs where preparation_id=p_artifact and user_id=p_user for update;
 select * into a from preparation_artifacts where id=p_artifact and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if a.status='applied' then return to_jsonb(a); end if;
 if a.status<>'ready' then raise exception 'LS_CONFLICT'; end if;
 select * into r from preparation_requests where id=a.request_id and user_id=p_user;
 perform 1 from materials where course_id=r.course_id and id=r.material_id and user_id=p_user
 and encode(sha256(convert_to(markdown,'UTF8')),'hex')=r.source_hash for share;
 if not found then raise exception 'LS_SOURCE_CHANGED'; end if;
 target:=(a.result->>'reused_id')::uuid;
 if target is not null then
 if a.kind='summary' and not exists(select 1 from summaries where id=target and user_id=p_user) then target:=null;
 elsif a.kind='pack' and not exists(select 1 from learning_session_packs where id=target and user_id=p_user) then target:=null; end if; end if;
 if target is null then
 target:=a.id;
 if a.kind='summary' then
 identity:=r.config->'summary_identity';
 insert into summaries(id,user_id,course_id,template,content,material_ids,page_range,source_hash,request_key,generation_config,generation_id)
 values(target,p_user,r.course_id,'GENERAL',a.result->>'content',array[r.material_id],r.config->>'pages',r.source_hash,
 identity->>'request_key',identity->'generation_config',a.id);
 elsif a.kind='quiz' then
 insert into quiz_sets(id,user_id,course_id,title,difficulty,question_type,count,material_ids,questions)
 values(target,p_user,r.course_id,(r.config->>'material_name')||' 준비 퀴즈','보통','객관식',jsonb_array_length(a.result->'questions'),array[r.material_id],a.result->'questions');
 else
 pack:=r.config->'pack';
 select id into target from learning_session_packs where user_id=p_user and preparation_key=pack->>'preparation_key' and status='ready';
 if target is null then
 select id into target from learning_session_packs where user_id=p_user and preparation_key=pack->>'preparation_key' for update;
 if target is not null then
 if exists(select 1 from learning_session_packs where id=target and status='preparing') then raise exception 'LS_BUSY'; end if;
 update learning_session_packs set content=a.result->'content',status='ready' where id=target and status='failed';
 else target:=a.id;
 insert into learning_session_packs(id,user_id,course_id,material_id,material_name,preparation_key,source_hash,selected_scope,source_snapshot,source_units,concept_count,content_version,content,status)
 values(target,p_user,r.course_id,r.material_id,r.config->>'material_name',pack->>'preparation_key',r.source_hash,
 pack->'selected_scope',r.source_snapshot,pack->'source_units',2,pack->>'content_version',a.result->'content','ready');
 end if;
 end if;
 end if;
 end if;
 update preparation_artifacts set status='applied',applied_id=target where id=a.id returning * into a;
 return to_jsonb(a);
end; $$;
create or replace function public.learning_issue_detail(p_user uuid,p_issue uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('issue',to_jsonb(i),'concept',to_jsonb(c),'source_changed',(select c.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') from materials m where m.course_id=c.course_id and m.id=c.material_id and m.user_id=p_user),
 'evidence',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
 select e.*,coalesce(a.answer,e.answer_snapshot->'studentAnswer') as answer,a.result as feedback from learning_evidence e
 left join learning_session_attempts a on a.id=e.source_id and a.user_id=p_user
 where e.user_id=p_user and e.concept_id=i.concept_id order by e.created_at desc,e.id limit 100) r),'[]'::jsonb),
 'review_card_id',(select id from review_cards where user_id=p_user and concept_id=i.concept_id),'events',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
 select id,action,created_at from learning_issue_events where user_id=p_user and issue_id=p_issue order by created_at desc,id limit 100) r),'[]'::jsonb))
 from learning_issues i join learning_concepts c on c.id=i.concept_id and c.user_id=p_user where i.id=p_issue and i.user_id=p_user; $$;
commit;

begin;
create table public.learning_concept_links (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 source_id uuid not null,target_id uuid not null,relation text not null check(relation in ('equivalent','prerequisite')),
 created_at timestamptz not null default now(),check(source_id<>target_id),unique(user_id,source_id,target_id,relation),
 foreign key(source_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(target_id,user_id) references learning_concepts(id,user_id) on delete cascade
);
alter table learning_concept_links enable row level security;
revoke all on learning_concept_links from public,anon,authenticated;
grant all on learning_concept_links to service_role;
create function public.learning_graph_read(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('nodes',coalesce((select jsonb_agg(to_jsonb(r) order by r.title,r.id) from (
 select s.*,c.name as course_name,m.name as material_name from concept_learning_state s
 join courses c on c.id=s.course_id and c.user_id=p_user join materials m on m.course_id=s.course_id and m.id=s.material_id and m.user_id=p_user
 where s.user_id=p_user) r),'[]'::jsonb),'links',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from learning_concept_links e where user_id=p_user),'[]'::jsonb)); $$;
create function public.learning_graph_link(p_user uuid,p_id uuid,p_source uuid,p_target uuid,p_relation text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare old learning_concept_links;has_path boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,15));
 select * into old from learning_concept_links where id=p_id;
 if found then
 if old.user_id=p_user and old.source_id=p_source and old.target_id=p_target and old.relation=p_relation then return true; end if;
 raise exception 'LS_CONFLICT'; end if;
 if p_source=p_target or p_relation not in ('equivalent','prerequisite') then raise exception 'LS_CONFLICT'; end if;
 if (select count(*) from concept_learning_state where user_id=p_user and id in (p_source,p_target) and not source_changed)<>2 then raise exception 'LS_NOT_FOUND'; end if;
 if (select count(*) from learning_concept_links where user_id=p_user)>=3000 then raise exception 'LS_BUSY'; end if;
 with recursive edges as (
 select source_id as a,target_id as b,relation='prerequisite' as ordered from learning_concept_links where user_id=p_user
 union select target_id,source_id,false from learning_concept_links where user_id=p_user and relation='equivalent'
 ), walk(id,ordered) as (
 select p_target,false union select e.b,w.ordered or e.ordered from walk w join edges e on e.a=w.id
 ) select exists(select 1 from walk where id=p_source and (p_relation='prerequisite' or ordered)) into has_path;
 if has_path then raise exception 'LS_GRAPH_CYCLE'; end if;
 if p_relation='equivalent' then
 with recursive edges as (
 select source_id as a,target_id as b,relation='prerequisite' as ordered from learning_concept_links where user_id=p_user
 union select target_id,source_id,false from learning_concept_links where user_id=p_user and relation='equivalent'
 ),walk(id,ordered) as (select p_source,false union select e.b,w.ordered or e.ordered from walk w join edges e on e.a=w.id)
 select exists(select 1 from walk where id=p_target and ordered) into has_path;
 if has_path then raise exception 'LS_GRAPH_CYCLE'; end if;
 end if;
 insert into learning_concept_links(id,user_id,source_id,target_id,relation) values(p_id,p_user,p_source,p_target,p_relation) on conflict(user_id,source_id,target_id,relation) do nothing;
 return true;
end; $$;
create function public.learning_graph_unlink(p_user uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,15));
 delete from learning_concept_links where id=p_id and user_id=p_user; return true;
end; $$;
revoke all on function learning_graph_read(uuid),learning_graph_link(uuid,uuid,uuid,uuid,text),learning_graph_unlink(uuid,uuid) from public,anon,authenticated;
grant execute on function learning_graph_read(uuid),learning_graph_link(uuid,uuid,uuid,uuid,text),learning_graph_unlink(uuid,uuid) to service_role;
commit;

begin;
create table public.review_questions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,card_id uuid not null,round_key timestamptz not null,
 status text not null default 'queued' check(status in ('queued','ready','failed')),generation integer not null default 1,
 content jsonb,error_code text,created_at timestamptz not null default now(),unique(card_id,round_key),unique(id,user_id),
 foreign key(card_id,user_id) references review_cards(id,user_id) on delete cascade
);
alter table review_questions enable row level security;
revoke all on review_questions from public,anon,authenticated;
grant all on review_questions to service_role;
alter table review_attempts add column question_id uuid;
alter table review_attempts add constraint review_question_owner_fk foreign key(question_id,user_id) references review_questions(id,user_id);
alter table background_jobs drop constraint background_jobs_kind_check;
alter table background_jobs add constraint background_jobs_kind_check check(kind in ('session','review','revision','preparation','calendar_sync','review_question'));
alter table background_jobs add column question_id uuid;
alter table background_jobs add constraint question_job_fk foreign key(question_id,user_id) references review_questions(id,user_id) on delete cascade;
alter function public.review_context(uuid,uuid) rename to review_context_base;
create function public.review_context(p_user uuid,p_card uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select review_context_base(p_user,p_card)||jsonb_build_object('auto_questions',coalesce((select auto_review from learning_preferences where user_id=p_user),false),
 'questions',coalesce((select jsonb_agg(to_jsonb(q)) from review_questions q where q.user_id=p_user and q.card_id=p_card),'[]'::jsonb),
 'next_question',(select to_jsonb(q) from review_questions q join review_cards c on c.id=q.card_id and c.user_id=p_user where q.user_id=p_user and q.card_id=p_card and q.round_key=c.due_at)); $$;
create function public.review_question_queue(p_user uuid,p_card uuid,p_retry boolean default false) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c review_cards;q review_questions;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if c.paused then raise exception 'LS_CONFLICT'; end if;
 if (review_context(p_user,p_card)->>'source_changed')::boolean then raise exception 'LS_SOURCE_CHANGED'; end if;
 select * into q from review_questions where card_id=p_card and user_id=p_user and round_key=c.due_at for update;
 if found then
 if not p_retry or q.status<>'failed' then return to_jsonb(q); end if;
 if q.generation>=3 then raise exception 'LS_BUSY'; end if;
 update review_questions set status='queued',generation=generation+1,error_code=null where id=q.id returning * into q;
 else
 if (select count(*) from review_questions where user_id=p_user and created_at>=current_date)>=30 then raise exception 'LS_BUSY'; end if;
 insert into review_questions(user_id,card_id,round_key) values(p_user,p_card,c.due_at) returning * into q;
 end if;
 insert into background_jobs(user_id,kind,target_id,generation,question_id,review_card_id) values(p_user,'review_question',q.id,q.generation,q.id,p_card);
 return to_jsonb(q);
end; $$;
create function public.review_question_finish(p_job uuid,p_token uuid,p_content jsonb,p_error text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;q review_questions;
begin
 select * into j from background_jobs where id=p_job for update;
 if not found or j.kind<>'review_question' or j.status<>'running' or j.lease_token<>p_token or j.lease_expires_at<=now() then return false; end if;
 select * into q from review_questions where id=j.question_id and user_id=j.user_id for update;
 if not found or q.generation<>j.generation or q.status<>'queued' then return false; end if;
 if (review_context(q.user_id,q.card_id)->>'source_changed')::boolean then p_error:='SOURCE_CHANGED'; end if;
 update review_questions set status=case when p_error is null then 'ready' else 'failed' end,content=case when p_error is null then p_content end,error_code=p_error where id=q.id;
 update background_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,error_code=p_error where id=j.id; return true;
end; $$;
create function public.review_start_variant(p_user uuid,p_card uuid,p_id uuid,p_answer text,p_assisted boolean,p_question uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a review_attempts;r jsonb;c review_cards;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into a from review_attempts where id=p_id;
 if found then
 if a.user_id<>p_user or a.card_id<>p_card or a.question_id is distinct from p_question or a.answer<>p_answer or a.assisted<>p_assisted then raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(a)||jsonb_build_object('claimed',false); end if;
 if p_question is not null and not exists(select 1 from review_questions where id=p_question and user_id=p_user and card_id=p_card and status='ready' and round_key=c.due_at) then raise exception 'LS_CONFLICT'; end if;
 r:=review_start(p_user,p_card,p_id,p_answer,p_assisted);
 update review_attempts set question_id=p_question where id=p_id returning * into a;
 return to_jsonb(a)||jsonb_build_object('claimed',(r->>'claimed')::boolean);
end; $$;
create or replace function public.review_check(p_user uuid,p_card uuid,p_id uuid,p_selected integer,p_interval integer,p_success boolean) returns jsonb
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
 if a.question_id is null then q:=ctx->'concept'->'check';
 else select content->'check' into q from review_questions where id=a.question_id and user_id=p_user and card_id=p_card and status='ready'; end if;
 if q is null then raise exception 'LS_CONFLICT'; end if;
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
create or replace function public.learning_capture_review() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c review_cards; outcome text;
begin
 if new.check_selected is null or new.status<>'graded' then return new; end if;
 select * into c from review_cards where id=new.card_id and user_id=new.user_id;
 if not found then return new; end if;
 outcome:=case when exists(select 1 from jsonb_array_elements(new.feedback->'criteria') f where f->>'status'='uncertain') then 'uncertain'
 when not (new.check_result->>'correct')::boolean or exists(select 1 from jsonb_array_elements(new.feedback->'criteria') f where f->>'status'<>'met') then 'needs_review' else 'met' end;
 perform learning_record_evidence(new.user_id,c.concept_id,c.source_session_id,c.source_item_id,'review',new.id,outcome,new.assisted,new.question_id is not null and new.eligible_for_schedule and not new.assisted and not exists(select 1 from review_attempts prior where prior.user_id=new.user_id and prior.question_id=new.question_id and (prior.created_at,prior.id)<(new.created_at,new.id)));
 return new;
end; $$;
create or replace view public.concept_learning_state with (security_invoker=true) as
select c.id,c.user_id,c.course_id,c.material_id,c.title,c.source_hash,
 c.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed,
 coalesce(e.evidence_count,0) as evidence_count,coalesce(e.independent_questions,0)+coalesce(r.novel_questions,0) as independent_questions,
 coalesce(e.assisted_count,0) as assisted_count,coalesce(r.delayed_practice,0) as delayed_practice,
 e.last_outcome,e.last_evaluated_at,'concept-state-v2'::text as policy_version,
 case when c.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') then 'source_changed'
 when coalesce(e.evidence_count,0)=0 then 'unassessed'
 when e.last_verified_outcome='needs_review' or e.recent_failures>=2 then 'needs_review'
 when e.last_outcome='uncertain' then 'needs_confirmation'
 when coalesce(e.independent_questions,0)+coalesce(r.novel_questions,0)>=2 and coalesce(r.delayed_practice,0)>=1 and e.recent_failures=0 then 'recent_stable'
 when exists(select 1 from learning_issues i where i.concept_id=c.id and i.user_id=c.user_id and i.status='awaiting_reassessment') then 'awaiting_reassessment'
 else 'needs_confirmation' end as state
from learning_concepts c join materials m on m.course_id=c.course_id and m.id=c.material_id and m.user_id=c.user_id
left join lateral (
 select count(*) as evidence_count,count(*) filter(where v.assisted) as assisted_count,
 count(distinct md5(p.content->'concepts'->i.position->>'question')) filter(where v.independent and not v.assisted and v.source_kind='recall' and v.outcome='met') as independent_questions,
 count(*) filter(where v.outcome='needs_review' and v.created_at>=now()-interval '14 days') as recent_failures,
 (array_agg(v.outcome order by v.created_at desc,v.id desc) filter(where v.source_kind not in ('quiz','revision') and (v.outcome='needs_review' or v.independent and v.outcome='met')))[1] as last_verified_outcome,
 (array_agg(v.outcome order by v.created_at desc,v.id desc))[1] as last_outcome,max(v.created_at) as last_evaluated_at
 from learning_evidence v join learning_session_items i on i.id=v.item_id and i.user_id=c.user_id
 join learning_sessions s on s.id=v.session_id and s.user_id=c.user_id
 join learning_session_packs p on p.id=s.pack_id and p.user_id=c.user_id
 where v.concept_id=c.id and v.user_id=c.user_id and not (i.data ? 'report')
) e on true
left join lateral (
 select count(*) as delayed_practice,count(distinct md5(q.content->>'question')) filter(where a.question_id is not null and not exists(select 1 from review_attempts prior where prior.user_id=a.user_id and prior.question_id=a.question_id and (prior.created_at,prior.id)<(a.created_at,a.id))) as novel_questions from review_cards k join review_attempts a on a.card_id=k.id and a.user_id=c.user_id
 left join review_questions q on q.id=a.question_id and q.user_id=c.user_id
 join learning_session_items ri on ri.id=k.source_item_id and ri.user_id=c.user_id
 where k.concept_id=c.id and k.user_id=c.user_id and not (ri.data ? 'report') and a.status='graded' and a.eligible_for_schedule and not a.assisted
 and coalesce((a.check_result->>'correct')::boolean,false) and jsonb_array_length(coalesce(a.feedback->'criteria','[]'))>0
 and not exists(select 1 from jsonb_array_elements(a.feedback->'criteria') f where f->>'status'<>'met')
) r on true;

create function public.review_question_job_failed() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if new.kind='review_question' and new.status='failed' then update review_questions set status='failed',error_code=coalesce(new.error_code,'WORKER_FAILED') where id=new.question_id and user_id=new.user_id and generation=new.generation and status='queued'; end if; return new;
end; $$;
create trigger review_question_failure after update of status on background_jobs for each row execute function review_question_job_failed();
revoke all on function review_context(uuid,uuid),review_question_queue(uuid,uuid,boolean),review_question_finish(uuid,uuid,jsonb,text),review_start_variant(uuid,uuid,uuid,text,boolean,uuid),review_question_job_failed() from public,anon,authenticated;
grant execute on function review_context(uuid,uuid),review_question_queue(uuid,uuid,boolean),review_question_finish(uuid,uuid,jsonb,text),review_start_variant(uuid,uuid,uuid,text,boolean,uuid),review_question_job_failed() to service_role;
commit;

begin;
alter table external_connections add column sync_enabled boolean not null default false;
alter table external_connections add column sync_interval_minutes integer not null default 30 check(sync_interval_minutes between 15 and 1440);
alter table external_connections add column next_sync_at timestamptz;
alter table external_connections add column consecutive_failures integer not null default 0;
create function public.integration_sync_preferences(p_user uuid,p_revision integer,p_enabled boolean,p_minutes integer) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status<>'connected' then raise exception 'LS_NOT_FOUND'; end if;
 if c.revision<>p_revision or p_minutes not between 15 and 1440 then raise exception 'LS_CONFLICT'; end if;
 update external_connections set sync_enabled=p_enabled,sync_interval_minutes=p_minutes,next_sync_at=case when p_enabled then now() end,
 revision=revision+1 where id=c.id returning * into c;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 return to_jsonb(c);
end; $$;
create function public.integration_schedule_next() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if new.status='disconnected' then new.sync_enabled:=false;new.next_sync_at:=null;
 elsif new.last_synced_at is distinct from old.last_synced_at then
 new.consecutive_failures:=0;
 if new.sync_enabled then new.next_sync_at:=now()+make_interval(mins=>new.sync_interval_minutes); end if;
 elsif new.last_error is not null and (new.last_error is distinct from old.last_error or new.last_synced_at is not distinct from old.last_synced_at) then
 new.consecutive_failures:=least(old.consecutive_failures+1,8);
 if new.sync_enabled then new.next_sync_at:=now()+make_interval(mins=>least(1440,new.sync_interval_minutes*(2^new.consecutive_failures)::integer)); end if;
 end if;return new;
end; $$;
create trigger integration_schedule before update of status,last_synced_at,last_error on external_connections for each row execute function integration_schedule_next();
create function public.workflow_schedule() returns integer
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;r review_cards;n integer:=0;
begin
 if not pg_try_advisory_xact_lock(230017) then return 0; end if;
 for c in select * from external_connections where provider='google_calendar' and status='connected' and sync_enabled and coalesce(next_sync_at,now())<=now() order by next_sync_at nulls first for update skip locked limit 20 loop
 begin
 perform integration_queue(c.user_id);
 update external_connections set next_sync_at=now()+make_interval(mins=>sync_interval_minutes) where id=c.id;
 n:=n+1;
 exception when raise_exception then update external_connections set next_sync_at=now()+interval '1 hour' where id=c.id;
 end;
 end loop;
 for r in select k.* from review_cards k join learning_preferences p on p.user_id=k.user_id and p.auto_review
 join concept_learning_state s on s.id=k.concept_id and s.user_id=k.user_id
 where not k.paused and k.due_at<=now() and not s.source_changed
 and (select count(*) from review_questions q where q.user_id=k.user_id and q.created_at>=current_date)<30
 and not exists(select 1 from review_questions q where q.card_id=k.id and q.round_key=k.due_at)
 order by k.due_at limit 20 loop
 begin perform review_question_queue(r.user_id,r.id,false); n:=n+1; exception when raise_exception then null; end;
 end loop;
 return n;
end; $$;
create function public.calendar_job_expired() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if new.kind='calendar_sync' and new.status='failed' and old.status='running' and new.error_code='WORKER_EXPIRED' then
 update external_connections set last_error='WORKER_EXPIRED' where id=new.connection_id and user_id=new.user_id and revision=new.connection_revision and status='connected'; end if; return new;
end; $$;
create trigger calendar_job_expiry after update of status on background_jobs for each row execute function calendar_job_expired();
revoke all on function integration_sync_preferences(uuid,integer,boolean,integer),integration_schedule_next(),workflow_schedule(),calendar_job_expired() from public,anon,authenticated;
grant execute on function integration_sync_preferences(uuid,integer,boolean,integer),integration_schedule_next(),workflow_schedule(),calendar_job_expired() to service_role;
commit;

begin;
alter table external_connections drop constraint external_connections_provider_check;
alter table external_connections add constraint external_connections_provider_check check(provider in ('google_calendar','google_drive','notion'));
alter table external_connections add column refresh_lease uuid;
alter table external_connections add column refresh_expires_at timestamptz;
create table public.external_material_drafts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,connection_id uuid not null,course_id uuid not null,
 external_id text not null,title text not null,source_modified text not null,content_hash text not null,markdown text not null check(length(markdown) between 1 and 300000),
 notices jsonb not null default '[]',status text not null default 'ready' check(status in ('ready','applied','discarded')),material_id text,
 created_at timestamptz not null default now(),unique(connection_id,course_id,external_id,content_hash),
 foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade,
 foreign key(course_id,user_id) references courses(id,user_id) on delete cascade
);
alter table external_material_drafts enable row level security;
revoke all on external_material_drafts from public,anon,authenticated;
grant all on external_material_drafts to service_role;
grant insert on materials to service_role;
create function public.source_connection(p_user uuid,p_provider text) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$ select to_jsonb(c) from external_connections c where user_id=p_user and provider=p_provider; $$;
create function public.source_begin(p_user uuid,p_provider text,p_state text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 if p_provider not in ('google_drive','notion') then raise exception 'LS_CONFLICT'; end if;
 delete from integration_oauth_states where expires_at<now()-interval '1 day';
 insert into external_connections(user_id,provider) values(p_user,p_provider) on conflict(user_id,provider) do nothing;
 select * into c from external_connections where user_id=p_user and provider=p_provider for update;
 insert into integration_oauth_states(state_hash,user_id,connection_id,expected_revision) values(p_state,p_user,c.id,c.revision);
end; $$;
create function public.source_consume(p_user uuid,p_provider text,p_state text,p_code text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if not exists(select 1 from integration_oauth_states s join external_connections c on c.id=s.connection_id and c.user_id=p_user and c.provider=p_provider where s.state_hash=p_state and s.user_id=p_user) then raise exception 'LS_NOT_FOUND'; end if;
 return integration_consume(p_user,p_state,p_code);
end; $$;
create function public.source_disconnect(p_user uuid,p_provider text,p_revision integer) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider=p_provider for update;
 if not found or c.status='disconnected' then return true; end if;
 if c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='disconnected',tokens_ciphertext=null,revision=revision+1,refresh_lease=null,refresh_expires_at=null where id=c.id;
 delete from integration_oauth_states where connection_id=c.id and user_id=p_user;
 update external_material_drafts set status='discarded' where connection_id=c.id and user_id=p_user and status='ready';
 return true;
end; $$;
create function public.source_refresh_claim(p_user uuid,p_provider text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider=p_provider for update;
 if not found or c.status<>'connected' or c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 if c.refresh_expires_at>now() then raise exception 'LS_BUSY'; end if;
 update external_connections set refresh_lease=gen_random_uuid(),refresh_expires_at=now()+interval '60 seconds' where id=c.id returning * into c;
 return to_jsonb(c);
end; $$;
create function public.source_refresh_save(p_user uuid,p_id uuid,p_revision integer,p_lease uuid,p_cipher text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 update external_connections set tokens_ciphertext=coalesce(p_cipher,tokens_ciphertext),refresh_lease=null,refresh_expires_at=null,
 status=case when p_cipher is null then 'reconnect' else status end
 where id=p_id and user_id=p_user and revision=p_revision and refresh_lease=p_lease and refresh_expires_at>now() and status='connected'; return found;
end; $$;
create function public.source_draft_create(p_user uuid,p_connection uuid,p_revision integer,p_course uuid,p_external text,p_title text,p_modified text,p_markdown text,p_notices jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare d external_material_drafts;
begin
 perform 1 from external_connections where id=p_connection and user_id=p_user and revision=p_revision and status='connected' and provider in ('google_drive','notion') for share;
 if not found then raise exception 'LS_CONFLICT'; end if;
 perform 1 from courses where id=p_course and user_id=p_user for share;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into d from external_material_drafts where user_id=p_user and connection_id=p_connection and course_id=p_course and external_id=p_external and content_hash=encode(sha256(convert_to(p_markdown,'UTF8')),'hex') for update;
 if found then
 update external_material_drafts set source_modified=p_modified,status=case when status='discarded' or status='applied' and not exists(select 1 from materials where course_id=p_course and id=d.material_id and user_id=p_user) then 'ready' else status end where id=d.id returning * into d;
 return to_jsonb(d); end if;
 if (select count(*) from external_material_drafts where user_id=p_user and created_at>=current_date)>=50 then raise exception 'LS_BUSY'; end if;
 insert into external_material_drafts(user_id,connection_id,course_id,external_id,title,source_modified,content_hash,markdown,notices)
 values(p_user,p_connection,p_course,p_external,p_title,p_modified,encode(sha256(convert_to(p_markdown,'UTF8')),'hex'),p_markdown,p_notices)
 on conflict(connection_id,course_id,external_id,content_hash) do update set source_modified=excluded.source_modified
 returning * into d;return to_jsonb(d);
end; $$;
create function public.source_draft_action(p_user uuid,p_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare d external_material_drafts;c external_connections;
begin
 select x.* into c from external_connections x join external_material_drafts a on a.connection_id=x.id and a.user_id=p_user where a.id=p_id and x.user_id=p_user for share of x;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into d from external_material_drafts where id=p_id and user_id=p_user for update;
 if p_action='discard' and d.status='ready' then update external_material_drafts set status='discarded' where id=d.id returning * into d;return to_jsonb(d); end if;
 if p_action<>'apply' then raise exception 'LS_CONFLICT'; end if;
 if d.status='applied' then return to_jsonb(d); end if;
 if d.status<>'ready' or c.status<>'connected' then raise exception 'LS_CONFLICT'; end if;
 d.material_id:='external:'||d.id::text;
 insert into materials(course_id,id,user_id,name,type,markdown,mime_type)
 values(d.course_id,d.material_id,p_user,d.title,'file',d.markdown,'text/markdown');
 update external_material_drafts set status='applied',material_id=d.material_id where id=d.id returning * into d;
 return to_jsonb(d);
end; $$;
create function public.source_drafts(p_user uuid,p_provider text) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) from (
 select d.* from external_material_drafts d join external_connections c on c.id=d.connection_id and c.user_id=p_user and c.provider=p_provider where d.user_id=p_user order by d.created_at desc limit 50) r; $$;
revoke all on function source_connection(uuid,text),source_begin(uuid,text,text),source_consume(uuid,text,text,text),source_disconnect(uuid,text,integer),source_refresh_claim(uuid,text,integer),source_refresh_save(uuid,uuid,integer,uuid,text),source_draft_create(uuid,uuid,integer,uuid,text,text,text,text,jsonb),source_draft_action(uuid,uuid,text),source_drafts(uuid,text) from public,anon,authenticated;
grant execute on function source_connection(uuid,text),source_begin(uuid,text,text),source_consume(uuid,text,text,text),source_disconnect(uuid,text,integer),source_refresh_claim(uuid,text,integer),source_refresh_save(uuid,uuid,integer,uuid,text),source_draft_create(uuid,uuid,integer,uuid,text,text,text,text,jsonb),source_draft_action(uuid,uuid,text),source_drafts(uuid,text) to service_role;
create or replace function public.integration_disconnect(p_user uuid,p_revision integer,p_delete boolean) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status='disconnected' then return true; end if;
 if c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='disconnected',tokens_ciphertext=null,revision=revision+1,last_error=null where id=c.id;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 delete from integration_oauth_states where user_id=p_user and connection_id=c.id;
 if p_delete then delete from external_calendar_events where user_id=p_user and connection_id=c.id; end if;
 return true;
end; $$;
commit;
