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

export async function saveSummaryToServer(course: string, summary: SavedSummary): Promise<SavedSummary> {
  const courseId = await getCourseId(course);
  if (!courseId) return summary;

  const user = await requireSupabaseUser();
  const materialIds = summary.materialIds || [];
  const { data, error } = await supabase
    .from('summaries')
    .upsert({
      course_id: courseId,
      user_id: user.id,
      template: summary.template,
      content: summary.content,
      material_ids: materialIds,
    }, {
      onConflict: 'course_id,template,material_ids',
    })
    .select('id, template, content, material_ids, created_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  return { ...toSavedSummary(data), materialNames: summary.materialNames || [] };
}
