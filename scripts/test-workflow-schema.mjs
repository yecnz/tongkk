// Full fresh-install SQL against isolated PostgreSQL. No project URL or credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth to service_role,authenticated,anon;
`);
// PGlite already provides the built-in UUID/SHA256 functions used here; its optional
// pgcrypto extension is unavailable. Supabase supplies pgcrypto in deployment.
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '');
await db.exec(schema);
check(true, 'Full fresh schema applies with Auth/Storage infrastructure stubs');
const user = randomUUID(), other = randomUUID(), course = randomUUID();
const text = '프로세스는 실행 중인 프로그램이다.';
const hash = createHash('sha256').update(text).digest('hex');
await db.query('insert into auth.users values($1),($2)', [user, other]);
await db.query('insert into courses(id,user_id,name) values($1,$2,$3)', [course, user, '운영체제']);
await db.query('insert into materials(course_id,id,user_id,name,type,markdown) values($1,$2,$3,$4,$5,$6)', [course, 'lecture:100', user, '강의', 'file', text]);
await db.exec('set role service_role');
const config = { pages: '', material_name: '강의', summary_identity: { request_key: 'same-summary-identity', generation_config: {} },
  pack: { preparation_key: 'fresh-pack', source_units: [{ id: 'u0', text }], selected_scope: { type: 'units', unit_ids: ['u0'] }, content_version: 'test' } };
async function prepare(kind, key, result) {
  const value = (await db.query('select preparation_create($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::text[]) as data', [user, randomUUID(), course, 'lecture:100', hash, key, text, JSON.stringify(config), [kind]])).rows[0].data;
  const job = (await db.query('select workflow_claim() as data')).rows[0].data;
  check(Boolean(job && job.kind === 'preparation'), `${kind} has durable work`);
  await db.query('select workflow_complete($1,$2,$3::jsonb,$4::jsonb,null)', [job.id, job.lease_token, JSON.stringify(result), '{}']);
  return (await db.query('select preparation_apply($1,$2) as data', [user, value.artifacts[0].id])).rows[0].data;
}
const first = await prepare('summary', 'summary-one', { content: '첫 번째 요약' });
const second = await prepare('summary', 'summary-two', { content: '두 번째 요약' });
check(first.applied_id !== second.applied_id, 'Regenerated summaries preserve both generation histories');
check(Number((await db.query('select count(*) from summaries')).rows[0].count) === 2, 'Fresh constraints allow separate generations with the same request identity');
const quiz = await prepare('quiz', 'quiz-one', { questions: Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), version: 1, question: `문제 ${i}`, options: ['A', 'B'], answer: 0, explanation: '근거' })) });
check(Boolean(quiz.applied_id), 'Quiz approval satisfies actual schema constraints');
const pack = await prepare('pack', 'pack-one', { content: { concepts: [{ title: '프로세스' }, { title: '스레드' }] } });
check(Boolean(pack.applied_id), 'Prepared learning packs satisfy actual schema constraints');
await db.query("update learning_session_packs set status='failed' where id=$1", [pack.applied_id]);
const recovered = await prepare('pack', 'pack-recovery', { content: { concepts: [{ title: '복구한 개념' }, { title: '스레드' }] } });
check(recovered.applied_id === pack.applied_id, 'Approving a new draft recovers the same failed cache identity');
check((await db.query('select status,content from learning_session_packs where id=$1', [pack.applied_id])).rows[0].content.concepts[0].title === '복구한 개념', 'Recovered pack uses the approved result');
await db.query("update learning_session_packs set status='preparing' where id=$1", [pack.applied_id]);
await assert.rejects(prepare('pack', 'pack-busy', { content: { concepts: [{ title: '충돌' }, { title: '스레드' }] } }), /LS_BUSY/);
check((await db.query('select content from learning_session_packs where id=$1', [pack.applied_id])).rows[0].content.concepts[0].title === '복구한 개념', 'Approval cannot overwrite a pack generation in progress');
const privateTables = ['background_jobs','learning_evidence','learning_issues','explanation_revisions','preparation_requests','external_connections','integration_oauth_states','external_calendar_events','concept_learning_state'];
for (const name of privateTables) {
  check(!(await db.query("select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed", [name])).rows[0].allowed, `Browser roles cannot inspect ${name}`);
}
const unsafe = await db.query(`select proname from pg_proc where pronamespace='public'::regnamespace
 and proname ~ '^(workflow_|integration_|preparation_|explanation_|learning_issue_|learning_concept_|learning_assessment_|learning_workflow_)'
 and has_function_privilege('authenticated',oid,'EXECUTE')`);
check(unsafe.rows.length === 0, 'Server RPCs are not executable by browser roles');
await db.query('select learning_preferences_set($1,true,$2)', [other, 'UTC']);
await db.query('select learning_workflow_clear($1)', [user]);
check(Number((await db.query('select count(*) from preparation_requests where user_id=$1', [user])).rows[0].count) === 0, 'App reset clears private preparation data');
check((await db.query('select learning_preferences_get($1) as data', [other])).rows[0].data.auto_review, 'App reset preserves another user');
await db.close();
console.log(`Workflow fresh PostgreSQL schema: ${checks} checks passed`);
