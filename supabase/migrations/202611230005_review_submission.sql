begin;
alter table review_attempts add column check_selected integer;
alter table review_attempts add column check_result jsonb;
alter table review_attempts add column eligible_for_schedule boolean not null default false;
create function public.review_start(p_user uuid,p_card uuid,p_id uuid,p_answer text,p_assisted boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare fresh boolean;r jsonb;c review_cards;
begin
 select * into c from review_cards where id=p_card and user_id=p_user for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 fresh:=not exists(select 1 from review_attempts where id=p_id);
 if fresh and exists(select 1 from review_attempts where user_id=p_user and card_id=p_card and status='graded' and check_selected is null) then raise exception 'LS_BUSY'; end if;
 r:=review_claim(p_user,p_card,p_id,p_answer,p_assisted);
 if fresh then update review_attempts set eligible_for_schedule=(c.due_at<=created_at) where id=p_id returning to_jsonb(review_attempts.*) into r; end if;
 return r||jsonb_build_object('claimed',fresh);
end;
$$;
create function public.review_check(p_user uuid,p_card uuid,p_id uuid,p_selected integer,p_interval integer,p_success boolean) returns jsonb
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
 q:=ctx->'concept'->'check';
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
revoke all on function review_start(uuid,uuid,uuid,text,boolean),review_check(uuid,uuid,uuid,integer,integer,boolean) from public,anon,authenticated;
grant execute on function review_start(uuid,uuid,uuid,text,boolean),review_check(uuid,uuid,uuid,integer,integer,boolean) to service_role;
commit;
