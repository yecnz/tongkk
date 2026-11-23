begin;
alter table external_connections add column sync_enabled boolean not null default false;
alter table external_connections add column sync_interval_minutes integer not null default 30 check(sync_interval_minutes between 15 and 1440);
alter table external_connections add column next_sync_at timestamptz;
alter table external_connections add column consecutive_failures integer not null default 0;
create function public.integration_sync_preferences(p_user uuid,p_revision integer,p_enabled boolean,p_minutes integer) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status<>'connected' then raise exception 'LS_NOT_FOUND'; end if;
 if c.revision<>p_revision or p_minutes not between 15 and 1440 then raise exception 'LS_CONFLICT'; end if;
 update external_connections set sync_enabled=p_enabled,sync_interval_minutes=p_minutes,next_sync_at=case when p_enabled then now() end,
 revision=revision+1 where id=c.id returning * into c;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 return to_jsonb(c);
end; $$;
create function public.integration_schedule_next() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if new.status='disconnected' then new.sync_enabled:=false;new.next_sync_at:=null;
 elsif new.last_synced_at is distinct from old.last_synced_at then
 new.consecutive_failures:=0;
 if new.sync_enabled then new.next_sync_at:=now()+make_interval(mins=>new.sync_interval_minutes); end if;
 elsif new.last_error is not null and (new.last_error is distinct from old.last_error or new.last_synced_at is not distinct from old.last_synced_at) then
 new.consecutive_failures:=least(old.consecutive_failures+1,8);
 if new.sync_enabled then new.next_sync_at:=now()+make_interval(mins=>least(1440,new.sync_interval_minutes*(2^new.consecutive_failures)::integer)); end if;
 end if;return new;
end; $$;
create trigger integration_schedule before update of status,last_synced_at,last_error on external_connections for each row execute function integration_schedule_next();
create function public.workflow_schedule() returns integer
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;r review_cards;n integer:=0;
begin
 if not pg_try_advisory_xact_lock(230017) then return 0; end if;
 for c in select * from external_connections where provider='google_calendar' and status='connected' and sync_enabled and coalesce(next_sync_at,now())<=now() order by next_sync_at nulls first for update skip locked limit 20 loop
 begin
 perform integration_queue(c.user_id);
 update external_connections set next_sync_at=now()+make_interval(mins=>sync_interval_minutes) where id=c.id;
 n:=n+1;
 exception when raise_exception then update external_connections set next_sync_at=now()+interval '1 hour' where id=c.id;
 end;
 end loop;
 for r in select k.* from review_cards k join learning_preferences p on p.user_id=k.user_id and p.auto_review
 join concept_learning_state s on s.id=k.concept_id and s.user_id=k.user_id
 where not k.paused and k.due_at<=now() and not s.source_changed
 and (select count(*) from review_questions q where q.user_id=k.user_id and q.created_at>=current_date)<30
 and not exists(select 1 from review_questions q where q.card_id=k.id and q.round_key=k.due_at)
 order by k.due_at limit 20 loop
 begin perform review_question_queue(r.user_id,r.id,false); n:=n+1; exception when raise_exception then null; end;
 end loop;
 return n;
end; $$;
create function public.calendar_job_expired() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if new.kind='calendar_sync' and new.status='failed' and old.status='running' and new.error_code='WORKER_EXPIRED' then
 update external_connections set last_error='WORKER_EXPIRED' where id=new.connection_id and user_id=new.user_id and revision=new.connection_revision and status='connected'; end if; return new;
end; $$;
create trigger calendar_job_expiry after update of status on background_jobs for each row execute function calendar_job_expired();
revoke all on function integration_sync_preferences(uuid,integer,boolean,integer),integration_schedule_next(),workflow_schedule(),calendar_job_expired() from public,anon,authenticated;
grant execute on function integration_sync_preferences(uuid,integer,boolean,integer),integration_schedule_next(),workflow_schedule(),calendar_job_expired() to service_role;
commit;
