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
