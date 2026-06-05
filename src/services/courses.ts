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

let _coursesCache: { data: CourseRecord[]; expiry: number } | null = null;
const COURSES_CACHE_TTL = 30_000;

export function invalidateCoursesCache() {
  _coursesCache = null;
}

export async function fetchCourses(): Promise<CourseRecord[]> {
  if (_coursesCache && Date.now() < _coursesCache.expiry) {
    return _coursesCache.data;
  }
  await requireSupabaseUser();
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));
  const result = (data || []).map(toCourseRecord);
  _coursesCache = { data: result, expiry: Date.now() + COURSES_CACHE_TTL };
  return result;
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
}
