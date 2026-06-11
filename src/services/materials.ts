import { createTtlCache, SWR_STALE_TTL_MS } from './cache';
import { fetchCourses, type CourseRecord } from './courses';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import { deleteSummariesByMaterialId } from './summaries';
import { deleteChatSessionsByMaterialId } from './summaryChats';

export type MaterialKind = "pdf" | "ppt" | "img" | "file";

export type CourseMaterial = {
  id: string;
  name: string;
  size: number | null;
  type: MaterialKind;
  pages: number | null;
  slides: number | null;
  markdown: string;
  filePath?: string | null;
  mimeType?: string | null;
  updatedAt: number;
};

const MATERIAL_STORAGE_BUCKET = 'course-materials';

// 자료 목록은 화면 이동마다 다시 받지만 업로드/삭제 때만 바뀐다 → fresh 30초 + stale 30분(SWR).
// variant로 본문(markdown) 포함 여부를 구분해, 가벼운 캐시를 본문 필요한 화면에 잘못 주지 않게 한다.
const materialsCache = createTtlCache<CourseMaterial[]>(30_000, SWR_STALE_TTL_MS);
// 대시보드 통계용 개수 캐시 — 목록 본문을 받지 않고 count(개수)만 보관한다.
const materialsCountCache = createTtlCache<number>(30_000, SWR_STALE_TTL_MS);
export const invalidateMaterialsCache = (course?: string) => {
  materialsCache.invalidate(course);
  materialsCountCache.invalidate(course);
};

// 원본 파일 서명 URL은 자료 상세를 열 때마다 새로 발급된다. URL이 매번 바뀌면 브라우저가
// 같은 파일을 매번 다시 받아(Egress) → 30분간 같은 URL을 재사용해 브라우저 HTTP 캐시
// (업로드 시 cacheControl 3600)가 동작하게 한다. 키는 파일 경로(filePath). 서명 만료(60분)보다
// 짧게 잡아 재사용해도 항상 유효하다. 업로드(재업로드)·삭제 시 해당 경로를 무효화한다.
const signedUrlCache = createTtlCache<string>(30 * 60_000);
export const invalidateSignedUrlCache = (filePath?: string) => signedUrlCache.invalidate(filePath);

// 원본 파일 저장 한도(Supabase Free 플랜 업로드 한도 ≈ 50MB). Pro로 글로벌 한도를 올리면 이 값도 함께 조정.
export const MAX_ORIGINAL_FILE_BYTES = 50 * 1024 * 1024;

export const getFileMaterialId = (file: Pick<File, "name" | "size">) => `${file.name}:${file.size}`;

export const combineMaterialsMarkdown = (materials: CourseMaterial[]) =>
  materials
    .map(material => `# ${material.name}\n\n${material.markdown}`)
    .join("\n\n---\n\n");

const toServerMaterial = (courseId: string, material: CourseMaterial) => ({
  course_id: courseId,
  id: material.id,
  name: material.name,
  size: material.size,
  type: material.type,
  pages: material.pages,
  slides: material.slides,
  markdown: material.markdown,
  file_path: material.filePath || null,
  mime_type: material.mimeType || null,
});

const toCourseMaterial = (material: {
  id: string;
  name: string;
  size: number | null;
  type: MaterialKind;
  pages: number | null;
  slides: number | null;
  markdown?: string | null;
  filePath?: string | null;
  file_path?: string | null;
  mimeType?: string | null;
  mime_type?: string | null;
  updatedAt?: number;
  updated_at?: number;
}): CourseMaterial => ({
  id: material.id,
  name: material.name,
  size: material.size,
  type: material.type,
  pages: material.pages,
  slides: material.slides,
  markdown: material.markdown ?? '',
  filePath: material.filePath ?? material.file_path ?? null,
  mimeType: material.mimeType ?? material.mime_type ?? null,
  updatedAt: material.updatedAt || material.updated_at || Date.now(),
});

const findCourseRecord = async (course: string): Promise<CourseRecord | null> => {
  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course) || null;
  return found;
};

const getStorageSegmentHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

const sanitizeStorageSegment = (value: string, fallback: string) => {
  const normalized = value.normalize('NFKD');
  const safeName = normalized
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
  return `${getStorageSegmentHash(value)}-${safeName || fallback}`;
};

