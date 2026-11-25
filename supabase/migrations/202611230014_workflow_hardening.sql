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
