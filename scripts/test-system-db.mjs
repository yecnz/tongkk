// Isolated PostgreSQL checks; no production connection or credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`create table summaries(id uuid primary key default gen_random_uuid(),user_id uuid not null,course_id uuid not null,
 template text,content text,material_ids text[],page_range text,focus_prompt text,created_at timestamptz default now(),
 constraint summaries_dedup_key unique(course_id,template,material_ids,page_range,focus_prompt));`);
await db.exec(readFileSync(new URL('../supabase/migrations/202611230001_summary_identity.sql', import.meta.url), 'utf8'));
const owner='00000000-0000-0000-0000-000000000001', course='00000000-0000-0000-0000-000000000002';
await db.query(`insert into summaries(user_id,course_id,template,content,material_ids,page_range,focus_prompt)
 values($1,$2,'GENERAL','legacy',array['a'],'','')`,[owner,course]);
await db.query(`insert into summaries(user_id,course_id,template,content,material_ids,page_range,focus_prompt,source_hash,request_key,generation_id)
 values($1,$2,'GENERAL','new',array['a'],'','','hash','key',gen_random_uuid()),
 ($1,$2,'GENERAL','regenerated',array['a'],'','','hash','key',gen_random_uuid())`,[owner,course]);
const rows=(await db.query('select * from summaries order by created_at')).rows;
assert.equal(rows.length,3); assert.equal(rows[0].request_key,null);
await assert.rejects(db.query('insert into summaries(user_id,course_id,generation_id) values($1,$2,$3)',[owner,course,rows[1].generation_id]),/duplicate key/);
await db.close();
console.log('Summary migrations: history, legacy preservation and idempotency passed');
