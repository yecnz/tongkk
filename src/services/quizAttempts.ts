import { fetchCourses } from './courses';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { QuizDifficulty, QuizQuestionType } from './gpt';

export type QuizAttemptAnswer = {
  question: string;
  type: QuizQuestionType;
  studentAnswer: number | string | null;
  correctAnswer: number | string | null;
  isCorrect: boolean;
  score?: number;
  feedback?: string;
  explanation: string;
};

export type SavedQuizAttempt = {
  id: string;
  quizSetId: string | null;
  difficulty: QuizDifficulty;
  questionType: QuizQuestionType;
  count: number;
  correctCount: number;
  scorePercent: number;
  weakTopics: string[];
  answers: QuizAttemptAnswer[];
  durationSeconds: number | null;
  timedOut: boolean;
  materialIds: string[];
  createdAt: number;
};

type QuizAttemptRow = {
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

const getCourseId = async (course: string) => {
  const courses = await fetchCourses();
  return courses.find(item => item.name === course)?.id || null;
};

export async function loadQuizAttemptsFromServer(course: string): Promise<SavedQuizAttempt[]> {
  const courseId = await getCourseId(course);
  if (!courseId) return [];

  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('id, quiz_set_id, difficulty, question_type, count, correct_count, score_percent, weak_topics, answers, duration_seconds, timed_out, material_ids, created_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(toSavedQuizAttempt);
}

export async function saveQuizAttemptToServer(
  course: string,
  attempt: Omit<SavedQuizAttempt, 'id' | 'createdAt'>,
): Promise<SavedQuizAttempt> {
  const courseId = await getCourseId(course);
  if (!courseId) {
    throw new Error('과목을 찾을 수 없습니다.');
  }

  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('quiz_attempts')
    .insert({
      course_id: courseId,
      user_id: user.id,
      quiz_set_id: attempt.quizSetId,
      difficulty: attempt.difficulty,
      question_type: attempt.questionType,
      count: attempt.count,
      correct_count: attempt.correctCount,
      score_percent: attempt.scorePercent,
      weak_topics: attempt.weakTopics,
      answers: attempt.answers,
      duration_seconds: attempt.durationSeconds,
      timed_out: attempt.timedOut,
      material_ids: attempt.materialIds,
    })
    .select('id, quiz_set_id, difficulty, question_type, count, correct_count, score_percent, weak_topics, answers, duration_seconds, timed_out, material_ids, created_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  return toSavedQuizAttempt(data);
}
