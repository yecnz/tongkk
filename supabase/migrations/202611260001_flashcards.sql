-- Flashcards use self-assessed recall; they do not change assessed concept mastery.
create table public.study_flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  material_id text,
  front text not null check (length(trim(front)) between 1 and 2000),
  back text not null check (length(trim(back)) between 1 and 8000),
  source_page integer check (source_page between 1 and 100000),
  origin_key text not null check (length(origin_key) between 1 and 300),
  due_at timestamptz not null default now(),
  interval_days double precision not null default 0 check (interval_days between 0 and 365),
  ease double precision not null default 2.5 check (ease between 1.3 and 3),
  reviews integer not null default 0,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  unique(user_id, origin_key),
  foreign key(course_id, material_id, user_id) references public.materials(course_id,id,user_id) on delete cascade
);
create index study_flashcards_due on public.study_flashcards(user_id,due_at);
alter table public.study_flashcards enable row level security;
create policy flashcards_read on public.study_flashcards for select to authenticated using(user_id=auth.uid());
create policy flashcards_delete on public.study_flashcards for delete to authenticated using(user_id=auth.uid());
revoke all on public.study_flashcards from public,anon,authenticated;
grant select,delete on public.study_flashcards to authenticated;
grant all on public.study_flashcards to service_role;

create table public.study_flashcard_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  card_id uuid not null references public.study_flashcards(id) on delete cascade,
  rating text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table public.study_flashcard_reviews enable row level security;
revoke all on public.study_flashcard_reviews from public,anon,authenticated;
grant all on public.study_flashcard_reviews to service_role;

create function public.study_flashcard_create(p_course uuid,p_material text,p_front text,p_back text,p_page integer,p_origin text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare owner uuid:=auth.uid(); card study_flashcards;
begin
  if owner is null then raise exception 'FLASHCARD_AUTH'; end if;
  if not exists(select 1 from courses where id=p_course and user_id=owner) then raise exception 'FLASHCARD_SOURCE'; end if;
  if p_material is not null and not exists(select 1 from materials where course_id=p_course and id=p_material and user_id=owner) then raise exception 'FLASHCARD_SOURCE'; end if;
  insert into study_flashcards(user_id,course_id,material_id,front,back,source_page,origin_key)
  values(owner,p_course,p_material,trim(p_front),trim(p_back),p_page,p_origin)
  on conflict(user_id,origin_key) do nothing returning * into card;
  if card.id is null then select * into card from study_flashcards where user_id=owner and origin_key=p_origin; end if;
  return to_jsonb(card);
end $$;

create function public.study_flashcard_rate(p_card uuid,p_rating text,p_revision integer,p_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare owner uuid:=auth.uid(); card study_flashcards; previous study_flashcard_reviews; days double precision; factor double precision;
begin
  if owner is null then raise exception 'FLASHCARD_AUTH'; end if;
  if p_key is null or p_revision is null or p_rating is null or p_rating not in ('again','hard','good','easy') then raise exception 'FLASHCARD_INVALID'; end if;
  -- A per-request lock also serializes retries sent for different cards by mistake.
  perform pg_advisory_xact_lock(hashtextextended(owner::text||p_key::text,0));
  select * into previous from study_flashcard_reviews where user_id=owner and request_id=p_key;
  if found then
    if previous.card_id<>p_card or previous.rating<>p_rating then raise exception 'FLASHCARD_CONFLICT'; end if;
    return previous.result;
  end if;
  select * into card from study_flashcards where id=p_card and user_id=owner for update;
  if not found then raise exception 'FLASHCARD_NOT_FOUND'; end if;
  if card.revision<>p_revision then raise exception 'FLASHCARD_CONFLICT'; end if;
  factor:=greatest(1.3,least(3,card.ease+case p_rating when 'again' then -0.2 when 'hard' then -0.15 when 'easy' then 0.15 else 0 end));
  days:=case p_rating
    when 'again' then 0.006944444444444444 -- ten minutes
    when 'hard' then greatest(1,card.interval_days*1.2)
    when 'good' then case when card.interval_days<1 then 1 else card.interval_days*factor end
    when 'easy' then case when card.interval_days<1 then 4 else card.interval_days*factor*1.3 end end;
  days:=least(365,days);
  update study_flashcards set interval_days=days,ease=factor,due_at=now()+days*interval '1 day',reviews=reviews+1,revision=revision+1
    where id=card.id returning * into card;
  insert into study_flashcard_reviews(user_id,request_id,card_id,rating,result) values(owner,p_key,card.id,p_rating,to_jsonb(card));
  return to_jsonb(card);
end $$;
revoke all on function public.study_flashcard_create(uuid,text,text,text,integer,text),public.study_flashcard_rate(uuid,text,integer,uuid) from public,anon;
grant execute on function public.study_flashcard_create(uuid,text,text,text,integer,text),public.study_flashcard_rate(uuid,text,integer,uuid) to authenticated;