export const uploadCourseMaterialFile = async (
  course: string,
  material: CourseMaterial,
  file: File,
): Promise<CourseMaterial> => {
  // 한도 초과 파일은 네트워크 업로드를 시도하지 않고 즉시 막는다(원본 저장만 생략 — 텍스트는 호출부에서 별도 저장됨).
  if (file.size > MAX_ORIGINAL_FILE_BYTES) {
    throw new Error(`원본 파일이 ${(file.size / (1024 * 1024)).toFixed(1)}MB로 저장 한도(50MB)를 초과해 원본은 저장하지 못했어요.`);
  }
  const courseId = (await findCourseRecord(course))?.id;
  if (!courseId) throw new Error('과목을 찾을 수 없습니다.');

  const user = await requireSupabaseUser();
  const materialPath = sanitizeStorageSegment(material.id, 'material');
  const fileName = sanitizeStorageSegment(file.name, 'file');
  const filePath = `${user.id}/${courseId}/${materialPath}/${fileName}`;
  const { error } = await supabase.storage
    .from(MATERIAL_STORAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    });

  if (error) throw new Error(formatSupabaseError(error));
  // 같은 경로에 새 파일이 올라왔으니(upsert) 이전 서명 URL 캐시는 버린다.
  invalidateSignedUrlCache(filePath);
  return {
    ...material,
    filePath,
    mimeType: file.type || 'application/octet-stream',
  };
};

export const createCourseMaterialFileUrl = async (material: CourseMaterial): Promise<string | null> => {
  if (!material.filePath) return null;

  const cached = signedUrlCache.get(material.filePath);
  if (cached) return cached;

  const { data, error } = await supabase.storage
    .from(MATERIAL_STORAGE_BUCKET)
    .createSignedUrl(material.filePath, 60 * 60);

  if (error) throw new Error(formatSupabaseError(error));
  signedUrlCache.set(material.filePath, data.signedUrl);
  return data.signedUrl;
};

// markdown(변환 본문)은 자료 한 건당 수백 KB~수 MB라 목록 조회에 함께 받으면 Egress가 급증한다.
// 본문이 실제로 필요한 화면(퀴즈 생성·요약 상세·AI 튜터)만 includeMarkdown로 받고,
// 목록/개수/통계 용도는 기본값(제외)으로 호출한다.
export const loadCourseMaterialsFromServer = async (
  course: string,
  options?: { includeMarkdown?: boolean },
): Promise<CourseMaterial[]> => {
  const cacheKey = `${course}::${options?.includeMarkdown ? 'full' : 'light'}`;
  const cached = materialsCache.get(cacheKey);
  if (cached) return cached;

  const fetchList = async (): Promise<CourseMaterial[]> => {
    const courseId = (await findCourseRecord(course))?.id;
    if (!courseId) return [];

    const { data, error } = options?.includeMarkdown
      ? await supabase
          .from('materials')
          .select('id, name, size, type, pages, slides, markdown, file_path, mime_type, updated_at')
          .eq('course_id', courseId)
          .order('updated_at', { ascending: false })
      : await supabase
          .from('materials')
          .select('id, name, size, type, pages, slides, file_path, mime_type, updated_at')
          .eq('course_id', courseId)
          .order('updated_at', { ascending: false });

    if (error) throw new Error(formatSupabaseError(error));

    const materials = (data || [])
      .map(toCourseMaterial);

    materialsCache.set(cacheKey, materials);
    return materials;
  };

  // 만료됐지만 stale 윈도우 안이면 일단 보여주고 백그라운드로 갱신한다(SWR).
  const stale = materialsCache.getStale(cacheKey);
  if (stale) {
    materialsCache.revalidate(cacheKey, fetchList);
    return stale;
  }

  return fetchList();
};

