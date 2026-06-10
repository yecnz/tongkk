import { createTtlCache } from './cache';
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

// 요약 목록은 화면 이동마다 다시 받지만 생성/수정/삭제 때만 바뀐다 → 짧게 캐싱.
// variant로 본문(content) 포함 여부를 구분한다.
const summariesCache = createTtlCache<SavedSummary[]>(30_000);
export const invalidateSummariesCache = (course?: string) => summariesCache.invalidate(course);

// content(요약 전문)는 항목당 수 KB~수십 KB라 목록/개수 조회에 함께 받으면 Egress가 커진다.
// 본문이 실제로 필요한 화면(요약 표시·AI 튜터, 요약 기반 퀴즈 출제)만 includeContent로 받고,
// 개수·목록 용도는 기본값(제외)으로 호출한다.
export async function loadSummariesFromServer(
  course: string,
  options?: { includeContent?: boolean },
): Promise<SavedSummary[]> {
  const cacheKey = `${course}::${options?.includeContent ? 'full' : 'light'}`;
  const cached = summariesCache.get(cacheKey);
  if (cached) return cached;

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
