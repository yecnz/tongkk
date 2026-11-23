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
