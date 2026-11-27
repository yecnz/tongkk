-- RLS validates the row owner; references must belong to that same owner too.
-- NOT VALID preserves legacy rows while enforcing every new/changed reference.
-- Audit and repair legacy ownership mismatches before VALIDATE CONSTRAINT;
-- this migration deliberately never deletes or reassigns existing user data.
begin;

create unique index if not exists summaries_id_owner_key on public.summaries(id,user_id);
create unique index if not exists summary_chat_sessions_id_owner_key on public.summary_chat_sessions(id,user_id);
create unique index if not exists quiz_sets_id_course_owner_key on public.quiz_sets(id,course_id,user_id);
create unique index if not exists study_flashcards_id_owner_key on public.study_flashcards(id,user_id);

alter table public.materials add constraint materials_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.summaries add constraint summaries_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.quiz_sets add constraint quiz_sets_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.quiz_attempts add constraint quiz_attempts_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.quiz_attempts add constraint quiz_attempts_set_owner_fk
  foreign key(quiz_set_id,course_id,user_id) references public.quiz_sets(id,course_id,user_id)
  on delete set null (quiz_set_id) not valid;
alter table public.wrong_answer_analyses add constraint wrong_answer_analyses_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.summary_chat_sessions add constraint summary_chat_sessions_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.summary_chat_sessions add constraint summary_chat_sessions_summary_owner_fk
  foreign key(summary_id,user_id) references public.summaries(id,user_id) on delete cascade not valid;
alter table public.summary_chat_messages add constraint summary_chat_messages_summary_owner_fk
  foreign key(summary_id,user_id) references public.summaries(id,user_id) on delete cascade not valid;
alter table public.summary_chat_messages add constraint summary_chat_messages_session_owner_fk
  foreign key(session_id,user_id) references public.summary_chat_sessions(id,user_id) on delete cascade not valid;
alter table public.study_flashcards add constraint study_flashcards_course_owner_fk
  foreign key(course_id,user_id) references public.courses(id,user_id) on delete cascade not valid;
alter table public.study_flashcard_reviews add constraint study_flashcard_reviews_card_owner_fk
  foreign key(card_id,user_id) references public.study_flashcards(id,user_id) on delete cascade not valid;

-- Older material chats omit course_id, so their composite FK intentionally does
-- not run. Check their material owner without breaking that supported format.
create policy summary_chat_material_owner_guard on public.summary_chat_sessions
  as restrictive for all to authenticated
  using (true)
  with check (material_id is null or exists (
    select 1 from public.materials m
    where m.id=summary_chat_sessions.material_id and m.user_id=auth.uid()
      and (summary_chat_sessions.course_id is null or m.course_id=summary_chat_sessions.course_id)
  ));

commit;
