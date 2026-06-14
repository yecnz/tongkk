import { createTtlCache, readThroughCache, SWR_STALE_TTL_MS } from './cache';
import { fetchCourses } from './courses';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { SummaryTemplate } from './gpt';

export type SavedSummary = {
  id?: string;
  template: SummaryTemplate;
  content: string;
  createdAt: number;
  materialIds?: string[];
  materialNames?: string[];
};

type SummaryRow = {
  id: string;
  template: SummaryTemplate;
  content?: string | null;
  material_ids: string[] | null;
  created_at: string;
};

const toSavedSummary = (row: SummaryRow): SavedSummary => ({
  id: row.id,
  template: row.template,
  content: row.content || '',
  createdAt: new Date(row.created_at).getTime(),
  materialIds: row.material_ids || [],
});

const getCourseId = async (course: string) => {
  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course);
  if (!found) return null;

  return found.id;
};

// 요약 목록은 화면 이동마다 다시 받지만 생성/수정/삭제 때만 바뀐다 → fresh 30초 + stale 30분(SWR).
// variant로 본문(content) 포함 여부를 구분한다.
const summariesCache = createTtlCache<SavedSummary[]>(30_000, SWR_STALE_TTL_MS);
// 대시보드 통계용 개수 캐시 — 목록 본문을 받지 않고 count(개수)만 보관한다.
const summariesCountCache = createTtlCache<number>(30_000, SWR_STALE_TTL_MS);
export const invalidateSummariesCache = (course?: string) => {
  summariesCache.invalidate(course);
  summariesCountCache.invalidate(course);
};

// content(요약 전문)는 항목당 수 KB~수십 KB라 목록/개수 조회에 함께 받으면 Egress가 커진다.
// 본문이 실제로 필요한 화면(요약 표시·AI 튜터, 요약 기반 퀴즈 출제)만 includeContent로 받고,
// 개수·목록 용도는 기본값(제외)으로 호출한다.
export async function loadSummariesFromServer(
  course: string,
  options?: { includeContent?: boolean },
): Promise<SavedSummary[]> {
  const cacheKey = `${course}::${options?.includeContent ? 'full' : 'light'}`;

  const fetchList = async (): Promise<SavedSummary[]> => {
    const courseId = await getCourseId(course);
    if (!courseId) return [];

    const { data, error } = options?.includeContent
      ? await supabase
          .from('summaries')
          .select('id, template, content, material_ids, created_at')
          .eq('course_id', courseId)
          .order('created_at', { ascending: false })
      : await supabase
          .from('summaries')
          .select('id, template, material_ids, created_at')
          .eq('course_id', courseId)
          .order('created_at', { ascending: false });

    if (error) throw new Error(formatSupabaseError(error));

    const summaries = (data || []).map(toSavedSummary);
    summariesCache.set(cacheKey, summaries);
    return summaries;
  };

  return readThroughCache(summariesCache, cacheKey, fetchList);
}

// 대시보드 통계처럼 "개수만" 필요한 곳을 위해, 행 본문을 받지 않고 Supabase count(head 요청)만 조회한다.
// 이미 받아둔 목록 캐시가 있으면 추가 조회 없이 그 길이를 쓴다.
export async function countSummariesFromServer(course: string): Promise<number> {
  const cacheKey = `${course}::count`;
  const cachedCount = summariesCountCache.get(cacheKey);
  if (cachedCount !== undefined) return cachedCount;

  // 목록 캐시 파생은 fresh만 사용한다 — stale 목록에서 count를 만들어 set하면
  // stale 데이터가 fresh로 승격되는 경로가 생긴다.
  const cachedList = summariesCache.get(`${course}::light`) ?? summariesCache.get(`${course}::full`);
  if (cachedList) {
    summariesCountCache.set(cacheKey, cachedList.length);
    return cachedList.length;
  }

  const fetchCount = async (): Promise<number> => {
    const courseId = await getCourseId(course);
    if (!courseId) return 0;

    const { count, error } = await supabase
      .from('summaries')
      .select('*', { count: 'exact', head: true })
      .eq('course_id', courseId);

    if (error) throw new Error(formatSupabaseError(error));

    const total = count ?? 0;
    summariesCountCache.set(cacheKey, total);
    return total;
  };

  return readThroughCache(summariesCountCache, cacheKey, fetchCount);
}

export async function deleteSummariesByMaterialId(course: string, materialId: string): Promise<void> {
  const courseId = await getCourseId(course);
  if (!courseId) return;

  const { data, error } = await supabase
    .from('summaries')
    .select('id, material_ids')
    .eq('course_id', courseId);

  if (error) throw new Error(formatSupabaseError(error));

  const toDelete = (data || [])
    .filter(row => (row.material_ids || []).includes(materialId))
    .map(row => row.id);

  if (toDelete.length === 0) return;

  const { error: deleteError } = await supabase
    .from('summaries')
    .delete()
    .in('id', toDelete);

  if (deleteError) throw new Error(formatSupabaseError(deleteError));
  invalidateSummariesCache(course);
}

// 요약 한 건을 id로 삭제한다. RLS로 본인 행만 지워지며, 연결된 summary_chat_sessions는
// schema의 on delete cascade로 함께 삭제된다.
export async function deleteSummaryById(course: string, id: string): Promise<void> {
  const { error } = await supabase.from('summaries').delete().eq('id', id);
  if (error) throw new Error(formatSupabaseError(error));
  invalidateSummariesCache(course);
}

const sortedIds = (ids: string[]) => [...ids].sort();
const sameIds = (a: string[], b: string[]) => {
  const sa = sortedIds(a), sb = sortedIds(b);
  return sa.length === sb.length && sa.every((id, i) => id === sb[i]);
};

export async function saveSummaryToServer(course: string, summary: SavedSummary): Promise<SavedSummary> {
  const courseId = await getCourseId(course);
  if (!courseId) return summary;

  const user = await requireSupabaseUser();
  const materialIds = summary.materialIds || [];

  // Find existing summary with same template + material_ids (array upsert not supported in PG unique constraints)
  const { data: existing, error: fetchError } = await supabase
    .from('summaries')
    .select('id, template, content, material_ids, created_at')
    .eq('course_id', courseId)
    .eq('template', summary.template);

  if (fetchError) throw new Error(formatSupabaseError(fetchError));

  const match = (existing || []).find(row => sameIds(row.material_ids || [], materialIds));

  if (match) {
    const { data, error } = await supabase
      .from('summaries')
      .update({ content: summary.content })
      .eq('id', match.id)
      .select('id, template, content, material_ids, created_at')
      .single();
    if (error) throw new Error(formatSupabaseError(error));
    invalidateSummariesCache(course);
    return { ...toSavedSummary(data), materialNames: summary.materialNames || [] };
  }

  const { data, error } = await supabase
    .from('summaries')
    .insert({
      course_id: courseId,
      user_id: user.id,
      template: summary.template,
      content: summary.content,
      material_ids: materialIds,
    })
    .select('id, template, content, material_ids, created_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  invalidateSummariesCache(course);
  return { ...toSavedSummary(data), materialNames: summary.materialNames || [] };
}