// 대시보드 통계처럼 "개수만" 필요한 곳을 위해, 행 본문을 받지 않고 Supabase count(head 요청)만 조회한다.
// 이미 받아둔 목록 캐시가 있으면 추가 조회 없이 그 길이를 쓴다.
export const countCourseMaterialsFromServer = async (course: string): Promise<number> => {
  const cacheKey = `${course}::count`;
  const cachedCount = materialsCountCache.get(cacheKey);
  if (cachedCount !== undefined) return cachedCount;

  // 목록 캐시 파생은 fresh만 사용한다 — stale 목록에서 count를 만들어 set하면
  // stale 데이터가 fresh로 승격되는 경로가 생긴다.
  const cachedList = materialsCache.get(`${course}::light`) ?? materialsCache.get(`${course}::full`);
  if (cachedList) {
    materialsCountCache.set(cacheKey, cachedList.length);
    return cachedList.length;
  }

  const fetchCount = async (): Promise<number> => {
    const courseId = (await findCourseRecord(course))?.id;
    if (!courseId) return 0;

    const { count, error } = await supabase
      .from('materials')
      .select('*', { count: 'exact', head: true })
      .eq('course_id', courseId);

    if (error) throw new Error(formatSupabaseError(error));

    const total = count ?? 0;
    materialsCountCache.set(cacheKey, total);
    return total;
  };

  const staleCount = materialsCountCache.getStale(cacheKey);
  if (staleCount !== undefined) {
    materialsCountCache.revalidate(cacheKey, fetchCount);
    return staleCount;
  }

  return fetchCount();
};

// 자료 한 건과 파생 데이터(요약·튜터 대화·원본 파일)를 모두 정리한다.
// 퀴즈 세트와 풀이 기록은 의도적으로 남긴다 — 퀴즈는 문제(questions)를 자체 보유해
// 자료 없이도 퀴즈 페이지에서 계속 풀 수 있고, 풀이 기록은 통계에 쓰인다.
export const deleteCourseMaterialFromServer = async (course: string, materialId: string) => {
  const courseId = (await findCourseRecord(course))?.id;
  if (!courseId) return;

  const { data: material, error: loadError } = await supabase
    .from('materials')
    .select('file_path')
    .eq('course_id', courseId)
    .eq('id', materialId)
    .maybeSingle<{ file_path: string | null }>();

  if (loadError) throw new Error(formatSupabaseError(loadError));

  // 파생 데이터부터 지운다. 중간에 실패해도 자료 본체가 남아 있어 삭제를 다시 시도할 수 있다.
  await deleteSummariesByMaterialId(course, materialId);
  await deleteChatSessionsByMaterialId(materialId);

  const { error } = await supabase
    .from('materials')
    .delete()
    .eq('course_id', courseId)
    .eq('id', materialId);

  if (error) throw new Error(formatSupabaseError(error));
  invalidateMaterialsCache(course);

  // Storage 원본은 마지막에 지운다. 여기서 실패하면 접근 경로가 없는 고아 파일만 남고
  // 사용자 입장에서는 삭제가 끝난 것이므로 오류를 올리지 않는다.
  if (material?.file_path) {
    const removeResult = await supabase.storage
      .from(MATERIAL_STORAGE_BUCKET)
      .remove([material.file_path]);
    if (removeResult.error) console.warn('자료 원본 파일 삭제 실패(고아 파일):', removeResult.error);
    invalidateSignedUrlCache(material.file_path);
  }
};

export const syncCourseMaterials = async (course: string, materials: CourseMaterial[]) => {
  const courseId = (await findCourseRecord(course))?.id;
  if (!courseId) return;

  // 아래 diff는 서버 실제 상태와 비교해야 하므로 캐시를 먼저 비워 최신을 읽는다.
  invalidateMaterialsCache(course);
  const serverMaterials = await loadCourseMaterialsFromServer(course);
  const localNames = new Set(materials.map(material => material.name.trim().toLowerCase()));

  for (const serverMaterial of serverMaterials) {
    if (localNames.has(serverMaterial.name.trim().toLowerCase())) continue;

    await deleteCourseMaterialFromServer(course, serverMaterial.id);
  }

  const user = await requireSupabaseUser();
  const { error } = await supabase
    .from('materials')
    .upsert(
      materials.map(material => ({
        ...toServerMaterial(courseId, material),
        user_id: user.id,
      })),
      { onConflict: 'course_id,id' },
    );

  if (error) throw new Error(formatSupabaseError(error));
  invalidateMaterialsCache(course);
};

export const saveCourseMaterials = syncCourseMaterials;
