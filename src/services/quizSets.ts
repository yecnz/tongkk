import { fetchCourses } from './courses';
import { cacheCourseId, getCachedCourseId } from './materials';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { QuizDifficulty, QuizQuestion, QuizQuestionType } from './gpt';

export type SavedQuizSet = {
  id: string;
  title: string;
  difficulty: QuizDifficulty;
  questionType: QuizQuestionType;
  count: number;
  materialIds: string[];
  questions: QuizQuestion[];
  createdAt: number;
  updatedAt: number;
};

type QuizSetRow = {
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

const quizSetsKey = (course: string) => `tongkk:quizSets:${course}`;

const toSavedQuizSet = (row: QuizSetRow): SavedQuizSet => ({
  id: row.id,
  title: row.title,
  difficulty: row.difficulty,
  questionType: row.question_type,
  count: row.count,
  materialIds: row.material_ids || [],
  questions: row.questions,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
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

export const getLocalQuizSets = (course: string): SavedQuizSet[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(quizSetsKey(course)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cacheQuizSets = (course: string, quizSets: SavedQuizSet[]) => {
  localStorage.setItem(quizSetsKey(course), JSON.stringify(quizSets));
};

export async function loadQuizSetsFromServer(course: string): Promise<SavedQuizSet[]> {
  const courseId = await getCourseId(course);
  if (!courseId) return getLocalQuizSets(course);

  const { data, error } = await supabase
    .from('quiz_sets')
    .select('id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));
  const quizSets = (data || []).map(toSavedQuizSet);
  cacheQuizSets(course, quizSets);
  return quizSets;
}

export async function saveQuizSetToServer(
  course: string,
  quizSet: Omit<SavedQuizSet, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SavedQuizSet> {
  const courseId = await getCourseId(course);
  if (!courseId) {
    const fallback: SavedQuizSet = { ...quizSet, id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now() };
    cacheQuizSets(course, [fallback, ...getLocalQuizSets(course)]);
    return fallback;
  }

  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('quiz_sets')
    .insert({
      course_id: courseId,
      user_id: user.id,
      title: quizSet.title,
      difficulty: quizSet.difficulty,
      question_type: quizSet.questionType,
      count: quizSet.count,
      material_ids: quizSet.materialIds,
      questions: quizSet.questions,
    })
    .select('id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  const saved = toSavedQuizSet(data);
  cacheQuizSets(course, [saved, ...getLocalQuizSets(course).filter(item => item.id !== saved.id)]);
  return saved;
}
