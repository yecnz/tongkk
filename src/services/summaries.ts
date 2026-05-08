import { fetchCourses } from './courses';
import { cacheCourseId, getCachedCourseId } from './materials';
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

const summariesKey = (course: string) => `tongkk:summary:${course}`;

const toSavedSummary = (row: SummaryRow): SavedSummary => ({
  id: row.id,
  template: row.template,
  content: row.content,
  createdAt: new Date(row.created_at).getTime(),
  materialIds: row.material_ids || [],
});

const getCourseId = async (course: string) => {
  const cachedCourseId = getCachedCourseId(course);
  if (cachedCourseId) return cachedCourseId;

  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course);
  if (!found) return null;

  cacheCourseId(course, found.id);
  return found.id;
};

export const getLocalSummaries = (course: string): SavedSummary[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(summariesKey(course)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cacheSummaries = (course: string, summaries: SavedSummary[]) => {
  localStorage.setItem(summariesKey(course), JSON.stringify(summaries));
};

export async function loadSummariesFromServer(course: string): Promise<SavedSummary[]> {
  const courseId = await getCourseId(course);
  if (!courseId) return getLocalSummaries(course);

  const localSummaries = getLocalSummaries(course);
  const { data, error } = await supabase
    .from('summaries')
    .select('id, template, content, material_ids, created_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));

  const summaries = (data || []).map(toSavedSummary);
  if (summaries.length === 0 && localSummaries.length > 0) {
    for (const summary of localSummaries) {
      await saveSummaryToServer(course, summary);
    }
    return loadSummariesFromServer(course);
  }

  cacheSummaries(course, summaries);
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
  const saved = { ...toSavedSummary(data), materialNames: summary.materialNames || [] };
  const summaries = [
    ...getLocalSummaries(course).filter(item =>
      !(item.template === saved.template && sameMaterialIds(item.materialIds, saved.materialIds))
    ),
    saved,
  ];
  cacheSummaries(course, summaries);
  return saved;
}

const sameMaterialIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
