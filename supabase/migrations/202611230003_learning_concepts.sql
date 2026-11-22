begin;
create table public.learning_concepts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 course_id uuid not null,material_id text not null,source_hash text not null,concept_key text not null,
 title text not null,source_refs jsonb not null,created_at timestamptz not null default now(),
 unique(user_id,concept_key),unique(id,user_id),
 foreign key(course_id,user_id) references courses(id,user_id) on delete cascade,
 foreign key(course_id,material_id,user_id) references materials(course_id,id,user_id) on delete cascade
);
create table public.learning_item_concepts (
 item_id uuid primary key,session_id uuid not null,user_id uuid not null,concept_id uuid not null,
 foreign key(item_id,session_id,user_id) references learning_session_items(id,session_id,user_id) on delete cascade,
 foreign key(concept_id,user_id) references learning_concepts(id,user_id) on delete cascade
);
create index learning_item_concepts_concept on public.learning_item_concepts(user_id,concept_id);
alter table public.learning_concepts enable row level security;
alter table public.learning_item_concepts enable row level security;
revoke all on public.learning_concepts,public.learning_item_concepts from public,anon,authenticated;
grant all on public.learning_concepts,public.learning_item_concepts to service_role;

create function public.bind_learning_concept(p_item uuid) returns void
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare r record;c jsonb;k text;cid uuid;refs jsonb;
begin
 select i.*,p.course_id,p.material_id,p.source_hash,p.content into r from learning_session_items i
 join learning_sessions s on s.id=i.session_id and s.user_id=i.user_id
 join learning_session_packs p on p.id=s.pack_id and p.user_id=i.user_id where i.id=p_item;
 if not found then return; end if;
 c:=r.content->'concepts'->r.position;
 if c is null then return; end if;
 select coalesce(jsonb_agg(x->>'unit_id' order by x->>'unit_id'),'[]'::jsonb) into refs
 from jsonb_array_elements(coalesce(c->'source_refs','[]'::jsonb)) x;
 k:=encode(sha256(convert_to(jsonb_build_array(r.course_id,r.material_id,r.source_hash,
 btrim(regexp_replace(c->>'title','\s+',' ','g')),refs)::text,'UTF8')),'hex');
 insert into learning_concepts(user_id,course_id,material_id,source_hash,concept_key,title,source_refs)
 values(r.user_id,r.course_id,r.material_id,r.source_hash,k,c->>'title',coalesce(c->'source_refs','[]'))
 on conflict(user_id,concept_key) do update set title=excluded.title returning id into cid;
 insert into learning_item_concepts(item_id,session_id,user_id,concept_id) values(r.id,r.session_id,r.user_id,cid)
 on conflict(item_id) do nothing;
end;
$$;
create function public.learning_concept_on_item() returns trigger
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin perform bind_learning_concept(new.id); return new; end;
$$;
create trigger learning_concept_bind after insert on learning_session_items
for each row execute function public.learning_concept_on_item();
select public.bind_learning_concept(id) from public.learning_session_items;

create function public.learning_session_concepts(p_user uuid,p_session uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'source_hash',c.source_hash,
 'item_id',l.item_id,'material_id',c.material_id) order by i.position),'[]'::jsonb)
 from learning_item_concepts l join learning_concepts c on c.id=l.concept_id and c.user_id=p_user
 join learning_session_items i on i.id=l.item_id and i.user_id=p_user
 where l.user_id=p_user and l.session_id=p_session;
$$;
revoke all on function public.bind_learning_concept(uuid),public.learning_concept_on_item(),public.learning_session_concepts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_learning_concept(uuid),public.learning_concept_on_item(),public.learning_session_concepts(uuid,uuid) to service_role;
commit;
