begin;
alter table summary_chat_sessions add column course_id uuid;
alter table summary_chat_sessions add column source_hash text;
alter table summary_chat_sessions add constraint mate_material_owner_fk foreign key(course_id,material_id,user_id) references materials(course_id,id,user_id) on delete cascade;
create index mate_chat_scope on summary_chat_sessions(user_id,course_id,material_id,source_hash,updated_at desc);
create table public.learning_assessment_locks (
 user_id uuid not null references auth.users(id) on delete cascade,token uuid not null,
 expires_at timestamptz not null,sequence integer not null,active boolean not null,updated_at timestamptz not null default now(),primary key(user_id,token)
);
create function public.learning_assessment_lock(p_user uuid,p_token uuid,p_active boolean,p_sequence integer) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 delete from learning_assessment_locks where updated_at<now()-interval '1 day';
 insert into learning_assessment_locks(user_id,token,expires_at,sequence,active)
 values(p_user,p_token,now()+interval '90 seconds',p_sequence,p_active)
 on conflict(user_id,token) do update set expires_at=excluded.expires_at,sequence=excluded.sequence,active=excluded.active,updated_at=now()
 where learning_assessment_locks.sequence<excluded.sequence;
 return true;
end; $$;
create function public.learning_assessment_active(p_user uuid) returns boolean
language sql stable security invoker set search_path=public,pg_catalog as $$
 select exists(select 1 from learning_sessions s join learning_session_items i on i.id=s.current_item_id and i.user_id=p_user
 where s.user_id=p_user and s.status='active' and i.phase in ('recall_answering','recall_evaluating','check_answering'))
 or exists(select 1 from learning_assessment_locks where user_id=p_user and active and expires_at>now()); $$;
alter table learning_assessment_locks enable row level security;
revoke all on learning_assessment_locks from public,anon,authenticated;
grant all on learning_assessment_locks to service_role;
revoke all on function learning_assessment_lock(uuid,uuid,boolean,integer),learning_assessment_active(uuid) from public,anon,authenticated;
grant execute on function learning_assessment_lock(uuid,uuid,boolean,integer),learning_assessment_active(uuid) to service_role;
commit;
