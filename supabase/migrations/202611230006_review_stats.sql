begin;
create function public.review_stats(p_user uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 with cards as (
 select c.*,k.source_hash<>encode(sha256(convert_to(m.markdown,'UTF8')),'hex') as source_changed
 from review_cards c join learning_concepts k on k.id=c.concept_id and k.user_id=p_user
 join materials m on m.course_id=k.course_id and m.id=k.material_id and m.user_id=p_user where c.user_id=p_user
 ), retained as (
 select a.* from review_attempts a join cards c on c.id=a.card_id where a.user_id=p_user
 and not c.source_changed and a.status='graded' and a.eligible_for_schedule and not a.assisted and a.check_result is not null
 and jsonb_array_length(coalesce(a.feedback->'criteria','[]'))>0
 and not exists(select 1 from jsonb_array_elements(a.feedback->'criteria') r where r->>'status'='uncertain')
 )
 select jsonb_build_object(
 'completed_sessions',(select count(*) from learning_sessions where user_id=p_user and status='completed'),
 'initial_checks',(select count(*) from learning_session_attempts where user_id=p_user and kind='check' and status='graded'),
 'initial_correct',(select count(*) from learning_session_attempts where user_id=p_user and kind='check' and status='graded' and (result->>'correct')::boolean),
 'due_cards',(select count(*) from cards where not source_changed and due_at<=now()),
 'changed_cards',(select count(*) from cards where source_changed),
 'retention_checks',(select count(*) from retained),
 'retention_correct',(select count(*) from retained where (check_result->>'correct')::boolean and not exists(
 select 1 from jsonb_array_elements(feedback->'criteria') r where r->>'status'<>'met'))
 );
$$;
revoke all on function review_stats(uuid) from public,anon,authenticated;
grant execute on function review_stats(uuid) to service_role;
commit;
