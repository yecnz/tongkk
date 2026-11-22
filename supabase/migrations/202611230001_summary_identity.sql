begin;
alter table public.summaries add column if not exists source_hash text;
alter table public.summaries add column if not exists request_key text;
alter table public.summaries add column if not exists generation_config jsonb;
alter table public.summaries add column if not exists generation_id uuid;
alter table public.summaries drop constraint if exists summaries_dedup_key;
alter table public.summaries drop constraint if exists summaries_course_id_template_material_ids_key;
create index if not exists summaries_request_lookup on public.summaries(user_id,course_id,request_key,created_at desc);
create unique index if not exists summaries_generation_key on public.summaries(user_id,generation_id);
-- Legacy rows intentionally keep null identities: the original input cannot be reconstructed safely.
commit;
