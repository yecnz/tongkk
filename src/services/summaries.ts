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
  content: string;
  material_ids: string[] | null;
  created_at: string;
};

const toSavedSummary = (row: SummaryRow): SavedSummary => ({
  id: row.id,
  template: row.template,
  content: row.content,
  createdAt: new Date(row.created_at).getTime(),
  materialIds: row.material_ids || [],
});

const getCourseId = async (course: string) => {
  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course);
  if (!found) return null;

  return found.id;
};

export async function loadSummariesFromServer(course: string): Promise<SavedSummary[]> {
  const courseId = await getCourseId(course);
  if (!courseId) return [];

  const { data, error } = await supabase
    .from('summaries')
    .select('id, template, content, material_ids, created_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));

  const summaries = (data || []).map(toSavedSummary);
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
  return { ...toSavedSummary(data), materialNames: summary.materialNames || [] };
}
