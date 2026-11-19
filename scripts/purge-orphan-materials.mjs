// course-materials 버킷에서 materials.file_path가 가리키지 않는 고아 파일을 찾아 지운다.
// 과목 삭제 시 Storage 원본을 안 지우던 시절(≤2026-09)에 쌓인 파일을 정리하는 용도.
// 조회: node scripts/purge-orphan-materials.mjs          (기본 = dry-run, 목록만 출력)
// 삭제: node scripts/purge-orphan-materials.mjs --delete
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');

const db = createClient(url, key);
const bucket = db.storage.from('course-materials');

// Storage에 폴더 개념이 없어 prefix를 재귀로 훑는다(metadata 있으면 파일, 없으면 하위 폴더).
const walk = async (prefix) => {
  const { data, error } = await bucket.list(prefix, { limit: 1000 });
  if (error) throw error;
  const out = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.metadata) out.push({ path, size: item.metadata.size ?? 0 });
    else out.push(...await walk(path));
  }
  return out;
};

const files = await walk('');
// service_role은 RLS를 우회하므로 전체 사용자의 file_path가 다 나온다.
const { data: rows, error } = await db.from('materials').select('file_path');
if (error) throw error;
const alive = new Set(rows.map(r => r.file_path).filter(Boolean));

const orphans = files.filter(f => !alive.has(f.path));
const mb = (n) => (n / 1024 / 1024).toFixed(1);
for (const o of orphans) console.log(`${mb(o.size).padStart(7)} MB  ${o.path}`);
console.log(`\n전체 ${files.length}개 중 고아 ${orphans.length}개, ${mb(orphans.reduce((s, o) => s + o.size, 0))} MB`);

if (!process.argv.includes('--delete')) {
  console.log('(조회만 함 — 실제로 지우려면 --delete 를 붙이세요)');
} else {
  for (let i = 0; i < orphans.length; i += 100) {
    const { error: e } = await bucket.remove(orphans.slice(i, i + 100).map(o => o.path));
    if (e) throw e;
  }
  console.log(`삭제 완료: ${orphans.length}개`);
}
