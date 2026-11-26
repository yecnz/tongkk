import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth to authenticated,anon,service_role;`);
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '');
await db.exec(schema);
const migration = readFileSync(new URL('../supabase/migrations/202611260001_flashcards.sql', import.meta.url), 'utf8');
if (!schema.includes(migration)) await db.exec(migration);
const owner = randomUUID(), other = randomUUID(), course = randomUUID(), otherCourse = randomUUID();
await db.query('insert into auth.users values($1),($2)', [owner, other]);
await db.query('insert into courses(id,user_id,name) values($1,$2,$3),($4,$5,$6)', [course, owner, '자료구조', otherCourse, other, '비공개']);
await db.query('insert into materials(course_id,id,user_id,name,type,markdown) values($1,$2,$3,$4,$5,$6)', [course, 'lecture:1', owner, '강의', 'file', '자료']);
async function login(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec(`set role ${role}`);
}
async function create(courseId = course, material = 'lecture:1', origin = 'same-card') {
  return (await db.query('select study_flashcard_create($1,$2,$3,$4,$5,$6) as data', [courseId, material, '스택이란?', '후입선출 구조', 1, origin])).rows[0].data;
}
async function rate(card, rating, key = randomUUID()) {
  return (await db.query('select study_flashcard_rate($1,$2,$3,$4) as data', [card.id, rating, card.revision, key])).rows[0].data;
}
await login(owner);
const card = await create();
assert.equal((await create()).id, card.id, 'Duplicate save keeps one card');
await assert.rejects(create(otherCourse, null), /FLASHCARD_SOURCE/);
await assert.rejects(create(course, 'missing'), /FLASHCARD_SOURCE/);
await assert.rejects(db.query('update study_flashcards set ease=3 where id=$1', [card.id]), /permission denied/);
const key = randomUUID();
const first = await rate(card, 'good', key);
assert.equal(first.interval_days, 1);
assert.equal(first.reviews, 1);
assert.equal((await rate(card, 'good', key)).revision, first.revision, 'Lost response retry cannot advance schedule twice');
await assert.rejects(rate(card, 'hard', key), /FLASHCARD_CONFLICT/);
await assert.rejects(rate(card, 'easy'), /FLASHCARD_CONFLICT/);
const easy = await rate(first, 'easy');
assert.ok(easy.interval_days > first.interval_days);
const again = await rate(easy, 'again');
assert.ok(again.interval_days < 0.01 && again.ease < easy.ease);
let repeated = again;
for (let i = 0; i < 12; i++) repeated = await rate(repeated, 'easy');
assert.ok(repeated.interval_days <= 365 && repeated.ease <= 3);
await login(other);
assert.equal((await db.query('select count(*) from study_flashcards')).rows[0].count, 0);
await assert.rejects(rate(repeated, 'good'), /FLASHCARD_NOT_FOUND/);
await db.query('delete from study_flashcards where id=$1', [card.id]);
await login(owner);
assert.equal((await db.query('select count(*) from study_flashcards')).rows[0].count, 1);
await login('', 'anon');
await assert.rejects(create(), /permission denied/);
await db.exec('reset role');
await db.query('delete from materials where course_id=$1', [course]);
assert.equal((await db.query('select count(*) from study_flashcards')).rows[0].count, 0);
assert.equal((await db.query('select count(*) from study_flashcard_reviews')).rows[0].count, 0);
await db.close();
console.log('Flashcard database checks passed: ownership, RLS, idempotency, conflicts, adaptive intervals, source deletion.');
