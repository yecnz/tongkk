begin;
create table public.review_cards (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 concept_id uuid not null,source_session_id uuid not null,source_item_id uuid not null,
 due_at timestamptz not null default now()+interval '1 day',successful_reviews integer not null default 0 check(successful_reviews>=0),
 interval_days integer not null default 1 check(interval_days between 1 and 365),last_reviewed_at timestamptz,
 created_at timestamptz not null default now(),unique(user_id,concept_id),unique(id,user_id),
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade,
 foreign key(source_item_id,source_session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade
);
create index review_cards_due on review_cards(user_id,due_at,id);
create table public.review_attempts (
 id uuid primary key,user_id uuid not null,card_id uuid not null,answer text not null check(length(answer) between 1 and 4000),
 assisted boolean not null default false,status text not null check(status in ('pending','graded','ungraded')),
 feedback jsonb,metrics jsonb not null default '{}',error_code text,
 lease_expires_at timestamptz not null default now()+interval '90 seconds',created_at timestamptz not null default now(),
 completed_at timestamptz,foreign key(card_id,user_id) references review_cards(id,user_id) on delete cascade
);
create index review_attempts_card on review_attempts(user_id,card_id,created_at desc);
alter table review_cards enable row level security;
alter table review_attempts enable row level security;
revoke all on review_cards,review_attempts from public,anon,authenticated;
grant all on review_cards,review_attempts to service_role;

create function public.review_seed(p_user uuid,p_session uuid,p_item uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare l record;r review_cards;
begin
 select x.*,s.status,i.data into l from learning_item_concepts x join learning_sessions s on s.id=x.session_id and s.user_id=p_user
 join learning_session_items i on i.id=x.item_id and i.user_id=p_user
 where x.user_id=p_user and x.session_id=p_session and x.item_id=p_item;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if l.status<>'completed' or l.data ? 'report' then raise exception 'LS_CONFLICT'; end if;
 insert into review_cards(user_id,concept_id,source_session_id,source_item_id) values(p_user,l.concept_id,p_session,p_item)
 on conflict(user_id,concept_id) do update set concept_id=excluded.concept_id returning * into r;
 return to_jsonb(r);
end;
$$;
create function public.review_list(p_user uuid,p_due_only boolean,p_limit integer) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at,r.id),'[]'::jsonb) from (
 select c.id,c.concept_id,c.due_at,c.successful_reviews,c.interval_days,k.title,k.course_id,k.material_id,
 k.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed
 from review_cards c join learning_concepts k on k.id=c.concept_id and k.user_id=p_user
 join materials m on m.course_id=k.course_id and m.id=k.material_id and m.user_id=p_user
 where c.user_id=p_user and (not p_due_only or c.due_at<=now()) order by c.due_at,c.id limit greatest(1,least(p_limit,100))) r;
$$;
create function public.review_context(p_user uuid,p_card uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('card',to_jsonb(c),'concept',p.content->'concepts'->i.position,
 'pack',to_jsonb(p),'baseline',i.data,'source_changed',p.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex'),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id) from
 (select * from review_attempts a where a.user_id=p_user and a.card_id=p_card order by created_at desc,id limit 10) a),'[]'::jsonb))
 from review_cards c join learning_session_items i on i.id=c.source_item_id and i.user_id=p_user
 join learning_sessions s on s.id=c.source_session_id and s.user_id=p_user
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 join materials m on m.course_id=p.course_id and m.id=p.material_id and m.user_id=p_user
 where c.id=p_card and c.user_id=p_user;
$$;
create function public.review_claim(p_user uuid,p_card uuid,p_id uuid,p_answer text,p_assisted boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c review_cards;a review_attempts;ctx jsonb;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 ctx:=review_context(p_user,p_card);
 if (ctx->>'source_changed')::boolean then raise exception 'LS_SOURCE_CHANGED'; end if;
 select * into a from review_attempts where id=p_id;
 if found then
 if a.user_id<>p_user or a.card_id<>p_card or a.answer<>p_answer or a.assisted<>p_assisted then raise exception 'LS_CONFLICT'; end if;
 return to_jsonb(a); end if;
 update review_attempts set status='ungraded',error_code='EXPIRED',completed_at=now()
 where user_id=p_user and card_id=p_card and status='pending' and lease_expires_at<=now();
 if exists(select 1 from review_attempts where user_id=p_user and card_id=p_card and status='pending') then raise exception 'LS_BUSY'; end if;
 insert into review_attempts(id,user_id,card_id,answer,assisted,status) values(p_id,p_user,p_card,p_answer,p_assisted,'pending') returning * into a;
 return to_jsonb(a);
end;
$$;
create function public.review_finish(p_user uuid,p_card uuid,p_id uuid,p_feedback jsonb,p_metrics jsonb,p_error text,p_interval integer,p_success boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a review_attempts;ctx jsonb;
begin
 perform 1 from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into a from review_attempts where id=p_id and user_id=p_user and card_id=p_card for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if a.status<>'pending' then return to_jsonb(a); end if;
 ctx:=review_context(p_user,p_card);
 if a.lease_expires_at<=now() or (ctx->>'source_changed')::boolean then p_error:='EXPIRED_OR_CHANGED'; end if;
 update review_attempts set status=case when p_error is null then 'graded' else 'ungraded' end,
 feedback=case when p_error is null then p_feedback else null end,metrics=p_metrics,error_code=p_error,completed_at=now()
 where id=p_id returning * into a;
 if p_error is null and p_interval is not null then
 if p_interval<1 or p_interval>365 then raise exception 'LS_CONFLICT'; end if;
 update review_cards set due_at=now()+make_interval(days=>p_interval),interval_days=p_interval,last_reviewed_at=now(),
 successful_reviews=case when p_success then successful_reviews+1 else 0 end where id=p_card;
 end if;
 return to_jsonb(a);
end;
$$;
revoke all on function review_seed(uuid,uuid,uuid),review_list(uuid,boolean,integer),review_context(uuid,uuid),
 review_claim(uuid,uuid,uuid,text,boolean),review_finish(uuid,uuid,uuid,jsonb,jsonb,text,integer,boolean) from public,anon,authenticated;
grant execute on function review_seed(uuid,uuid,uuid),review_list(uuid,boolean,integer),review_context(uuid,uuid),
 review_claim(uuid,uuid,uuid,text,boolean),review_finish(uuid,uuid,uuid,jsonb,jsonb,text,integer,boolean) to service_role;
commit;
