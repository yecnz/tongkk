begin;
create table public.external_connections (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null default 'google_calendar' check(provider='google_calendar'),
 status text not null default 'disconnected' check(status in ('connected','reconnect','disconnected')),
 tokens_ciphertext text,revision integer not null default 0,sync_sequence integer not null default 0,
 last_synced_at timestamptz,last_error text,created_at timestamptz not null default now(),unique(user_id,provider),unique(id,user_id)
);
create table public.integration_oauth_states (
 state_hash text primary key,user_id uuid not null,connection_id uuid not null,expected_revision integer not null,
 status text not null default 'pending' check(status in ('pending','consumed','done')),
 code_hash text,expires_at timestamptz not null default now()+interval '10 minutes',created_at timestamptz not null default now(),
 foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade
);
create table public.external_calendar_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,connection_id uuid not null,external_id text not null,
 title text not null,start_value text not null,end_value text not null,all_day boolean not null,
 start_at timestamptz not null,end_at timestamptz not null,unique(connection_id,external_id),unique(id,user_id),
 foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade
);
create index external_events_day on external_calendar_events(user_id,start_at,end_at);
create table public.external_event_courses (
 event_id uuid primary key,user_id uuid not null,course_id uuid not null,
 foreign key(event_id,user_id) references external_calendar_events(id,user_id) on delete cascade,
 foreign key(course_id,user_id) references courses(id,user_id) on delete cascade
);
alter table background_jobs add column connection_id uuid;
alter table background_jobs add column connection_revision integer;
alter table background_jobs add constraint integration_job_owner_fk foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade;
create function public.integration_connection(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select to_jsonb(c) from external_connections c where user_id=p_user and provider='google_calendar'; $$;
create function public.integration_begin(p_user uuid,p_state text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 delete from integration_oauth_states where expires_at<now()-interval '1 day';
 insert into external_connections(user_id) values(p_user) on conflict(user_id,provider) do nothing;
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 insert into integration_oauth_states(state_hash,user_id,connection_id,expected_revision) values(p_state,p_user,c.id,c.revision);
end; $$;
create function public.integration_consume(p_user uuid,p_state text,p_code text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare s integration_oauth_states;
begin
 select * into s from integration_oauth_states where state_hash=p_state and user_id=p_user for update;
 if not found or s.expires_at<=now() then raise exception 'LS_NOT_FOUND'; end if;
 if s.status='done' and s.code_hash=p_code then return to_jsonb(s); end if;
 if s.status<>'pending' then raise exception 'LS_CONFLICT'; end if;
 update integration_oauth_states set status='consumed',code_hash=p_code where state_hash=p_state returning * into s;
 return to_jsonb(s);
end; $$;
create function public.integration_connect(p_user uuid,p_state text,p_cipher text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare s integration_oauth_states;c external_connections;
begin
 select * into s from integration_oauth_states where state_hash=p_state and user_id=p_user and status='consumed' and expires_at>now() for update;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into c from external_connections where id=s.connection_id and user_id=p_user for update;
 if c.revision<>s.expected_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='connected',tokens_ciphertext=p_cipher,revision=revision+1,last_error=null where id=c.id returning * into c;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 update integration_oauth_states set status='done' where state_hash=p_state;
 return to_jsonb(c);
end; $$;
create function public.integration_refresh(p_user uuid,p_id uuid,p_revision integer,p_cipher text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 update external_connections set tokens_ciphertext=p_cipher where id=p_id and user_id=p_user and revision=p_revision and status='connected';
 return found;
end; $$;
create function public.integration_queue(p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;j background_jobs;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status<>'connected' then raise exception 'LS_NOT_FOUND'; end if;
 select * into j from background_jobs where connection_id=c.id and connection_revision=c.revision and status in ('queued','running') order by created_at desc limit 1;
 if found then return to_jsonb(j); end if;
 if (select count(*) from background_jobs where user_id=p_user and kind='calendar_sync' and created_at>now()-interval '1 hour')>=10 then raise exception 'LS_BUSY'; end if;
 update external_connections set sync_sequence=sync_sequence+1 where id=c.id returning * into c;
 insert into background_jobs(user_id,kind,target_id,generation,connection_id,connection_revision)
 values(p_user,'calendar_sync',c.id,c.sync_sequence,c.id,c.revision) returning * into j;
 return to_jsonb(j);
end; $$;
create function public.integration_disconnect(p_user uuid,p_revision integer,p_delete boolean) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status='disconnected' then return true; end if;
 if c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='disconnected',tokens_ciphertext=null,revision=revision+1,last_error=null where id=c.id;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 delete from integration_oauth_states where user_id=p_user;
 if p_delete then delete from external_calendar_events where user_id=p_user and connection_id=c.id; end if;
 return true;
end; $$;
create function public.integration_sync_finish(p_job uuid,p_token uuid,p_events jsonb,p_error text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare j background_jobs;c external_connections;e jsonb;ids text[];
begin
 -- Lock connection before its jobs, as disconnect and reconnect do.
 select x.* into c from external_connections x join background_jobs b on b.connection_id=x.id and b.user_id=x.user_id where b.id=p_job for update of x;
 if not found then return false; end if;
 select * into j from background_jobs where id=p_job for update;
 if j.status<>'running' or j.lease_token<>p_token or j.lease_expires_at<=now() or c.status<>'connected' or c.revision<>j.connection_revision then return false; end if;
 if p_error is null then
 if jsonb_array_length(p_events)>1000 then raise exception 'LS_CONFLICT'; end if;
 select coalesce(array_agg(x->>'external_id'),'{}') into ids from jsonb_array_elements(p_events) x;
 for e in select value from jsonb_array_elements(p_events) loop
 insert into external_calendar_events(user_id,connection_id,external_id,title,start_value,end_value,all_day,start_at,end_at)
 values(c.user_id,c.id,e->>'external_id',e->>'title',e->>'start_value',e->>'end_value',(e->>'all_day')::boolean,(e->>'start_at')::timestamptz,(e->>'end_at')::timestamptz)
 on conflict(connection_id,external_id) do update set title=excluded.title,start_value=excluded.start_value,end_value=excluded.end_value,all_day=excluded.all_day,start_at=excluded.start_at,end_at=excluded.end_at;
 end loop;
 delete from external_calendar_events where connection_id=c.id and user_id=c.user_id and not (external_id=any(ids));
 update external_connections set last_synced_at=now(),last_error=null where id=c.id;
 else
 update external_connections set last_error=p_error,status=case when p_error='RECONNECT_REQUIRED' then 'reconnect' else status end where id=c.id;
 end if;
 update background_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,error_code=p_error where id=j.id;
 return true;
end; $$;
create function public.integration_events(p_user uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.start_at,r.id),'[]'::jsonb) from (
 select e.*,l.course_id from external_calendar_events e left join external_event_courses l on l.event_id=e.id and l.user_id=p_user
 where e.user_id=p_user and e.start_at<p_to and e.end_at>p_from order by e.start_at,e.id limit 500) r; $$;
create function public.integration_event_course(p_user uuid,p_event uuid,p_course uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 perform 1 from external_calendar_events where id=p_event and user_id=p_user for share;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 if p_course is null then delete from external_event_courses where event_id=p_event and user_id=p_user; return true; end if;
 if not exists(select 1 from courses where id=p_course and user_id=p_user) then raise exception 'LS_NOT_FOUND'; end if;
 insert into external_event_courses(event_id,user_id,course_id) values(p_event,p_user,p_course) on conflict(event_id) do update set course_id=excluded.course_id;
 return true;
end; $$;
alter table external_connections enable row level security;
alter table integration_oauth_states enable row level security;
alter table external_calendar_events enable row level security;
alter table external_event_courses enable row level security;
revoke all on external_connections,integration_oauth_states,external_calendar_events,external_event_courses from public,anon,authenticated;
grant all on external_connections,integration_oauth_states,external_calendar_events,external_event_courses to service_role;
revoke all on function integration_connection(uuid),integration_begin(uuid,text),integration_consume(uuid,text,text),integration_connect(uuid,text,text),integration_refresh(uuid,uuid,integer,text),integration_queue(uuid),integration_disconnect(uuid,integer,boolean),integration_sync_finish(uuid,uuid,jsonb,text),integration_events(uuid,timestamptz,timestamptz),integration_event_course(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function integration_connection(uuid),integration_begin(uuid,text),integration_consume(uuid,text,text),integration_connect(uuid,text,text),integration_refresh(uuid,uuid,integer,text),integration_queue(uuid),integration_disconnect(uuid,integer,boolean),integration_sync_finish(uuid,uuid,jsonb,text),integration_events(uuid,timestamptz,timestamptz),integration_event_course(uuid,uuid,uuid) to service_role;
create function public.integration_job_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('status',b.status,'error_code',b.error_code) from background_jobs b join external_connections c on c.id=b.connection_id and c.user_id=p_user
 where b.user_id=p_user and c.revision=b.connection_revision order by b.generation desc limit 1; $$;
create function public.learning_workflow_clear(p_user uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 delete from background_jobs where user_id=p_user;
 delete from external_connections where user_id=p_user;
 delete from preparation_requests where user_id=p_user;
 delete from learning_session_packs where user_id=p_user;
 delete from learning_concepts where user_id=p_user;
 delete from learning_preferences where user_id=p_user;
 delete from learning_assessment_locks where user_id=p_user;
 delete from summary_chat_sessions where user_id=p_user;
 return true;
end; $$;
grant delete on summary_chat_sessions to service_role;
revoke all on function integration_job_status(uuid),learning_workflow_clear(uuid) from public,anon,authenticated;
grant execute on function integration_job_status(uuid),learning_workflow_clear(uuid) to service_role;

commit;
