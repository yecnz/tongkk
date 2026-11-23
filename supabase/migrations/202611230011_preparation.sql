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
