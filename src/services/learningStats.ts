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

export type CourseLearningStat = {
  courseId: string;
  courseName: string;
  materialCount: number;
  summaryCount: number;
  quizSetCount: number;
  attemptCount: number;
  averageScore: number | null;
};

export type WeakTopicStat = {
  topic: string;
  count: number;
};

export type LearningStats = {
  courseCount: number;
  materialCount: number;
  summaryCount: number;
  quizSetCount: number;
  attemptCount: number;
  averageScore: number | null;
  recentAttempts: RecentQuizPerformance[];
  courseStats: CourseLearningStat[];
  topWeakTopics: WeakTopicStat[];
  thisWeekAttemptCount: number;
  weeklyAverageDelta: number | null;
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

type CourseLinkedRow = {
  course_id: string;
};

const countRows = async (table: 'materials' | 'summaries' | 'quiz_sets' | 'quiz_attempts', userId: string) => {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw new Error(formatSupabaseError(error));
  return count || 0;
};

const countByCourse = (rows: CourseLinkedRow[]) =>
  rows.reduce<Map<string, number>>((map, row) => {
    map.set(row.course_id, (map.get(row.course_id) || 0) + 1);
    return map;
  }, new Map());

const averageScore = (attempts: AttemptRow[]) => {
  if (attempts.length === 0) return null;
  return Math.round(attempts.reduce((sum, attempt) => sum + attempt.score_percent, 0) / attempts.length);
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
    materialRowsResult,
    summaryRowsResult,
    quizSetRowsResult,
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
      .limit(100),
    supabase
      .from('materials')
      .select('course_id')
      .eq('user_id', user.id),
    supabase
      .from('summaries')
      .select('course_id')
      .eq('user_id', user.id),
    supabase
      .from('quiz_sets')
      .select('course_id')
      .eq('user_id', user.id),
  ]);

  if (attemptsResult.error) throw new Error(formatSupabaseError(attemptsResult.error));
  if (materialRowsResult.error) throw new Error(formatSupabaseError(materialRowsResult.error));
  if (summaryRowsResult.error) throw new Error(formatSupabaseError(summaryRowsResult.error));
  if (quizSetRowsResult.error) throw new Error(formatSupabaseError(quizSetRowsResult.error));

  const attemptRows = (attemptsResult.data || []) as AttemptRow[];
  const recentAverageScore = averageScore(attemptRows.slice(0, 10));
  const materialCountByCourse = countByCourse((materialRowsResult.data || []) as CourseLinkedRow[]);
  const summaryCountByCourse = countByCourse((summaryRowsResult.data || []) as CourseLinkedRow[]);
  const quizSetCountByCourse = countByCourse((quizSetRowsResult.data || []) as CourseLinkedRow[]);
  const attemptRowsByCourse = attemptRows.reduce<Map<string, AttemptRow[]>>((map, attempt) => {
    map.set(attempt.course_id, [...(map.get(attempt.course_id) || []), attempt]);
    return map;
  }, new Map());
  const weakTopicCounts = attemptRows.reduce<Map<string, number>>((map, attempt) => {
    for (const topic of attempt.weak_topics || []) {
      const cleanTopic = topic.trim();
      if (!cleanTopic) continue;
      map.set(cleanTopic, (map.get(cleanTopic) || 0) + 1);
    }
    return map;
  }, new Map());
  const now = Date.now();
  const oneWeek = 7 * 86400000;
  const thisWeekAttempts = attemptRows.filter(attempt => now - new Date(attempt.created_at).getTime() < oneWeek);
  const previousWeekAttempts = attemptRows.filter(attempt => {
    const age = now - new Date(attempt.created_at).getTime();
    return age >= oneWeek && age < oneWeek * 2;
  });
  const thisWeekAverage = averageScore(thisWeekAttempts);
  const previousWeekAverage = averageScore(previousWeekAttempts);

  return {
    courseCount: courseRows.length,
    materialCount,
    summaryCount,
    quizSetCount,
    attemptCount,
    averageScore: recentAverageScore,
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
    courseStats: courseRows.map(course => {
      const courseAttempts = attemptRowsByCourse.get(course.id) || [];
      return {
        courseId: course.id,
        courseName: course.name,
        materialCount: materialCountByCourse.get(course.id) || 0,
        summaryCount: summaryCountByCourse.get(course.id) || 0,
        quizSetCount: quizSetCountByCourse.get(course.id) || 0,
        attemptCount: courseAttempts.length,
        averageScore: averageScore(courseAttempts),
      };
    }),
    topWeakTopics: Array.from(weakTopicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic, count]) => ({ topic, count })),
    thisWeekAttemptCount: thisWeekAttempts.length,
    weeklyAverageDelta: thisWeekAverage !== null && previousWeekAverage !== null
      ? thisWeekAverage - previousWeekAverage
      : null,
  };
}
