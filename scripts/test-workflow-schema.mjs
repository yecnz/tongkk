// Full fresh-install SQL against isolated PostgreSQL. No project URL or credentials.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>/^20261123001[5-8]_/.test(name))) check(schema.includes(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')),`Fresh schema mirrors ${file}`);
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
 and proname ~ '^(workflow_|integration_|preparation_|explanation_|learning_issue_|learning_concept_|learning_assessment_|learning_workflow_|learning_graph_|source_|review_question_)'
 and has_function_privilege('authenticated',oid,'EXECUTE')`);
check(unsafe.rows.length === 0, 'Server RPCs are not executable by browser roles');
await db.query('select learning_preferences_set($1,true,$2)', [other, 'UTC']);
await db.exec('begin');
await db.query('select learning_workflow_clear($1)', [user]);
check(Number((await db.query('select count(*) from preparation_requests where user_id=$1', [user])).rows[0].count) === 0, 'App reset clears private preparation data');
check((await db.query('select learning_preferences_get($1) as data', [other])).rows[0].data.auto_review, 'App reset preserves another user');
await db.exec('rollback');
// Concept relations preserve raw source evidence and reject cycles across aliases.
const conceptIds = [];
for (let i=0;i<3;i++) {
  const id=randomUUID();conceptIds.push(id);
  await db.query('insert into learning_concepts(id,user_id,course_id,material_id,source_hash,concept_key,title,source_refs) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,user,course,'lecture:100',hash,'graph-'+i,'개념 '+i,'[]']);
}
const [a,b,c]=conceptIds;
await db.query("select learning_graph_link($1,$2,$3,$4,'equivalent')",[user,randomUUID(),a,b]);
await db.query("select learning_graph_link($1,$2,$3,$4,'prerequisite')",[user,randomUUID(),b,c]);
await assert.rejects(db.query("select learning_graph_link($1,$2,$3,$4,'prerequisite')",[user,randomUUID(),c,a]),/LS_GRAPH_CYCLE/);check(true,'Cycles through equivalent concepts are rejected');
await assert.rejects(db.query("select learning_graph_link($1,$2,$3,$4,'equivalent')",[user,randomUUID(),a,c]),/LS_GRAPH_CYCLE/);check(true,'Merging a prerequisite with its dependent is rejected');
await assert.rejects(db.query("select learning_graph_link($1,$2,$3,$4,'equivalent')",[other,randomUUID(),a,b]),/LS_NOT_FOUND/);check(true,'Graph links cannot reference another owner');
check((await db.query('select learning_graph_read($1) as data',[user])).rows[0].data.nodes.length===3,'Graph exposes every source node');
// Seed a completed learning item using the real ownership constraints.
const session=randomUUID(),item=randomUUID();
await db.query("insert into learning_sessions(id,user_id,course_id,pack_id,status,familiarity,target_minutes,revision,version,calls) values($1,$2,$3,$4,'completed','attended',15,0,0,0)",[session,user,course,pack.applied_id]);
await db.query("update learning_session_packs set status='ready' where id=$1",[pack.applied_id]);
await db.query("insert into learning_session_items(id,user_id,session_id,position,phase,data,revision) values($1,$2,$3,0,'done','{}',0)",[item,user,session]);
const card=(await db.query('select review_seed($1,$2,$3) as data',[user,session,item])).rows[0].data;
await db.query("update review_cards set due_at=now()-interval '1 day' where id=$1",[card.id]);
const question=(await db.query('select review_question_queue($1,$2,false) as data',[user,card.id])).rows[0].data;
check((await db.query('select review_question_queue($1,$2,false) as data',[user,card.id])).rows[0].data.id===question.id,'Question generation is deduplicated per scheduled round');
const questionJob=(await db.query('select workflow_claim() as data')).rows[0].data;
const content={title:'복습',question:'새로운 사례를 설명하세요',check:{question:'새 확인 문제',options:['오답','정답'],answer_index:1,explanation:'새 근거'}};
check(!(await db.query('select review_question_finish($1,$2,$3::jsonb,null) as ok',[questionJob.id,randomUUID(),JSON.stringify(content)])).rows[0].ok,'Wrong worker lease cannot publish a question');
await db.query('select review_question_finish($1,$2,$3::jsonb,null)',[questionJob.id,questionJob.lease_token,JSON.stringify(content)]);
const attempt=randomUUID();
await db.query("select review_start_variant($1,$2,$3,'설명',false,$4)",[user,card.id,attempt,question.id]);
await db.query('select review_finish($1,$2,$3,$4::jsonb,$5::jsonb,null,null,false)',[user,card.id,attempt,JSON.stringify({criteria:[{status:'met'}]}),'{}']);
const checked=(await db.query('select review_check($1,$2,$3,1,3,true) as data',[user,card.id,attempt])).rows[0].data;
check(checked.check_result.correct&&checked.check_result.answer_index===1,'Review grading uses the generated question rather than the original');
check((await db.query("select independent from learning_evidence where source_kind='review' and source_id=$1",[attempt])).rows[0].independent,'Delayed novel review is stored as independent evidence');
await assert.rejects(db.query("select review_start_variant($1,$2,$3,'설명',false,null)",[user,card.id,attempt]),/LS_CONFLICT/);check(true,'Lost submit retries cannot switch question identity');
// Timer scheduling is opt-in, idempotent, and respects disconnects.
await db.query('select integration_begin($1,$2)',[user,'calendar-state']);
await db.query('select integration_consume($1,$2,$3)',[user,'calendar-state','code']);
const conn=(await db.query('select integration_connect($1,$2,$3) as data',[user,'calendar-state','encrypted'])).rows[0].data;
await db.query('select workflow_schedule()');
check(Number((await db.query("select count(*) from background_jobs where kind='calendar_sync'")).rows[0].count)===0,'Calendar polling is disabled by default');
const enabled=(await db.query('select integration_sync_preferences($1,$2,true,15) as data',[user,conn.revision])).rows[0].data;
await db.query('select workflow_schedule()');await db.query('select workflow_schedule()');
check(Number((await db.query("select count(*) from background_jobs where kind='calendar_sync'")).rows[0].count)===1,'Repeated scheduler ticks enqueue only one sync');
let syncJob=null;
for(let i=0;i<5;i++){const job=(await db.query('select workflow_claim() as data')).rows[0].data;if(job?.kind==='calendar_sync'){syncJob=job;break;}}
check(Boolean(syncJob),'The persistent worker claims a scheduled calendar sync');
await db.query('select integration_sync_finish($1,$2,null,$3)',[syncJob.id,syncJob.lease_token,'PROVIDER_BUSY']);
const failedSync=(await db.query('select integration_connection($1) as data',[user])).rows[0].data;
check(failedSync.consecutive_failures===1&&new Date(failedSync.next_sync_at).getTime()>Date.now()+29*60*1000,'Failed recurring syncs back off instead of polling continuously');
await db.query('select integration_queue($1)',[user]);
const retrySync=(await db.query('select workflow_claim() as data')).rows[0].data;
await db.query('select integration_sync_finish($1,$2,$3::jsonb,null)',[retrySync.id,retrySync.lease_token,'[]']);
check((await db.query('select integration_connection($1) as data',[user])).rows[0].data.consecutive_failures===0,'A successful sync resets the backoff');
await db.query('select source_begin($1,$2,$3)',[user,'notion','pending-notion']);
await db.query('select integration_disconnect($1,$2,true)',[user,enabled.revision]);
check(Number((await db.query("select count(*) from integration_oauth_states where state_hash='pending-notion'")).rows[0].count)===1,'Calendar disconnect preserves another provider OAuth flow');
check(!(await db.query('select integration_connection($1) as data',[user])).rows[0].data.sync_enabled,'Disconnect disables recurring synchronization');
// Source OAuth is bound to a provider; imports are versioned and applied once.
await db.query('select source_begin($1,$2,$3)',[user,'notion','notion-state']);
await assert.rejects(db.query('select source_consume($1,$2,$3,$4)',[user,'google_drive','notion-state','code']),/LS_NOT_FOUND/);check(true,'OAuth states cannot cross provider boundaries');
await db.query('select source_consume($1,$2,$3,$4)',[user,'notion','notion-state','code']);
const source=(await db.query('select integration_connect($1,$2,$3) as data',[user,'notion-state','encrypted-notion'])).rows[0].data;
async function sourceDraft(markdown){return (await db.query('select source_draft_create($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) as data',[user,source.id,source.revision,course,'page-1','외부 강의','2026-11-23',markdown,'[]'])).rows[0].data;}
const draft=await sourceDraft('외부 원문');
const applied=(await db.query("select source_draft_action($1,$2,'apply') as data",[user,draft.id])).rows[0].data;
check((await db.query("select source_draft_action($1,$2,'apply') as data",[user,draft.id])).rows[0].data.material_id===applied.material_id,'Import approval is idempotent');
check((await sourceDraft('외부 원문')).id===draft.id,'Unchanged external content reuses its version');
const discarded=await sourceDraft('검토하다 폐기한 원문');
await db.query("select source_draft_action($1,$2,'discard')",[user,discarded.id]);
check((await sourceDraft('검토하다 폐기한 원문')).status==='ready','Explicitly importing a discarded snapshot opens it for review again');
const nextDraft=await sourceDraft('바뀐 외부 원문');
await db.query("select source_draft_action($1,$2,'apply')",[user,nextDraft.id]);
check(Number((await db.query("select count(*) from materials where id like 'external:%'")).rows[0].count)===2,'Updated external content creates a new material without overwriting history');
const lease=(await db.query('select source_refresh_claim($1,$2,$3) as data',[user,'notion',source.revision])).rows[0].data;
await assert.rejects(db.query('select source_refresh_claim($1,$2,$3)',[user,'notion',source.revision]),/LS_BUSY/);check(true,'Rotating tokens have one refresh owner');
await db.query('select source_disconnect($1,$2,$3)',[user,'notion',source.revision]);
check(!(await db.query('select source_refresh_save($1,$2,$3,$4,$5) as ok',[user,source.id,source.revision,lease.refresh_lease,'late-token'])).rows[0].ok,'A late token refresh cannot reconnect a disconnected service');
for(const name of ['learning_concept_links','review_questions','external_material_drafts']) {
 check(!(await db.query("select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed",[name])).rows[0].allowed,`Browser roles cannot inspect ${name}`);
}
await db.query('select learning_workflow_clear($1)',[user]);
check(Number((await db.query('select count(*) from learning_concept_links')).rows[0].count)===0,'Reset removes graph relations');
check(Number((await db.query('select count(*) from external_material_drafts')).rows[0].count)===0,'Reset removes source imports');
await db.close();
console.log(`Workflow fresh PostgreSQL schema: ${checks} checks passed`);
