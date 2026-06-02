import type { QuizDifficulty, QuizQuestion, QuizQuestionType } from './gpt';
import type { CourseMaterial, MaterialKind } from './materials';
import type { SavedQuizAttempt, QuizAttemptAnswer } from './quizAttempts';
import type { SavedQuizSet } from './quizSets';
import type { SavedSummary } from './summaries';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { SummaryTemplate } from './gpt';

export type CourseLearningSnapshot = {
  course: string;
  materials: CourseMaterial[];
  summaries: SavedSummary[];
  quizSets: SavedQuizSet[];
  quizAttempts: SavedQuizAttempt[];
};

type MaterialRow = {
  course_id: string;
  id: string;
  name: string;
  size: number | null;
  type: MaterialKind;
  pages: number | null;
  slides: number | null;
  markdown: string;
  file_path: string | null;
  mime_type: string | null;
  updated_at: string;
};

type CourseRow = {
  id: string;
  name: string;
};

type SummaryRow = {
  course_id: string;
  id: string;
  template: SummaryTemplate;
  content: string;
  material_ids: string[] | null;
  created_at: string;
};

type QuizSetRow = {
  course_id: string;
  id: string;
  title: string;
  difficulty: QuizDifficulty;
  question_type: QuizQuestionType;
  count: number;
  material_ids: string[] | null;
  questions: QuizQuestion[];
  created_at: string;
  updated_at: string;
};

type QuizAttemptRow = {
  course_id: string;
  id: string;
  quiz_set_id: string | null;
  difficulty: QuizDifficulty;
  question_type: QuizQuestionType;
  count: number;
  correct_count: number;
  score_percent: number;
  weak_topics: string[] | null;
  answers: QuizAttemptAnswer[];
  duration_seconds: number | null;
  timed_out: boolean;
  material_ids: string[] | null;
  created_at: string;
};

const groupByCourseId = <T extends { course_id: string }>(rows: T[] = []) =>
  rows.reduce<Map<string, T[]>>((map, row) => {
    map.set(row.course_id, [...(map.get(row.course_id) || []), row]);
    return map;
  }, new Map());

const toCourseMaterial = (row: MaterialRow): CourseMaterial => ({
  id: row.id,
  name: row.name,
  size: row.size,
  type: row.type,
  pages: row.pages,
  slides: row.slides,
  markdown: row.markdown,
  filePath: row.file_path,
  mimeType: row.mime_type,
  updatedAt: new Date(row.updated_at).getTime(),
});

const toSavedSummary = (row: SummaryRow): SavedSummary => ({
  id: row.id,
  template: row.template,
  content: row.content,
  materialIds: row.material_ids || [],
  createdAt: new Date(row.created_at).getTime(),
});

const toSavedQuizSet = (row: QuizSetRow): SavedQuizSet => ({
  id: row.id,
  title: row.title,
  difficulty: row.difficulty,
  questionType: row.question_type,
  count: row.count,
  materialIds: row.material_ids || [],
  questions: row.questions || [],
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

const toSavedQuizAttempt = (row: QuizAttemptRow): SavedQuizAttempt => ({
  id: row.id,
  quizSetId: row.quiz_set_id,
  difficulty: row.difficulty,
  questionType: row.question_type,
  count: row.count,
  correctCount: row.correct_count,
  scorePercent: row.score_percent,
  weakTopics: row.weak_topics || [],
  answers: row.answers || [],
  durationSeconds: row.duration_seconds,
  timedOut: row.timed_out,
  materialIds: row.material_ids || [],
  createdAt: new Date(row.created_at).getTime(),
});

export async function loadDashboardLearningSnapshots(): Promise<CourseLearningSnapshot[]> {
  const user = await requireSupabaseUser();
  const [
    courses,
    materialsResult,
    summariesResult,
    quizSetsResult,
    quizAttemptsResult,
  ] = await Promise.all([
    supabase
      .from('courses')
      .select('id, name')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('materials')
      .select('course_id, id, name, size, type, pages, slides, markdown, file_path, mime_type, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('summaries')
      .select('course_id, id, template, content, material_ids, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('quiz_sets')
      .select('course_id, id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('quiz_attempts')
      .select('course_id, id, quiz_set_id, difficulty, question_type, count, correct_count, score_percent, weak_topics, answers, duration_seconds, timed_out, material_ids, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ]);

  if (courses.error) throw new Error(formatSupabaseError(courses.error));
  if (materialsResult.error) throw new Error(formatSupabaseError(materialsResult.error));
  if (summariesResult.error) throw new Error(formatSupabaseError(summariesResult.error));
  if (quizSetsResult.error) throw new Error(formatSupabaseError(quizSetsResult.error));
  if (quizAttemptsResult.error) throw new Error(formatSupabaseError(quizAttemptsResult.error));

  const materialsByCourse = groupByCourseId((materialsResult.data || []) as MaterialRow[]);
  const summariesByCourse = groupByCourseId((summariesResult.data || []) as SummaryRow[]);
  const quizSetsByCourse = groupByCourseId((quizSetsResult.data || []) as QuizSetRow[]);
  const quizAttemptsByCourse = groupByCourseId((quizAttemptsResult.data || []) as QuizAttemptRow[]);

  return ((courses.data || []) as CourseRow[]).map(course => ({
    course: course.name,
    materials: (materialsByCourse.get(course.id) || []).map(toCourseMaterial),
    summaries: (summariesByCourse.get(course.id) || []).map(toSavedSummary),
    quizSets: (quizSetsByCourse.get(course.id) || []).map(toSavedQuizSet),
    quizAttempts: (quizAttemptsByCourse.get(course.id) || []).map(toSavedQuizAttempt),
  }));
}
