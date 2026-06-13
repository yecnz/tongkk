import { createTtlCache, readThroughCache, SWR_STALE_TTL_MS } from './cache';
import { invalidateMaterialsCache } from './materials';
import { invalidateQuizSetsCache } from './quizSets';
import { invalidateSummariesCache } from './summaries';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type CourseRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type CourseRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

const toCourseRecord = (row: CourseRow): CourseRecord => ({
  id: row.id,
  name: row.name,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

// 과목 목록은 거의 모든 화면이 이름→id 변환에 쓴다 → fresh 30초 + stale 30분(SWR).
const coursesCache = createTtlCache<CourseRecord[]>(30_000, SWR_STALE_TTL_MS);
const COURSES_CACHE_KEY = 'courses';

export function invalidateCoursesCache() {
  coursesCache.invalidate();
}

const fetchCoursesFromServer = async (): Promise<CourseRecord[]> => {
  // 로그아웃 직후의 백그라운드 revalidate에서는 이 호출이 throw할 수 있다 —
  // revalidate()가 에러를 삼키므로 그대로 둔다.
  await requireSupabaseUser();
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));
  const result = (data || []).map(toCourseRecord);
  coursesCache.set(COURSES_CACHE_KEY, result);
  return result;
};

export async function fetchCourses(): Promise<CourseRecord[]> {
  return readThroughCache(coursesCache, COURSES_CACHE_KEY, fetchCoursesFromServer);
}

export async function createCourse(name: string): Promise<CourseRecord> {
  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('courses')
    .insert({ name, user_id: user.id })
    .select('id, name, created_at, updated_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  invalidateCoursesCache();
  return toCourseRecord(data);
}

export async function updateCourse(courseId: string, name: string): Promise<CourseRecord> {
  const { data, error } = await supabase
    .from('courses')
    .update({ name })
    .eq('id', courseId)
    .select('id, name, created_at, updated_at')
    .single();

  if (error) throw new Error(formatSupabaseError(error));
  invalidateCoursesCache();
  return toCourseRecord(data);
}

export async function removeCourse(courseId: string): Promise<void> {
  const { error } = await supabase
    .from('courses')
    .delete()
    .eq('id', courseId);

  if (error) throw new Error(formatSupabaseError(error));
  invalidateCoursesCache();
  // 과목 삭제 시 서버에서 자료/요약/퀴즈가 함께 삭제되므로(cascade) 관련 캐시도 비운다.
  // courseId만 알고 캐시는 과목명 기준이라, 드문 작업인 만큼 해당 캐시를 전체 비운다.
  invalidateMaterialsCache();
  invalidateSummariesCache();
  invalidateQuizSetsCache();
}
