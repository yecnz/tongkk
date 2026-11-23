begin;
alter table external_connections drop constraint external_connections_provider_check;
alter table external_connections add constraint external_connections_provider_check check(provider in ('google_calendar','google_drive','notion'));
alter table external_connections add column refresh_lease uuid;
alter table external_connections add column refresh_expires_at timestamptz;
create table public.external_material_drafts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,connection_id uuid not null,course_id uuid not null,
 external_id text not null,title text not null,source_modified text not null,content_hash text not null,markdown text not null check(length(markdown) between 1 and 300000),
 notices jsonb not null default '[]',status text not null default 'ready' check(status in ('ready','applied','discarded')),material_id text,
 created_at timestamptz not null default now(),unique(connection_id,course_id,external_id,content_hash),
 foreign key(connection_id,user_id) references external_connections(id,user_id) on delete cascade,
 foreign key(course_id,user_id) references courses(id,user_id) on delete cascade
);
alter table external_material_drafts enable row level security;
revoke all on external_material_drafts from public,anon,authenticated;
grant all on external_material_drafts to service_role;
grant insert on materials to service_role;
create function public.source_connection(p_user uuid,p_provider text) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$ select to_jsonb(c) from external_connections c where user_id=p_user and provider=p_provider; $$;
create function public.source_begin(p_user uuid,p_provider text,p_state text) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 if p_provider not in ('google_drive','notion') then raise exception 'LS_CONFLICT'; end if;
 delete from integration_oauth_states where expires_at<now()-interval '1 day';
 insert into external_connections(user_id,provider) values(p_user,p_provider) on conflict(user_id,provider) do nothing;
 select * into c from external_connections where user_id=p_user and provider=p_provider for update;
 insert into integration_oauth_states(state_hash,user_id,connection_id,expected_revision) values(p_state,p_user,c.id,c.revision);
