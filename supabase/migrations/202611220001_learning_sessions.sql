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
