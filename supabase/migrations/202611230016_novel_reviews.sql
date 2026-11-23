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
