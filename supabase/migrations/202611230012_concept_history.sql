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
