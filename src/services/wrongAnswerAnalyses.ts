import { fetchCourses } from './courses';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { WrongAnswerAnalysis } from './gpt';

type WrongAnalysisRow = {
  course_id: string;
  analysis: WrongAnswerAnalysis;
};

const getCourseId = async (course: string) => {
  const courses = await fetchCourses();
  return courses.find(item => item.name === course)?.id || null;
};

// 과목당 최신 분석 1건만 유지(course_id unique). 같은 과목은 덮어쓴다.
export async function saveWrongAnswerAnalysisToServer(
  course: string,
  analysis: WrongAnswerAnalysis,
): Promise<void> {
  const courseId = await getCourseId(course);
  if (!courseId) throw new Error('과목을 찾을 수 없습니다.');

  const user = await requireSupabaseUser();
  const { error } = await supabase
    .from('wrong_answer_analyses')
    .upsert(
      { course_id: courseId, user_id: user.id, analysis, updated_at: new Date().toISOString() },
      { onConflict: 'course_id' },
    );

  if (error) throw new Error(formatSupabaseError(error));
}

export async function loadAllWrongAnswerAnalysesFromServer(): Promise<Map<string, WrongAnswerAnalysis>> {
  const user = await requireSupabaseUser();
  const courses = await fetchCourses();
  const courseNameById = new Map(courses.map(course => [course.id, course.name]));

  const { data, error } = await supabase
    .from('wrong_answer_analyses')
    .select('course_id, analysis')
    .eq('user_id', user.id);

  if (error) throw new Error(formatSupabaseError(error));

  const result = new Map<string, WrongAnswerAnalysis>();
  for (const row of (data || []) as WrongAnalysisRow[]) {
    const name = courseNameById.get(row.course_id);
    if (name && row.analysis) result.set(name, row.analysis);
  }
  return result;
}
