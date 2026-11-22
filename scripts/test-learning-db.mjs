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
await db.exec(migration);
await db.exec(readFileSync(new URL('../supabase/migrations/202611230002_learning_history.sql', import.meta.url), 'utf8'));
await db.exec('set role service_role');

function bundle() {
  const packId = randomUUID(), sessionId = randomUUID(), itemId = randomUUID();
  return {
    pack: { id: packId, user_id: user, course_id: course, material_id: 'lecture:100', material_name: '자료',
      preparation_key: randomUUID(), source_hash: hash, selected_scope: { type: 'all' }, source_snapshot: text,
      source_units: [{ id: 'u0', text, start: 0, end: text.length }], concept_count: 1,
      content_version: 'test-v1', content: { concepts: [{ title: '비공개 정답' }] }, status: 'ready' },
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
  for (const table of ['learning_session_packs', 'learning_sessions', 'learning_session_items', 'learning_session_attempts', 'learning_session_operations']) {
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
for (const table of ['learning_session_packs', 'learning_sessions', 'learning_session_items', 'learning_session_attempts', 'learning_session_operations']) {
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
  for (const table of ['learning_session_packs', 'learning_sessions', 'learning_session_items', 'learning_session_attempts', 'learning_session_operations']) {
    check(Number((await db.query(`select count(*) from ${table}`)).rows[0].count) === 0, `${table} cascades on ${deletion} deletion`);
  }
}
await db.close();
console.log(`Learning session PostgreSQL integration: ${checks} checks passed`);
