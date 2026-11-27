-- 답하다 만 학습 세션이 남아 있다는 이유만으로 모든 화면의 AI 튜터가 막히던 문제.
-- 이제 문제 풀이 화면이 열려 있을 때(AssessmentLock 하트비트)만 막는다.
create or replace function public.learning_assessment_active(p_user uuid) returns boolean
language sql stable security invoker set search_path=public,pg_catalog as $$
 select exists(select 1 from learning_assessment_locks where user_id=p_user and active and expires_at>now()); $$;
