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