end; $$;
create function public.source_consume(p_user uuid,p_provider text,p_state text,p_code text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 if not exists(select 1 from integration_oauth_states s join external_connections c on c.id=s.connection_id and c.user_id=p_user and c.provider=p_provider where s.state_hash=p_state and s.user_id=p_user) then raise exception 'LS_NOT_FOUND'; end if;
 return integration_consume(p_user,p_state,p_code);
end; $$;
create function public.source_disconnect(p_user uuid,p_provider text,p_revision integer) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider=p_provider for update;
 if not found or c.status='disconnected' then return true; end if;
 if c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='disconnected',tokens_ciphertext=null,revision=revision+1,refresh_lease=null,refresh_expires_at=null where id=c.id;
 delete from integration_oauth_states where connection_id=c.id and user_id=p_user;
 update external_material_drafts set status='discarded' where connection_id=c.id and user_id=p_user and status='ready';
 return true;
end; $$;
create function public.source_refresh_claim(p_user uuid,p_provider text,p_revision integer) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider=p_provider for update;
 if not found or c.status<>'connected' or c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 if c.refresh_expires_at>now() then raise exception 'LS_BUSY'; end if;
 update external_connections set refresh_lease=gen_random_uuid(),refresh_expires_at=now()+interval '60 seconds' where id=c.id returning * into c;
 return to_jsonb(c);
end; $$;
create function public.source_refresh_save(p_user uuid,p_id uuid,p_revision integer,p_lease uuid,p_cipher text) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 update external_connections set tokens_ciphertext=coalesce(p_cipher,tokens_ciphertext),refresh_lease=null,refresh_expires_at=null,
 status=case when p_cipher is null then 'reconnect' else status end
 where id=p_id and user_id=p_user and revision=p_revision and refresh_lease=p_lease and refresh_expires_at>now() and status='connected'; return found;
end; $$;
create function public.source_draft_create(p_user uuid,p_connection uuid,p_revision integer,p_course uuid,p_external text,p_title text,p_modified text,p_markdown text,p_notices jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare d external_material_drafts;
begin
 perform 1 from external_connections where id=p_connection and user_id=p_user and revision=p_revision and status='connected' and provider in ('google_drive','notion') for share;
 if not found then raise exception 'LS_CONFLICT'; end if;
 perform 1 from courses where id=p_course and user_id=p_user for share;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into d from external_material_drafts where user_id=p_user and connection_id=p_connection and course_id=p_course and external_id=p_external and content_hash=encode(sha256(convert_to(p_markdown,'UTF8')),'hex') for update;
 if found then
 update external_material_drafts set source_modified=p_modified,status=case when status='discarded' or status='applied' and not exists(select 1 from materials where course_id=p_course and id=d.material_id and user_id=p_user) then 'ready' else status end where id=d.id returning * into d;
 return to_jsonb(d); end if;
 if (select count(*) from external_material_drafts where user_id=p_user and created_at>=current_date)>=50 then raise exception 'LS_BUSY'; end if;
 insert into external_material_drafts(user_id,connection_id,course_id,external_id,title,source_modified,content_hash,markdown,notices)
 values(p_user,p_connection,p_course,p_external,p_title,p_modified,encode(sha256(convert_to(p_markdown,'UTF8')),'hex'),p_markdown,p_notices)
 on conflict(connection_id,course_id,external_id,content_hash) do update set source_modified=excluded.source_modified
 returning * into d;return to_jsonb(d);
end; $$;
create function public.source_draft_action(p_user uuid,p_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare d external_material_drafts;c external_connections;
begin
 select x.* into c from external_connections x join external_material_drafts a on a.connection_id=x.id and a.user_id=p_user where a.id=p_id and x.user_id=p_user for share of x;
 if not found then raise exception 'LS_NOT_FOUND'; end if;
 select * into d from external_material_drafts where id=p_id and user_id=p_user for update;
 if p_action='discard' and d.status='ready' then update external_material_drafts set status='discarded' where id=d.id returning * into d;return to_jsonb(d); end if;
 if p_action<>'apply' then raise exception 'LS_CONFLICT'; end if;
 if d.status='applied' then return to_jsonb(d); end if;
 if d.status<>'ready' or c.status<>'connected' then raise exception 'LS_CONFLICT'; end if;
 d.material_id:='external:'||d.id::text;
 insert into materials(course_id,id,user_id,name,type,markdown,mime_type)
 values(d.course_id,d.material_id,p_user,d.title,'file',d.markdown,'text/markdown');
 update external_material_drafts set status='applied',material_id=d.material_id where id=d.id returning * into d;
 return to_jsonb(d);
end; $$;
create function public.source_drafts(p_user uuid,p_provider text) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) from (
 select d.* from external_material_drafts d join external_connections c on c.id=d.connection_id and c.user_id=p_user and c.provider=p_provider where d.user_id=p_user order by d.created_at desc limit 50) r; $$;
revoke all on function source_connection(uuid,text),source_begin(uuid,text,text),source_consume(uuid,text,text,text),source_disconnect(uuid,text,integer),source_refresh_claim(uuid,text,integer),source_refresh_save(uuid,uuid,integer,uuid,text),source_draft_create(uuid,uuid,integer,uuid,text,text,text,text,jsonb),source_draft_action(uuid,uuid,text),source_drafts(uuid,text) from public,anon,authenticated;
grant execute on function source_connection(uuid,text),source_begin(uuid,text,text),source_consume(uuid,text,text,text),source_disconnect(uuid,text,integer),source_refresh_claim(uuid,text,integer),source_refresh_save(uuid,uuid,integer,uuid,text),source_draft_create(uuid,uuid,integer,uuid,text,text,text,text,jsonb),source_draft_action(uuid,uuid,text),source_drafts(uuid,text) to service_role;
create or replace function public.integration_disconnect(p_user uuid,p_revision integer,p_delete boolean) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare c external_connections;
begin
 select * into c from external_connections where user_id=p_user and provider='google_calendar' for update;
 if not found or c.status='disconnected' then return true; end if;
 if c.revision<>p_revision then raise exception 'LS_CONFLICT'; end if;
 update external_connections set status='disconnected',tokens_ciphertext=null,revision=revision+1,last_error=null where id=c.id;
 update background_jobs set status='cancelled' where connection_id=c.id and status in ('queued','running');
 delete from integration_oauth_states where user_id=p_user and connection_id=c.id;
 if p_delete then delete from external_calendar_events where user_id=p_user and connection_id=c.id; end if;
 return true;
end; $$;
commit;
