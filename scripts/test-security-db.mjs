// Isolated PostgreSQL attack/regression checks. Never reads app credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function denied(sql, args, message) {
  await assert.rejects(db.query(sql, args), /foreign key constraint|row-level security|permission denied/, message);
  checks++;
}
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth to authenticated,anon,service_role;
`);
const migration = readFileSync(new URL('../supabase/migrations/202611260005_reference_ownership.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '');
check(schema.includes(migration), 'Fresh schema mirrors the ownership migration');
await db.exec(schema.replace(migration, ''));
// Supabase grants browser access to these original app tables by default.
await db.exec(`grant select,insert,update,delete on courses,materials,summaries,quiz_sets,quiz_attempts,
wrong_answer_analyses,summary_chat_sessions,summary_chat_messages,dashboard_state,profiles to authenticated;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon;
grant select,insert,update,delete on storage.objects to authenticated;`);
const owner = randomUUID(), victim = randomUUID(), course = randomUUID(), otherCourse = randomUUID();
const ownSummary = randomUUID(), otherSummary = randomUUID(), ownSession = randomUUID(), otherSession = randomUUID();
const ownQuiz = randomUUID(), otherQuiz = randomUUID();
await db.query('insert into auth.users values($1),($2)', [owner, victim]);
await db.query('insert into courses(id,user_id,name) values($1,$2,$3),($4,$5,$6)', [course, owner, 'Own', otherCourse, victim, 'Private']);
await db.query(`insert into materials(course_id,id,user_id,name,type,markdown) values($1,'own-material',$2,'Own','file','own'),($3,'private-material',$4,'Private','file','private')`, [course, owner, otherCourse, victim]);
await db.query(`insert into summaries(id,course_id,user_id,template,content) values($1,$2,$3,'GENERAL','own'),($4,$5,$6,'GENERAL','private')`, [ownSummary, course, owner, otherSummary, otherCourse, victim]);
await db.query(`insert into summary_chat_sessions(id,summary_id,user_id,title) values($1,$2,$3,'own'),($4,$5,$6,'private')`, [ownSession, ownSummary, owner, otherSession, otherSummary, victim]);
await db.query(`insert into quiz_sets(id,course_id,user_id,title,difficulty,question_type,count,questions) values($1,$2,$3,'own','보통','객관식',1,'[]'),($4,$5,$6,'private','보통','객관식',1,'[]')`, [ownQuiz, course, owner, otherQuiz, otherCourse, victim]);
async function login(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec(`set role ${role}`);
}
// Reproduce the actual pre-fix denial of service: user A reserves user B's
// unique analysis slot even though B cannot see A's row through RLS.
await login(owner);
await db.query("insert into wrong_answer_analyses(course_id,user_id,analysis) values($1,$2,'{}')", [otherCourse, owner]);
await login(victim);
check((await db.query('select count(*) from wrong_answer_analyses')).rows[0].count === 0, 'Victim cannot see the injected row');
await assert.rejects(db.query("insert into wrong_answer_analyses(course_id,user_id,analysis) values($1,$2,'{}')", [otherCourse, victim]), /duplicate key/);
checks++;
await db.exec('reset role');
await db.exec('delete from wrong_answer_analyses');
await db.query("insert into materials(course_id,id,user_id,name,type,markdown) values($1,'legacy-mismatch',$2,'Legacy','file','preserve this content')", [otherCourse, owner]);
await db.exec(migration);
check((await db.query("select markdown from materials where id='legacy-mismatch'")).rows[0].markdown === 'preserve this content', 'Migration preserves legacy data instead of deleting ownership mismatches');
// Only this generated test fixture is removed; deployments must audit and repair
// their own legacy mismatches explicitly before validating these constraints.
await db.exec("delete from materials where id='legacy-mismatch'");
const unvalidated = (await db.query(`select c.conname,t.relname as table_name from pg_constraint c
join pg_class t on t.oid=c.conrelid where t.relnamespace='public'::regnamespace and not c.convalidated`)).rows;
check(unvalidated.length === 12, 'Migration defers only legacy ownership validation');
for (const row of unvalidated) await db.exec(`alter table public.${row.table_name} validate constraint ${row.conname}`);
check(true, 'All ownership constraints validate after a clean data audit');
await login(owner);
await denied("insert into materials(course_id,id,user_id,name,type,markdown) values($1,'injected',$2,'x','file','x')", [otherCourse, owner], 'Material cannot reserve another course key');
await denied("insert into summaries(course_id,user_id,template,content) values($1,$2,'GENERAL','x')", [otherCourse, owner], 'Summary requires an owned course');
await denied("insert into quiz_sets(course_id,user_id,title,difficulty,question_type,count,questions) values($1,$2,'x','보통','객관식',1,'[]')", [otherCourse, owner], 'Quiz requires an owned course');
await denied("insert into quiz_attempts(course_id,user_id,difficulty,question_type,count,answers) values($1,$2,'보통','객관식',1,'[]')", [otherCourse, owner], 'Attempt requires an owned course');
await denied("insert into quiz_attempts(course_id,user_id,quiz_set_id,difficulty,question_type,count,answers) values($1,$2,$3,'보통','객관식',1,'[]')", [course, owner, otherQuiz], 'Attempt cannot reference another quiz');
await denied("insert into wrong_answer_analyses(course_id,user_id,analysis) values($1,$2,'{}')", [otherCourse, owner], 'Cannot reserve another owner analysis slot');
await denied("insert into summary_chat_sessions(summary_id,user_id,title) values($1,$2,'x')", [otherSummary, owner], 'Chat requires an owned summary');
await denied("insert into summary_chat_sessions(summary_id,course_id,user_id,title) values($1,$2,$3,'x')", [ownSummary, otherCourse, owner], 'Chat cannot refer to another course');
await denied("insert into summary_chat_sessions(material_id,user_id,title) values('private-material',$1,'x')", [owner], 'Legacy material chat cannot bypass ownership using a null course');
await denied("insert into summary_chat_messages(summary_id,user_id,role,content) values($1,$2,'user','x')", [otherSummary, owner], 'Message requires an owned summary');
await denied("insert into summary_chat_messages(session_id,user_id,role,content) values($1,$2,'user','x')", [otherSession, owner], 'Message requires an owned session');
await denied('update summaries set course_id=$1 where id=$2', [otherCourse, ownSummary], 'Updates cannot bypass parent ownership');
await denied('update summary_chat_sessions set summary_id=$1 where id=$2', [otherSummary, ownSession], 'Chat retargeting cannot bypass ownership');
await denied("insert into courses(user_id,name) values($1,'impersonated')", [victim], 'RLS rejects a forged row owner');
for (const table of ['courses','materials','summaries','quiz_sets','summary_chat_sessions']) {
  check((await db.query(`select count(*) from ${table} where user_id=$1`, [victim])).rows[0].count === 0, `${table} does not disclose other rows`);
  check((await db.query(`delete from ${table} where user_id=$1 returning *`, [victim])).rows.length === 0, `${table} cannot delete another user`);
}
await db.query("insert into wrong_answer_analyses(course_id,user_id,analysis) values($1,$2,'{}')", [course, owner]);
await db.query("insert into summary_chat_sessions(material_id,user_id,title) values('own-material',$1,'legacy')", [owner]);
await db.query("insert into summary_chat_messages(session_id,user_id,role,content) values($1,$2,'user','safe')", [ownSession, owner]);
const attempt = randomUUID();
await db.query("insert into quiz_attempts(id,course_id,user_id,quiz_set_id,difficulty,question_type,count,answers) values($1,$2,$3,$4,'보통','객관식',1,'[]')", [attempt, course, owner, ownQuiz]);
await db.query('delete from quiz_sets where id=$1', [ownQuiz]);
const preserved = (await db.query('select quiz_set_id,course_id,user_id from quiz_attempts where id=$1', [attempt])).rows[0];
check(preserved.quiz_set_id === null && preserved.course_id === course && preserved.user_id === owner, 'Deleting a quiz preserves attempt owner and history');
await login(victim);
await db.query("insert into wrong_answer_analyses(course_id,user_id,analysis) values($1,$2,'{}')", [otherCourse, victim]);
check(true, 'Victim can save their analysis after rejected injection');
await login(owner);
await db.query("insert into storage.objects(bucket_id,name) values('course-materials',$1)", [owner + '/private.pdf']);
await denied("insert into storage.objects(bucket_id,name) values('course-materials',$1)", [victim + '/injected.pdf'], 'Storage upload cannot impersonate another owner');
await login(victim);
check((await db.query("select * from storage.objects where bucket_id='course-materials'")).rows.length === 0, 'Private storage objects are not visible across users');
await db.exec('reset role');
const callable = (await db.query(`select proname from pg_proc where pronamespace='public'::regnamespace
and prorettype<>'trigger'::regtype and has_function_privilege('authenticated',oid,'EXECUTE') order by proname`)).rows.map(r => r.proname);
assert.deepEqual(callable, ['study_flashcard_create','study_flashcard_rate']); checks++;
check((await db.query(`select proname from pg_proc where pronamespace='public'::regnamespace and prorettype<>'trigger'::regtype
and has_function_privilege('anon',oid,'EXECUTE')`)).rows.length === 0, 'Anonymous role cannot execute app RPCs');
check((await db.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`)).rows.length === 0, 'Every public app table enables RLS');
await db.close();
console.log(`Security PostgreSQL regression: ${checks} checks passed (pre-fix exploit, migration, tenant isolation, RPC grants, storage).`);
