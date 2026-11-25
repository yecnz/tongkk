-- Server-only, owner-scoped RPCs. Apply after the existing learning workflow migrations.
begin;
create table public.study_paths (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 100),
 chapters jsonb not null check(jsonb_typeof(chapters)='array' and jsonb_array_length(chapters) between 1 and 12),
 revision integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,user_id),
 foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade
);
create index study_paths_owner on public.study_paths(user_id,updated_at desc);
create table public.study_path_sessions (
 path_id uuid not null, user_id uuid not null, chapter_id uuid not null, session_id uuid not null,
 primary key(path_id,chapter_id),
 foreign key(path_id,user_id) references public.study_paths(id,user_id) on delete cascade,
 foreign key(session_id,user_id) references public.learning_sessions(id,user_id) on delete cascade
);
alter table public.study_paths enable row level security;
alter table public.study_path_sessions enable row level security;
revoke all on public.study_paths,public.study_path_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.study_paths,public.study_path_sessions to service_role;

create function public.study_path_read(p_user uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select to_jsonb(p) || jsonb_build_object('chapters',(
  select jsonb_agg(c || jsonb_build_object(
    'source_changed',m.id is null or c->>'source_hash'<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex'),
    'session_id',s.id,'session_status',s.status,
    'completed',coalesce(s.status='completed' and jsonb_array_length(s.result)>0 and not exists(
      select 1 from jsonb_array_elements(s.result) r where coalesce((r->>'skipped')::boolean,false)
        or coalesce(r->>'check','ungraded')='ungraded'),false)) order by ord)
  from jsonb_array_elements(p.chapters) with ordinality x(c,ord)
  left join materials m on m.course_id=p.course_id and m.id=c->>'material_id' and m.user_id=p_user
  left join study_path_sessions l on l.path_id=p.id and l.chapter_id=(c->>'id')::uuid and l.user_id=p_user
  left join learning_sessions s on s.id=l.session_id and s.user_id=p_user))
 from study_paths p where p.id=p_id and p.user_id=p_user;
$$;

create function public.study_path_list(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(study_path_read(p_user,id) order by updated_at desc),'[]'::jsonb)
 from study_paths where user_id=p_user;
$$;

create function public.study_path_create(p_user uuid,p_id uuid,p_course uuid,p_title text,p_chapters jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare chapter jsonb; old study_paths;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,260002));
 select * into old from study_paths where id=p_id;
 if found then
  if old.user_id<>p_user then raise exception 'LS_NOT_FOUND'; end if;
  return study_path_read(p_user,p_id);
 end if;
 if (select count(*) from study_paths where user_id=p_user)>=30 then raise exception 'LS_BUSY'; end if;
 if jsonb_typeof(p_chapters)<>'array' or jsonb_array_length(p_chapters) not between 1 and 12
   or (select count(distinct c->>'id') from jsonb_array_elements(p_chapters)c)<>jsonb_array_length(p_chapters)
   then raise exception 'LS_CONFLICT'; end if;
 for chapter in select value from jsonb_array_elements(p_chapters) loop
  perform 1 from materials m where m.course_id=p_course and m.id=chapter->>'material_id' and m.user_id=p_user for share;
  if not found then raise exception 'LS_NOT_FOUND'; end if;
  if not exists(select 1 from materials m where m.course_id=p_course and m.id=chapter->>'material_id'
    and m.user_id=p_user and chapter->>'source_hash'=encode(sha256(convert_to(m.markdown,'UTF8')),'hex'))
    then raise exception 'LS_SOURCE_CHANGED'; end if;
 end loop;
 insert into study_paths(id,user_id,course_id,title,chapters) values(p_id,p_user,p_course,p_title,p_chapters);
 return study_path_read(p_user,p_id);
end; $$;

create function public.study_path_edit(p_user uuid,p_id uuid,p_revision integer,p_title text,p_chapters jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare old study_paths; edits jsonb; chapter jsonb; original jsonb; changed jsonb:='[]';
begin
 select * into old from study_paths where id=p_id and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if old.revision<>p_revision or jsonb_typeof(p_chapters)<>'array' or jsonb_array_length(p_chapters)<>jsonb_array_length(old.chapters)
   or (select count(distinct c->>'id') from jsonb_array_elements(p_chapters)c)<>jsonb_array_length(p_chapters)
   or not exists(select 1 from jsonb_array_elements(p_chapters)c where c->>'included'='true')
   then raise exception 'LS_CONFLICT'; end if;
 for edits in select value from jsonb_array_elements(p_chapters) loop
  select c into original from jsonb_array_elements(old.chapters)c where c->>'id'=edits->>'id';
  if original is null or length(trim(edits->>'title')) not between 1 and 100
    or jsonb_typeof(edits->'included')<>'boolean' then raise exception 'LS_CONFLICT'; end if;
  chapter:=original||jsonb_build_object('title',edits->>'title','included',edits->'included');
  changed:=changed||jsonb_build_array(chapter);
 end loop;
 update study_paths set title=p_title,chapters=changed,revision=revision+1,updated_at=now() where id=p_id;
 return study_path_read(p_user,p_id);
end; $$;

create function public.study_path_link_session(p_user uuid,p_id uuid,p_chapter uuid,p_session uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare path study_paths; chapter jsonb;
begin
 select * into path from study_paths where id=p_id and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select c into chapter from jsonb_array_elements(path.chapters)c where c->>'id'=p_chapter::text and c->>'included'='true';
 if chapter is null then raise exception 'LS_CONFLICT'; end if;
 if not exists(select 1 from learning_sessions s join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
    where s.id=p_session and s.user_id=p_user and s.course_id=path.course_id
      and p.material_id=chapter->>'material_id' and p.source_hash=chapter->>'source_hash'
      and p.selected_scope->'unit_ids'=chapter->'unit_ids') then raise exception 'LS_NOT_FOUND'; end if;
 insert into study_path_sessions(path_id,user_id,chapter_id,session_id) values(p_id,p_user,p_chapter,p_session)
 on conflict(path_id,chapter_id) do update set session_id=excluded.session_id
 where study_path_sessions.session_id=excluded.session_id or exists(select 1 from learning_sessions old
   where old.id=study_path_sessions.session_id and old.user_id=p_user and old.status in ('completed','abandoned'));
 if not found then raise exception 'LS_CONFLICT'; end if;
 update study_paths set updated_at=now() where id=p_id;
 return true;
end; $$;

revoke all on function study_path_read(uuid,uuid),study_path_list(uuid),study_path_create(uuid,uuid,uuid,text,jsonb),
 study_path_edit(uuid,uuid,integer,text,jsonb),study_path_link_session(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function study_path_read(uuid,uuid),study_path_list(uuid),study_path_create(uuid,uuid,uuid,text,jsonb),
 study_path_edit(uuid,uuid,integer,text,jsonb),study_path_link_session(uuid,uuid,uuid,uuid) to service_role;
commit;
