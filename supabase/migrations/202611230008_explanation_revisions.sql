begin;
create table public.explanation_revisions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,item_id uuid not null,concept_id uuid not null,parent_id uuid,
 answer text not null default '' check(length(answer)<=4000),assisted boolean not null default true,
 revision integer not null default 0,status text not null default 'draft' check(status in ('draft','pending','graded','ungraded')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id),
 foreign key(item_id,session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade,
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(parent_id,user_id) references explanation_revisions(id,user_id) on delete cascade
);
create table public.explanation_evaluations (
 id uuid primary key,user_id uuid not null,revision_id uuid not null,
 attempt_no integer not null, unique(revision_id,attempt_no),
 status text not null default 'pending' check(status in ('pending','graded','ungraded')),
 feedback jsonb,error_code text,metrics jsonb not null default '{}',lease_expires_at timestamptz not null default now()+interval '90 seconds',
 created_at timestamptz not null default now(),foreign key(revision_id,user_id) references explanation_revisions(id,user_id) on delete cascade
);
create function public.explanation_read(p_user uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('revision',to_jsonb(r),'title',p.content->'concepts'->i.position->>'title',
 'question',p.content->'concepts'->i.position->>'question','baseline',a.answer,'baseline_feedback',a.result,
 'source_changed',p.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex'),
 'evaluation',(select to_jsonb(e)||jsonb_build_object('status',case when e.status='pending' and e.lease_expires_at<=now() then 'ungraded' else e.status end) from explanation_evaluations e where e.revision_id=r.id and e.user_id=p_user order by e.attempt_no desc limit 1))
 from explanation_revisions r join learning_session_items i on i.id=r.item_id and i.user_id=p_user
 join learning_sessions s on s.id=r.session_id and s.user_id=p_user
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 join materials m on m.course_id=p.course_id and m.id=p.material_id and m.user_id=p_user
 join learning_session_attempts a on a.item_id=r.item_id and a.user_id=p_user and a.kind='recall'
 where r.id=p_id and r.user_id=p_user; $$;
create function public.explanation_create(p_user uuid,p_id uuid,p_session uuid,p_item uuid,p_parent uuid default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare l learning_item_concepts;r explanation_revisions; initial text;
begin
 select * into r from explanation_revisions where id=p_id;
 if found then
 if r.user_id<>p_user or r.session_id<>p_session or r.item_id<>p_item or r.parent_id is distinct from p_parent then raise exception 'LS_CONFLICT'; end if;
 return explanation_read(p_user,p_id); end if;
 select x.* into l from learning_item_concepts x join learning_sessions s on s.id=x.session_id and s.user_id=p_user
 where x.item_id=p_item and x.session_id=p_session and x.user_id=p_user and s.status='completed';
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select answer#>>'{}' into initial from learning_session_attempts where item_id=p_item and user_id=p_user and kind='recall';
 if initial is null then raise exception 'LS_CONFLICT'; end if;
 if p_parent is not null then
 select answer into initial from explanation_revisions where id=p_parent and user_id=p_user and item_id=p_item and status in ('graded','ungraded');
 if not found then raise exception 'LS_CONFLICT'; end if; end if;
 insert into explanation_revisions(id,user_id,session_id,item_id,concept_id,parent_id,answer) values(p_id,p_user,p_session,p_item,l.concept_id,p_parent,initial);
 return explanation_read(p_user,p_id);
end; $$;
create function public.explanation_save(p_user uuid,p_id uuid,p_expected integer,p_answer text,p_assisted boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 update explanation_revisions set answer=p_answer,assisted=p_assisted,revision=revision+1,updated_at=now()
 where id=p_id and user_id=p_user and revision=p_expected and status='draft';
 if not found then raise exception 'LS_CONFLICT'; end if;
 return explanation_read(p_user,p_id);
end; $$;
create function public.explanation_submit(p_user uuid,p_id uuid,p_expected integer,p_key uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r explanation_revisions;e explanation_evaluations;
begin
 select * into r from explanation_revisions where id=p_id and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into e from explanation_evaluations where id=p_key;
 if found then
 if e.user_id<>p_user or e.revision_id<>p_id then raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(e)||jsonb_build_object('claimed',false); end if;
 if (explanation_read(p_user,p_id)->>'source_changed')::boolean then raise exception 'LS_SOURCE_CHANGED'; end if;
 if r.revision<>p_expected or length(btrim(r.answer))=0 or r.status='graded' then raise exception 'LS_CONFLICT'; end if;
 if exists(select 1 from explanation_evaluations where revision_id=p_id and status='pending' and lease_expires_at>now()) then raise exception 'LS_BUSY'; end if;
 if (select count(*) from explanation_evaluations where user_id=p_user and revision_id=p_id)>=3 then raise exception 'LS_CONFLICT'; end if;
 insert into explanation_evaluations(id,user_id,revision_id,attempt_no) values(p_key,p_user,p_id,(select count(*)+1 from explanation_evaluations where revision_id=p_id)) returning * into e;
 update explanation_revisions set status='pending',updated_at=now() where id=p_id;
 return to_jsonb(e)||jsonb_build_object('claimed',true);
end; $$;
create function public.explanation_finish(p_user uuid,p_id uuid,p_key uuid,p_feedback jsonb,p_metrics jsonb,p_error text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r explanation_revisions;e explanation_evaluations;outcome text;
begin
 select * into r from explanation_revisions where id=p_id and user_id=p_user for update;
 if not found then return; end if;
 select * into e from explanation_evaluations where id=p_key and user_id=p_user and revision_id=p_id for update;
 if not found or e.status<>'pending' then return; end if;
 if exists(select 1 from explanation_evaluations where revision_id=p_id and attempt_no>e.attempt_no) then
 update explanation_evaluations set status='ungraded',error_code='EXPIRED' where id=p_key; return; end if;
 if e.lease_expires_at<=now() or (explanation_read(p_user,p_id)->>'source_changed')::boolean then p_error:='EXPIRED_OR_CHANGED'; end if;
 update explanation_evaluations set status=case when p_error is null then 'graded' else 'ungraded' end,
 feedback=case when p_error is null then p_feedback else null end,metrics=p_metrics,error_code=p_error where id=p_key;
 update explanation_revisions set status=case when p_error is null then 'graded' else 'ungraded' end,updated_at=now() where id=p_id;
 if p_error is null then
 outcome:=case when exists(select 1 from jsonb_array_elements(p_feedback->'criteria') c where c->>'status'='uncertain') then 'uncertain'
 when exists(select 1 from jsonb_array_elements(p_feedback->'criteria') c where c->>'status'<>'met') then 'needs_review' else 'met' end;
 perform learning_record_evidence(p_user,r.concept_id,r.session_id,r.item_id,'revision',r.id,outcome,true,false);
 update learning_issues set status='awaiting_reassessment',revision=revision+1,updated_at=now() where user_id=p_user and concept_id=r.concept_id and status not in ('closed','resolved');
 end if;
end; $$;
alter table explanation_revisions enable row level security;
alter table explanation_evaluations enable row level security;
revoke all on explanation_revisions,explanation_evaluations from public,anon,authenticated;
grant all on explanation_revisions,explanation_evaluations to service_role;
revoke all on function explanation_read(uuid,uuid),explanation_create(uuid,uuid,uuid,uuid,uuid),explanation_save(uuid,uuid,integer,text,boolean),explanation_submit(uuid,uuid,integer,uuid),explanation_finish(uuid,uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function explanation_read(uuid,uuid),explanation_create(uuid,uuid,uuid,uuid,uuid),explanation_save(uuid,uuid,integer,text,boolean),explanation_submit(uuid,uuid,integer,uuid),explanation_finish(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
commit;
