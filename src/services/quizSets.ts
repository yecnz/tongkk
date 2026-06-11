import { createTtlCache } from './cache';
import { fetchCourses } from './courses';
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
  questions?: QuizQuestion[] | null;
  created_at: string;
  updated_at: string;
};

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

const getCourseId = async (course: string) => {
  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course);
  if (!found) return null;

  return found.id;
};

// 퀴즈 세트 목록은 화면 이동마다 다시 받지만 생성 때만 바뀐다 → 짧게 캐싱.
// variant로 문제 본문(questions) 포함 여부를 구분한다.
const quizSetsCache = createTtlCache<SavedQuizSet[]>(30_000);
// 대시보드 통계용 개수 캐시 — 목록 본문을 받지 않고 count(개수)만 보관한다.
const quizSetsCountCache = createTtlCache<number>(30_000);
export const invalidateQuizSetsCache = (course?: string) => {
  quizSetsCache.invalidate(course);
  quizSetsCountCache.invalidate(course);
};

// questions(문제 본문 JSONB)는 세트당 수십 KB~수백 KB라 목록/개수 조회에 함께 받으면 Egress가 커진다.
// 문제 본문이 실제로 필요한 화면(퀴즈 풀기/재풀기, 복습노트 원문 대조, 요약 내 퀴즈 미리보기)만
// includeQuestions로 받고, 개수·메트릭 용도는 기본값(제외)으로 호출한다.
export async function loadQuizSetsFromServer(
  course: string,
  options?: { includeQuestions?: boolean },
): Promise<SavedQuizSet[]> {
  const cacheKey = `${course}::${options?.includeQuestions ? 'full' : 'light'}`;
  const cached = quizSetsCache.get(cacheKey);
  if (cached) return cached;

  const courseId = await getCourseId(course);
  if (!courseId) return [];

  const { data, error } = options?.includeQuestions
    ? await supabase
        .from('quiz_sets')
        .select('id, title, difficulty, question_type, count, material_ids, questions, created_at, updated_at')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false })
    : await supabase
        .from('quiz_sets')
        .select('id, title, difficulty, question_type, count, material_ids, created_at, updated_at')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));
  const quizSets = (data || []).map(toSavedQuizSet);
  quizSetsCache.set(cacheKey, quizSets);
  return quizSets;
}

// 대시보드 통계처럼 "개수만" 필요한 곳을 위해, 행 본문을 받지 않고 Supabase count(head 요청)만 조회한다.
// 이미 받아둔 목록 캐시가 있으면 추가 조회 없이 그 길이를 쓴다.
export async function countQuizSetsFromServer(course: string): Promise<number> {
  const cacheKey = `${course}::count`;
  const cachedCount = quizSetsCountCache.get(cacheKey);
  if (cachedCount !== undefined) return cachedCount;

  const cachedList = quizSetsCache.get(`${course}::light`) ?? quizSetsCache.get(`${course}::full`);
  if (cachedList) {
    quizSetsCountCache.set(cacheKey, cachedList.length);
    return cachedList.length;
  }

  const courseId = await getCourseId(course);
  if (!courseId) return 0;

  const { count, error } = await supabase
    .from('quiz_sets')
    .select('*', { count: 'exact', head: true })
    .eq('course_id', courseId);

  if (error) throw new Error(formatSupabaseError(error));

  const total = count ?? 0;
  quizSetsCountCache.set(cacheKey, total);
  return total;
}

export async function saveQuizSetToServer(
  course: string,
  quizSet: Omit<SavedQuizSet, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SavedQuizSet> {
  const courseId = await getCourseId(course);
  if (!courseId) {
    throw new Error('과목을 찾을 수 없습니다.');
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
  invalidateQuizSetsCache(course);
  return toSavedQuizSet(data);
}

// 퀴즈 세트 한 건을 id로 삭제한다. RLS로 본인 행만 지워지며, quiz_attempts.quiz_set_id는
// schema의 on delete set null로 처리돼 풀이 기록 자체는 보존된다.
export async function deleteQuizSetById(course: string, id: string): Promise<void> {
  const { error } = await supabase.from('quiz_sets').delete().eq('id', id);
  if (error) throw new Error(formatSupabaseError(error));
  invalidateQuizSetsCache(course);
}
