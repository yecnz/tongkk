// Real PostgreSQL (WASM), isolated in memory. Never connects to the project database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
async function rejects(action, pattern) { await assert.rejects(action, pattern); checks += 1; }
const user = randomUUID(), other = randomUUID(), course = randomUUID();
const text = '분산 학습은 시간을 두고 반복하는 학습이다.';
const hash = createHash('sha256').update(text).digest('hex');
const migration = readFileSync(new URL('../supabase/migrations/202611220001_learning_sessions.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
check(schema.includes(migration), 'Fresh schema and migration must agree');

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create table public.courses(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
  create table public.materials(course_id uuid references courses(id) on delete cascade,id text,
    user_id uuid references auth.users(id) on delete cascade,markdown text, primary key(course_id,id));
  grant usage on schema public,auth to service_role,anon,authenticated;
  grant select, update on courses,materials to service_role;
`);
await db.query('insert into auth.users values ($1),($2)', [user, other]);
await db.query('insert into courses values ($1,$2)', [course, user]);
await db.query('insert into materials values ($1,$2,$3,$4)', [course, 'lecture:100', user, text]);
await db.exec('create table quiz_attempts(id uuid primary key,user_id uuid,course_id uuid,answers jsonb)');
await db.exec(migration);
await db.exec(readFileSync(new URL('../supabase/migrations/202611230002_learning_history.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230003_learning_concepts.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230004_review_cards.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230005_review_submission.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230006_review_stats.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230007_learning_issues.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230008_explanation_revisions.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611230009_learning_worker.sql', import.meta.url), 'utf8'));
await db.exec('create table summary_chat_sessions(id uuid primary key,user_id uuid,material_id text,updated_at timestamptz)');
await db.exec(readFileSync(new URL('../supabase/migrations/202611230010_learning_mate.sql', import.meta.url), 'utf8'));
await db.exec(`create table summaries(id uuid primary key,user_id uuid,course_id uuid,template text,content text,material_ids text[],page_range text,source_hash text,request_key text,generation_config jsonb,generation_id uuid,created_at timestamptz default now());
create table quiz_sets(id uuid primary key,user_id uuid,course_id uuid,title text,difficulty text,question_type text,count integer,material_ids text[],questions jsonb,created_at timestamptz default now());`);
await db.exec(readFileSync(new URL('../supabase/migrations/202611230011_preparation.sql', import.meta.url), 'utf8'));
await db.exec('set role service_role');

function bundle() {
  const packId = randomUUID(), sessionId = randomUUID(), itemId = randomUUID();
  return {
    pack: { id: packId, user_id: user, course_id: course, material_id: 'lecture:100', material_name: '자료',
      preparation_key: randomUUID(), source_hash: hash, selected_scope: { type: 'all' }, source_snapshot: text,
      source_units: [{ id: 'u0', text, start: 0, end: text.length }], concept_count: 1,
      content_version: 'test-v1', content: { concepts: [{ title: '비공개 정답', question: '설명하세요', check: { question: '문제', options: ['정답','오답'], answer_index: 0, explanation: '근거' } }] }, status: 'ready' },
    session: { id: sessionId, user_id: user, course_id: course, pack_id: packId, status: 'active', familiarity: 'attended',
      target_minutes: 15, current_item_id: itemId, revision: 0, version: 0, calls: 0, repeated: false,
      result: [], created_at: new Date().toISOString(), completed_at: null },
    items: [{ id: itemId, position: 0, phase: 'recall_answering', revision: 0, data: { draft: '', help: {} } }],
    attempts: [], operations: [{ id: randomUUID(), command_key: randomUUID(), input_hash: 'hash', kind: 'create',
      status: 'succeeded', data: {}, lease_token: null, lease_expires_at: null, attempt_no: 1, error_code: null,
      metrics: {}, created_at: new Date().toISOString() }],
  };
}
async function write(value, version, owner = user) {
  const result = await db.query('select learning_session_write($1::uuid,$2::jsonb,$3::int) as bundle', [owner, JSON.stringify(value), version]);
  return result.rows[0].bundle;
}
const original = bundle();
let stored = await write(original, -1);
check(stored.items.length === 1 && stored.session.version === 0, 'Atomic create and circular current-item FK');
check(stored.pack.content.concepts[0].title === '비공개 정답', 'Server can read private content');
const conceptRows = (await db.query('select learning_session_concepts($1,$2) as data',[user,stored.session.id])).rows[0].data;
check(conceptRows.length === 1, 'Every generated item is bound to a durable concept');
check((await db.query('select learning_session_concepts($1,$2) as data',[other,stored.session.id])).rows[0].data.length === 0,'Concept links are owner scoped');
await db.exec('begin');
await db.query("update learning_sessions set status='completed' where id=$1",[stored.session.id]);
const repeatedConcept = await write(bundle(), -1);
const repeatedId = (await db.query('select learning_session_concepts($1,$2) as data',[user,repeatedConcept.session.id])).rows[0].data[0].id;
check(repeatedId === conceptRows[0].id, 'Same concept in another session retains its identity');
const reviewCard=(await db.query('select review_seed($1,$2,$3) as data',[user,stored.session.id,stored.items[0].id])).rows[0].data;
const duplicateCard=(await db.query('select review_seed($1,$2,$3) as data',[user,stored.session.id,stored.items[0].id])).rows[0].data;
check(reviewCard.id === duplicateCard.id,'Seeding review cards is idempotent');
check((await db.query('select review_list($1,false,30) as data',[other])).rows[0].data.length===0,'Other owner cannot list review cards');
await db.query("update review_cards set due_at=now()-interval '1 day' where id=$1",[reviewCard.id]);
const attemptId=randomUUID();
const claim=(await db.query('select review_start($1,$2,$3,$4,false) as data',[user,reviewCard.id,attemptId,'답변'])).rows[0].data;
check(claim.claimed===true,'First request reserves one evaluation');
check((await db.query('select review_start($1,$2,$3,$4,false) as data',[user,reviewCard.id,attemptId,'답변'])).rows[0].data.claimed===false,'Duplicate request does not reserve another AI call');
await db.exec('savepoint busy_review');
await rejects(()=>db.query('select review_start($1,$2,$3,$4,false)',[user,reviewCard.id,randomUUID(),'동시 답변']),/LS_BUSY/);
await db.exec('rollback to savepoint busy_review');
const feedback=JSON.stringify({criteria:[{status:'met'}]});
await db.query('select review_finish($1,$2,$3,$4::jsonb,$5::jsonb,null,null,false)',[user,reviewCard.id,attemptId,feedback,'{}']);
await db.query('select review_check($1,$2,$3,0,3,true)',[user,reviewCard.id,attemptId]);
await db.query('select review_check($1,$2,$3,0,3,true)',[user,reviewCard.id,attemptId]);
let reviewed=(await db.query('select review_context($1,$2) as data',[user,reviewCard.id])).rows[0].data;
check(reviewed.card.successful_reviews===1,'Repeated completion does not advance a schedule twice');
const earlyId=randomUUID();
await db.query('select review_start($1,$2,$3,$4,false)',[user,reviewCard.id,earlyId,'이른 연습']);
await db.query('select review_finish($1,$2,$3,$4::jsonb,$5::jsonb,null,null,false)',[user,reviewCard.id,earlyId,feedback,'{}']);
await db.query('select review_check($1,$2,$3,0,7,true)',[user,reviewCard.id,earlyId]);
reviewed=(await db.query('select review_context($1,$2) as data',[user,reviewCard.id])).rows[0].data;
check(reviewed.card.successful_reviews===1,'Early practice cannot inflate retained performance');
const stats=(await db.query('select review_stats($1) as data',[user])).rows[0].data;
check(stats.retention_checks===1 && stats.retention_correct===1,'Only delayed independent completed checks count as retention');
check(stats.completed_sessions===1 && stats.due_cards===0,'Completed learning and due review counts are separate');
check((await db.query('select review_stats($1) as data',[other])).rows[0].data.retention_checks===0,'Statistics are owner scoped');
check((await db.query('select review_context($1,$2) as data',[other,reviewCard.id])).rows[0].data===null,'Review detail is owner scoped');
const changedText = text + '수정';
await db.query('update materials set markdown=$1 where course_id=$2 and id=$3',[changedText,course,'lecture:100']);
const changedConcept = bundle(); changedConcept.pack.source_hash=createHash('sha256').update(changedText).digest('hex');
const changedVersion=await write(changedConcept,-1);
const changedId=(await db.query('select learning_session_concepts($1,$2) as data',[user,changedVersion.session.id])).rows[0].data[0].id;
check(changedId !== conceptRows[0].id,'Changed source versions do not merge concept histories');
await db.exec('rollback');
const changedPack = structuredClone(stored);
changedPack.pack.content.concepts[0].title = '바뀐 기준';
await rejects(() => write(changedPack, 0), /LS_CONFLICT/);
const none = await db.query('select learning_session_read($1,$2) as result', [other, stored.session.id]);
check(none.rows[0].result === null, 'Other owner cannot read through server RPC');
await rejects(() => write(stored, 0, other), /LS_NOT_FOUND/);

stored.items[0].data.draft = '내 설명';
stored.items[0].revision += 1;
const stale = structuredClone(stored);
stored = await write(stored, 0);
check(stored.session.version === 1 && stored.session.revision === 0, 'Storage version separate from command revision');
await rejects(() => write(stale, 0), /LS_CONFLICT/);

stored.attempts.push({ id: randomUUID(), item_id: stored.items[0].id, kind: 'recall', answer: '고정 답안',
  status: 'pending', result: null, method: 'ai', assistance: {}, created_at: new Date().toISOString() });
stored = await write(stored, 1);
const changedAnswer = structuredClone(stored);
changedAnswer.attempts[0].answer = '바뀐 답안';
await rejects(() => write(changedAnswer, 2), /LS_CONFLICT/);
const duplicateAnswer = structuredClone(stored);
duplicateAnswer.attempts.push({ ...stored.attempts[0], id: randomUUID() });
await rejects(() => write(duplicateAnswer, 2), /duplicate key/);

// Evidence is captured atomically by the existing attempt write transaction.
await db.query("update learning_session_attempts set status='graded', result=$1::jsonb where id=$2", [JSON.stringify({criteria:[{status:'missing'}]}),stored.attempts[0].id]);
let issues=(await db.query('select learning_issue_list($1,30,0) as data',[user])).rows[0].data;
check(issues.total===1,'A missing criterion creates one concept issue');
await db.query("update learning_session_attempts set status=status where id=$1",[stored.attempts[0].id]);
check(Number((await db.query('select count(*) from learning_evidence')).rows[0].count)===1,'Repeated save cannot duplicate evidence');
check((await db.query('select learning_issue_list($1,30,0) as data',[other])).rows[0].data.total===0,'Issue lists are owner scoped');
const issue=issues.issues[0], issueKey=randomUUID();
await db.query('select learning_issue_action($1,$2,$3,$4,$5)',[user,issue.id,issue.revision,issueKey,'start']);
await db.query('select learning_issue_action($1,$2,$3,$4,$5)',[user,issue.id,issue.revision,issueKey,'start']);
check((await db.query('select learning_issue_detail($1,$2) as data',[user,issue.id])).rows[0].data.issue.revision===1,'Action replay changes status only once');
await rejects(()=>db.query('select learning_issue_action($1,$2,$3,$4,$5)',[user,issue.id,0,randomUUID(),'close']),/LS_CONFLICT/);
check((await db.query('select learning_issue_detail($1,$2) as data',[other,issue.id])).rows[0].data===null,'Issue detail hides other owner data');

const quizAttemptId=randomUUID();
await db.exec('reset role');
await db.query('insert into quiz_attempts values($1,$2,$3,$4::jsonb)',[quizAttemptId,user,course,JSON.stringify([{studentAnswer:'내 답',isCorrect:false}])]);
await db.exec('set role service_role');
const linked=(await db.query('select learning_issue_from_quiz($1,$2,0,$3) as data',[user,quizAttemptId,conceptRows[0].id])).rows[0].data;
check(linked.evidence.some(e=>e.source_kind==='quiz' && e.outcome==='uncertain' && e.answer==='내 답'),'Legacy quiz mapping preserves uncertain evidence and student answer');
await rejects(()=>db.query('select learning_issue_from_quiz($1,$2,0,$3)',[other,quizAttemptId,conceptRows[0].id]),/LS_NOT_FOUND/);
await db.exec('begin');
await db.query("update learning_sessions set status='completed' where id=$1",[stored.session.id]);
const revisionId=randomUUID(), evaluationKey=randomUUID();
const revision=(await db.query('select explanation_create($1,$2,$3,$4,null) as data',[user,revisionId,stored.session.id,stored.items[0].id])).rows[0].data;
check(revision.baseline==='고정 답안','Explanation revisions preserve the original submission');
await db.query('select explanation_create($1,$2,$3,$4,null)',[user,revisionId,stored.session.id,stored.items[0].id]);
check((await db.query('select explanation_read($1,$2) as data',[other,revisionId])).rows[0].data===null,'Revision reads are owner scoped');
await db.query('select explanation_save($1,$2,0,$3,true)',[user,revisionId,'수정한 설명']);
const reserved=(await db.query('select explanation_submit($1,$2,1,$3) as data',[user,revisionId,evaluationKey])).rows[0].data;
check(reserved.claimed===true,'First revision submission reserves an evaluation');
check((await db.query('select explanation_submit($1,$2,1,$3) as data',[user,revisionId,evaluationKey])).rows[0].data.claimed===false,'Evaluation replay does not duplicate calls');
await db.query('select explanation_finish($1,$2,$3,$4::jsonb,$5::jsonb,null)',[user,revisionId,evaluationKey,JSON.stringify({criteria:[{status:'met'}]}),'{}']);
const evaluated=(await db.query('select explanation_read($1,$2) as data',[user,revisionId])).rows[0].data;
check(evaluated.revision.status==='graded' && evaluated.baseline==='고정 답안','Revision evaluation never overwrites the baseline');
await db.exec('savepoint immutable_revision');
await rejects(()=>db.query('select explanation_save($1,$2,1,$3,true)',[user,revisionId,'몰래 수정']),/LS_CONFLICT/);
await db.exec('rollback to savepoint immutable_revision');
await db.exec('rollback');
await db.exec('begin');
await db.exec('delete from background_jobs');
const queuedJob=randomUUID();
await db.query("insert into background_jobs(id,user_id,kind,target_id) values($1,$2,'calendar_sync',$3)",[queuedJob,user,randomUUID()]);
const firstClaim=(await db.query('select workflow_claim() as data')).rows[0].data;
check(firstClaim.id===queuedJob && firstClaim.attempts===1,'Worker claims durable jobs with a lease');
check((await db.query('select workflow_claim() as data')).rows[0].data===null,'Unexpired work is not claimed twice');
check((await db.query('select workflow_complete($1,$2,null,null,null) as done',[queuedJob,randomUUID()])).rows[0].done===false,'Wrong lease cannot commit results');
await db.query("update background_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[queuedJob]);
const reclaimed=(await db.query('select workflow_claim() as data')).rows[0].data;
check(reclaimed.attempts===2 && reclaimed.lease_token!==firstClaim.lease_token,'Worker restart reclaims expired work with a new lease');
check((await db.query('select workflow_complete($1,$2,null,null,null) as done',[queuedJob,firstClaim.lease_token])).rows[0].done===false,'Late worker cannot overwrite a reclaimed job');
await db.query("update background_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[queuedJob]);
await db.query('select workflow_claim()');
check((await db.query('select status from background_jobs where id=$1',[queuedJob])).rows[0].status==='failed','Exhausted work fails visibly');
await db.query('select learning_preferences_set($1,true,$2)',[user,'Asia/Seoul']);
await db.query("update learning_sessions set status='completed' where id=$1",[stored.session.id]);
const autoCards=(await db.query('select review_list($1,false,30) as data',[user])).rows[0].data;
check(autoCards.length===1,'Opt-in completion automatically seeds one review card');
const autoCard=autoCards[0], scheduleKey=randomUUID();
await db.query('select workflow_review_action($1,$2,0,$3,$4,1)',[user,autoCard.id,scheduleKey,'pause']);
await db.query('select workflow_review_action($1,$2,0,$3,$4,1)',[user,autoCard.id,scheduleKey,'pause']);
check((await db.query('select revision from review_cards where id=$1',[autoCard.id])).rows[0].revision===1,'Schedule command replay changes state once');
await db.exec('savepoint paused_attempt');
await rejects(()=>db.query('select review_start($1,$2,$3,$4,false)',[user,autoCard.id,randomUUID(),'답변']),/LS_CONFLICT/);
await db.exec('rollback to savepoint paused_attempt');
await db.exec('rollback');
await db.exec('begin');
await db.query("update learning_sessions set status='paused' where user_id=$1",[user]);
const lockToken=randomUUID();
await db.query('select learning_assessment_lock($1,$2,true,1)',[user,lockToken]);
check((await db.query('select learning_assessment_active($1) as active',[user])).rows[0].active===true,'Assessment locks block tutor access');
await db.query('select learning_assessment_lock($1,$2,false,3)',[user,lockToken]);
await db.query('select learning_assessment_lock($1,$2,true,2)',[user,lockToken]);
check((await db.query('select learning_assessment_active($1) as active',[user])).rows[0].active===false,'Late lock renewal cannot resurrect an ended assessment');
check((await db.query('select learning_assessment_active($1) as active',[other])).rows[0].active===false,'Assessment locks are scoped to the owner');
await db.exec('rollback');
await db.exec('begin');
await db.exec('delete from background_jobs');
const preparationId=randomUUID();
const prepConfig={pages:'',material_name:'자료',summary_identity:{request_key:'summary-key',generation_config:{}}};
const prep=(await db.query('select preparation_create($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::text[]) as data',[user,preparationId,course,'lecture:100',hash,'prepare-key',text,JSON.stringify(prepConfig),['summary']])).rows[0].data;
check(prep.artifacts.length===1,'Preparation creates durable artifact work');
const prepAgain=(await db.query('select preparation_create($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::text[]) as data',[user,randomUUID(),course,'lecture:100',hash,'prepare-key',text,JSON.stringify(prepConfig),['summary']])).rows[0].data;
check(prepAgain.request.id===preparationId,'Same preparation conditions reuse the request');
const prepJob=(await db.query('select workflow_claim() as data')).rows[0].data;
await db.query('select workflow_complete($1,$2,$3::jsonb,$4::jsonb,null)',[prepJob.id,prepJob.lease_token,JSON.stringify({content:'생성한 요약'}),'{}']);
const applied=(await db.query('select preparation_apply($1,$2) as data',[user,prep.artifacts[0].id])).rows[0].data;
check(applied.status==='applied' && applied.applied_id,'Verified preparation can be applied');
check((await db.query('select preparation_apply($1,$2) as data',[user,prep.artifacts[0].id])).rows[0].data.applied_id===applied.applied_id,'Duplicate approval preserves one result');
check(Number((await db.query('select count(*) from summaries')).rows[0].count)===1,'Approval creates one summary without overwrites');
check((await db.query('select preparation_read($1,$2) as data',[other,preparationId])).rows[0].data===null,'Other owner cannot read preparation drafts');
await db.exec('rollback');
const duplicateSession = bundle();
duplicateSession.pack = structuredClone(stored.pack);
duplicateSession.session.pack_id = stored.pack.id;
await rejects(() => write(duplicateSession, -1), /duplicate key/);

const wrongSource = bundle();
wrongSource.pack.source_hash = '0'.repeat(64);
await rejects(() => write(wrongSource, -1), /LS_SOURCE_CHANGED/);
const wrongParent = bundle();
wrongParent.items[0].id = stored.items[0].id;
wrongParent.session.current_item_id = stored.items[0].id;
await rejects(() => write(wrongParent, -1), /LS_NOT_FOUND/);

stored.operations.push({ ...stored.operations[0], id: randomUUID(), command_key: randomUUID(), kind: 'evaluate',
  status: 'running', lease_token: randomUUID(), lease_expires_at: new Date(Date.now() + 90000).toISOString() });
stored.session.calls += 1;
stored = await write(stored, 2);
const simultaneous = bundle();
simultaneous.operations[0] = { ...simultaneous.operations[0], kind: 'prepare', status: 'running', lease_token: randomUUID(),
  lease_expires_at: new Date(Date.now() + 90000).toISOString() };
await rejects(() => write(simultaneous, -1), /LS_BUSY/);

// Completion arriving after its lease must be refused inside the DB transaction too.
await db.exec('reset role');
const runningOperation = stored.operations.find(operation => operation.status === 'running');
await db.query("update learning_session_operations set lease_expires_at=now()-interval '1 second' where id=$1", [runningOperation.id]);
await db.exec('set role service_role');
runningOperation.status = 'succeeded';
await rejects(() => write(stored, stored.session.version), /LS_CONFLICT/);

for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  for (const table of ['learning_session_packs', 'learning_sessions', 'learning_session_items', 'learning_session_attempts', 'learning_session_operations', 'learning_evidence', 'learning_issues', 'learning_issue_events', 'explanation_revisions', 'explanation_evaluations', 'background_jobs', 'review_schedule_events', 'preparation_requests', 'preparation_artifacts']) {
    await rejects(() => db.query(`select * from ${table}`), /permission denied/);
  }
  for (const statement of [
    'select learning_session_read($1::uuid,$2::uuid)',
    'select learning_session_find_command($1::uuid,$2::uuid)',
    'select learning_session_cached_pack($1::uuid,$2::text)',
    'select learning_session_open($1::uuid,$2::text)',
  ]) await rejects(() => db.query(statement, [user, stored.session.id]), /permission denied/);
  await rejects(() => db.query('select learning_session_write($1::uuid,$2::jsonb,0)', [user, JSON.stringify(stored)]), /permission denied/);
  await rejects(() => db.query('select learning_session_list($1::uuid,10)', [user]), /permission denied/);
}
await db.exec('reset role');
await db.query('delete from materials where course_id=$1', [course]);
for (const table of ['learning_session_packs', 'learning_sessions', 'learning_session_items', 'learning_session_attempts', 'learning_session_operations', 'learning_evidence', 'learning_issues', 'learning_issue_events', 'explanation_revisions', 'explanation_evaluations', 'background_jobs', 'review_schedule_events', 'preparation_requests', 'preparation_artifacts']) {
  check(Number((await db.query(`select count(*) from ${table}`)).rows[0].count) === 0, `${table} cascades on material deletion`);
}

// Also exercise both parent deletion paths with live sessions/current-item references.
for (const deletion of ['course', 'account']) {
  if (deletion === 'account') await db.query('insert into courses values ($1,$2)', [course, user]);
  await db.query('insert into materials values ($1,$2,$3,$4)', [course, 'lecture:100', user, text]);
  await db.exec('set role service_role');
  await write(bundle(), -1);
  await db.exec('reset role');
  if (deletion === 'course') await db.query('delete from courses where id=$1', [course]);
  else await db.query('delete from auth.users where id=$1', [user]);
  for (const table of ['learning_session_packs', 'learning_sessions', 'learning_session_items', 'learning_session_attempts', 'learning_session_operations', 'learning_evidence', 'learning_issues', 'learning_issue_events', 'explanation_revisions', 'explanation_evaluations', 'background_jobs', 'review_schedule_events', 'preparation_requests', 'preparation_artifacts']) {
    check(Number((await db.query(`select count(*) from ${table}`)).rows[0].count) === 0, `${table} cascades on ${deletion} deletion`);
  }
}
await db.close();
console.log(`Learning session PostgreSQL integration: ${checks} checks passed`);
