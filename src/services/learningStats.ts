import type { QuizDifficulty, QuizQuestionType } from './gpt';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type RecentQuizPerformance = {
  courseName: string;
  scorePercent: number;
  correctCount: number;
  count: number;
  difficulty: QuizDifficulty;
  questionType: QuizQuestionType;
  weakTopics: string[];
  createdAt: number;
};

export type LearningStats = {
  courseCount: number;
  materialCount: number;
  summaryCount: number;
  quizSetCount: number;
  attemptCount: number;
  averageScore: number | null;
  recentAttempts: RecentQuizPerformance[];
};

type CourseRow = {
  id: string;
  name: string;
};

type AttemptRow = {
  course_id: string;
  score_percent: number;
  correct_count: number;
  count: number;
  difficulty: QuizDifficulty;
  question_type: QuizQuestionType;
  weak_topics: string[] | null;
  created_at: string;
};

const countRows = async (table: 'materials' | 'summaries' | 'quiz_sets' | 'quiz_attempts', userId: string) => {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw new Error(formatSupabaseError(error));
  return count || 0;
};

export async function loadLearningStats(): Promise<LearningStats> {
  const user = await requireSupabaseUser();

  const { data: courses, error: courseError } = await supabase
    .from('courses')
    .select('id, name')
    .eq('user_id', user.id);

  if (courseError) throw new Error(formatSupabaseError(courseError));

  const courseRows = (courses || []) as CourseRow[];
  const courseNameById = new Map(courseRows.map(course => [course.id, course.name]));

  const [
    materialCount,
    summaryCount,
    quizSetCount,
    attemptCount,
    attemptsResult,
  ] = await Promise.all([
    countRows('materials', user.id),
    countRows('summaries', user.id),
    countRows('quiz_sets', user.id),
    countRows('quiz_attempts', user.id),
    supabase
      .from('quiz_attempts')
      .select('course_id, score_percent, correct_count, count, difficulty, question_type, weak_topics, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (attemptsResult.error) throw new Error(formatSupabaseError(attemptsResult.error));

  const attemptRows = (attemptsResult.data || []) as AttemptRow[];
  const averageScore = attemptRows.length > 0
    ? Math.round(attemptRows.reduce((sum, attempt) => sum + attempt.score_percent, 0) / attemptRows.length)
    : null;

  return {
    courseCount: courseRows.length,
    materialCount,
    summaryCount,
    quizSetCount,
    attemptCount,
    averageScore,
    recentAttempts: attemptRows.slice(0, 3).map(attempt => ({
      courseName: courseNameById.get(attempt.course_id) || '알 수 없는 과목',
      scorePercent: attempt.score_percent,
      correctCount: attempt.correct_count,
      count: attempt.count,
      difficulty: attempt.difficulty,
      questionType: attempt.question_type,
      weakTopics: attempt.weak_topics || [],
      createdAt: new Date(attempt.created_at).getTime(),
    })),
  };
}
