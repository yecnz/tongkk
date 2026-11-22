begin;
create function public.learning_session_history(p_user uuid,p_limit integer) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc,r.id),'[]'::jsonb) from (
 select s.id,p.material_name,s.status,s.updated_at from learning_sessions s
 join learning_session_packs p on p.id=s.pack_id and p.user_id=p_user
 where s.user_id=p_user and s.status in ('completed','abandoned')
 order by s.updated_at desc,s.id limit greatest(1,least(p_limit,30))) r;
$$;
revoke all on function public.learning_session_history(uuid,integer) from public,anon,authenticated;
grant execute on function public.learning_session_history(uuid,integer) to service_role;
commit;
