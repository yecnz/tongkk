begin;
-- References are used on the server to discover related concepts, never grading data.
create or replace function public.learning_graph_read(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('nodes',coalesce((select jsonb_agg(to_jsonb(r) order by r.title,r.id) from (
 select s.*,k.source_refs,c.name as course_name,m.name as material_name from concept_learning_state s
 join learning_concepts k on k.id=s.id and k.user_id=p_user
 join courses c on c.id=s.course_id and c.user_id=p_user
 join materials m on m.course_id=s.course_id and m.id=s.material_id and m.user_id=p_user where s.user_id=p_user) r),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from learning_concept_links e where user_id=p_user),'[]'::jsonb)); $$;

create function public.learning_graph_concept_source(p_user uuid,p_concept uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('pack',to_jsonb(p),'concept',p.content->'concepts'->i.position,
 'repeated',exists(select 1 from learning_item_concepts b2 join learning_session_attempts a2 on a2.item_id=b2.item_id and a2.user_id=p_user where b2.concept_id=p_concept and b2.user_id=p_user))
 from learning_concepts c join learning_item_concepts b on b.concept_id=c.id and b.user_id=p_user
 join learning_session_items i on i.id=b.item_id and i.user_id=p_user
 join learning_sessions s on s.id=b.session_id and s.user_id=p_user
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 join materials m on m.course_id=c.course_id and m.id=c.material_id and m.user_id=p_user
 where c.user_id=p_user and c.id=p_concept and p.status='ready' and not (i.data ? 'report')
 and c.source_hash=encode(sha256(convert_to(m.markdown,'UTF8')),'hex')
 and p.source_hash=c.source_hash and p.content->'concepts'->i.position->>'title'=c.title
 and coalesce(p.content->'concepts'->i.position->'source_refs','[]'::jsonb)=c.source_refs
 order by s.created_at desc,i.id limit 1; $$;

create table public.learning_study_paths (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 target_id uuid not null,status text not null default 'active' check(status in ('active','completed','invalidated')),
 position integer not null default 0 check(position>=0),created_at timestamptz not null default now(),unique(id,user_id),
 foreign key(target_id,user_id) references learning_concepts(id,user_id) on delete cascade
);
create unique index learning_study_paths_open on learning_study_paths(user_id,target_id) where status='active';
create table public.learning_study_path_steps (
 path_id uuid not null,user_id uuid not null,position integer not null check(position>=0),concept_id uuid not null,
 title text not null,reason text not null,session_id uuid,primary key(path_id,position),
 foreign key(path_id,user_id) references learning_study_paths(id,user_id) on delete cascade,
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(session_id,user_id) references learning_sessions(id,user_id) on delete cascade
);
create function public.learning_graph_forget_paths() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 delete from learning_study_paths p where p.user_id=old.user_id and exists(
 select 1 from learning_study_path_steps t where t.path_id=p.id and t.user_id=old.user_id and t.concept_id=old.id);
 return old;
end; $$;
create trigger learning_graph_source_delete before delete on learning_concepts for each row execute function learning_graph_forget_paths();
revoke all on function learning_graph_forget_paths() from public,anon,authenticated;
grant execute on function learning_graph_forget_paths() to service_role;
alter table learning_study_paths enable row level security;
alter table learning_study_path_steps enable row level security;
revoke all on learning_study_paths,learning_study_path_steps from public,anon,authenticated;
grant all on learning_study_paths,learning_study_path_steps to service_role;

create function public.learning_graph_path_read(p_user uuid,p_path uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select to_jsonb(p)||jsonb_build_object('steps',coalesce((select jsonb_agg(to_jsonb(r) order by r.position) from (
 select t.position,t.concept_id,t.title,t.reason,t.session_id,s.status as session_status,
 (s.status='completed' and exists(select 1 from learning_session_items i where i.session_id=s.id and i.user_id=p_user)
 and not exists(select 1 from learning_session_items i where i.session_id=s.id and i.user_id=p_user and i.phase<>'done')) as session_complete,
 coalesce(c.source_changed,true) as source_changed,m.name as material_name,k.name as course_name
 from learning_study_path_steps t left join concept_learning_state c on c.id=t.concept_id and c.user_id=p_user
 left join learning_sessions s on s.id=t.session_id and s.user_id=p_user
 left join courses k on k.id=c.course_id and k.user_id=p_user
 left join materials m on m.id=c.material_id and m.course_id=c.course_id and m.user_id=p_user
 where t.path_id=p.id and t.user_id=p_user) r),'[]'::jsonb)) from learning_study_paths p where p.id=p_path and p.user_id=p_user; $$;

create function public.learning_graph_path_begin(p_user uuid,p_id uuid,p_target uuid,p_steps jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare existing learning_study_paths;step jsonb;idx integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,26));
 select * into existing from learning_study_paths where id=p_id;
 if found then
   if existing.user_id<>p_user or existing.target_id<>p_target then raise exception 'LS_CONFLICT'; end if;
   return learning_graph_path_read(p_user,existing.id);
 end if;
 -- A changed/deleted source requires a fresh plan, never silently replace a running step.
 update learning_study_paths p set status='invalidated' where p.user_id=p_user and p.status='active'
 and exists(select 1 from learning_study_path_steps t left join concept_learning_state c on c.id=t.concept_id and c.user_id=p_user
 where t.path_id=p.id and (coalesce(c.source_changed,true) or exists(select 1 from learning_sessions s where s.id=t.session_id and s.user_id=p_user and (s.status='abandoned' or s.status='completed' and exists(select 1 from learning_session_items i where i.session_id=s.id and i.phase<>'done')))));
 select * into existing from learning_study_paths where user_id=p_user and target_id=p_target and status='active';
 if found then return learning_graph_path_read(p_user,existing.id); end if;
 if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 12 then raise exception 'LS_CONFLICT'; end if;
 if not exists(select 1 from jsonb_array_elements(p_steps) x where x->>'concept_id'=p_target::text)
 or (select count(distinct c.id) from jsonb_array_elements(p_steps) x join concept_learning_state c on c.id=(x->>'concept_id')::uuid and c.user_id=p_user and not c.source_changed)<>jsonb_array_length(p_steps) then raise exception 'LS_NOT_FOUND'; end if;
 insert into learning_study_paths(id,user_id,target_id) values(p_id,p_user,p_target);
 for step in select * from jsonb_array_elements(p_steps) loop
 insert into learning_study_path_steps(path_id,user_id,position,concept_id,title,reason)
 values(p_id,p_user,idx,(step->>'concept_id')::uuid,step->>'title',step->>'reason');idx:=idx+1;
 end loop;
 return learning_graph_path_read(p_user,p_id);
end; $$;

create function public.learning_graph_path_attach(p_user uuid,p_path uuid,p_position integer,p_session uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare path learning_study_paths;step learning_study_path_steps;
begin
 select * into path from learning_study_paths where id=p_path and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if path.status<>'active' or path.position<>p_position then raise exception 'LS_CONFLICT'; end if;
 select * into step from learning_study_path_steps where path_id=p_path and position=p_position;
 if step.session_id is not null then return learning_graph_path_read(p_user,p_path); end if;
 if not exists(select 1 from learning_item_concepts b join concept_learning_state c on c.id=b.concept_id and c.user_id=p_user
 where b.user_id=p_user and b.session_id=p_session and b.concept_id=step.concept_id and not c.source_changed) then raise exception 'LS_NOT_FOUND'; end if;
 update learning_study_path_steps set session_id=p_session where path_id=p_path and position=p_position;
 return learning_graph_path_read(p_user,p_path);
end; $$;

create function public.learning_graph_path_advance(p_user uuid,p_path uuid,p_position integer) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare path learning_study_paths;step learning_study_path_steps;
begin
 select * into path from learning_study_paths where id=p_path and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if path.position>p_position or path.status='completed' then return learning_graph_path_read(p_user,p_path); end if;
 if path.status<>'active' or path.position<>p_position then raise exception 'LS_CONFLICT'; end if;
 select * into step from learning_study_path_steps where path_id=p_path and position=p_position;
 if not exists(select 1 from learning_sessions where id=step.session_id and user_id=p_user and status='completed') or exists(select 1 from learning_session_items where session_id=step.session_id and user_id=p_user and phase<>'done') then raise exception 'LS_CONFLICT'; end if;
 update learning_study_paths set position=position+1,status=case when exists(select 1 from learning_study_path_steps where path_id=p_path and position=p_position+1) then 'active' else 'completed' end where id=p_path;
 return learning_graph_path_read(p_user,p_path);
end; $$;
revoke all on function learning_graph_concept_source(uuid,uuid),learning_graph_path_read(uuid,uuid),learning_graph_path_begin(uuid,uuid,uuid,jsonb),learning_graph_path_attach(uuid,uuid,integer,uuid),learning_graph_path_advance(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function learning_graph_concept_source(uuid,uuid),learning_graph_path_read(uuid,uuid),learning_graph_path_begin(uuid,uuid,uuid,jsonb),learning_graph_path_attach(uuid,uuid,integer,uuid),learning_graph_path_advance(uuid,uuid,integer) to service_role;
commit;
