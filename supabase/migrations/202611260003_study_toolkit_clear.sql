begin;
create or replace function public.learning_workflow_clear(p_user uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
 delete from study_paths where user_id=p_user;
 delete from study_flashcards where user_id=p_user;
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
revoke all on function public.learning_workflow_clear(uuid) from public,anon,authenticated;
grant execute on function public.learning_workflow_clear(uuid) to service_role;
commit;
