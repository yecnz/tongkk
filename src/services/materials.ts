import { fetchCourses, type CourseRecord } from './courses';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

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
  markdown: string;
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
  markdown: material.markdown,
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
  return {
    ...material,
    filePath,
    mimeType: file.type || 'application/octet-stream',
  };
};

export const createCourseMaterialFileUrl = async (material: CourseMaterial): Promise<string | null> => {
  if (!material.filePath) return null;

  const { data, error } = await supabase.storage
    .from(MATERIAL_STORAGE_BUCKET)
    .createSignedUrl(material.filePath, 60 * 60);

  if (error) throw new Error(formatSupabaseError(error));
  return data.signedUrl;
};

export const loadCourseMaterialsFromServer = async (course: string): Promise<CourseMaterial[]> => {
  const courseId = (await findCourseRecord(course))?.id;
  if (!courseId) return [];

  const { data, error } = await supabase
    .from('materials')
    .select('id, name, size, type, pages, slides, markdown, file_path, mime_type, updated_at')
    .eq('course_id', courseId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));

  const materials = (data || [])
    .map(toCourseMaterial);

  return materials;
};

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
  if (material?.file_path) {
    const removeResult = await supabase.storage
      .from(MATERIAL_STORAGE_BUCKET)
      .remove([material.file_path]);
    if (removeResult.error) throw new Error(formatSupabaseError(removeResult.error));
  }

  const { error } = await supabase
    .from('materials')
    .delete()
    .eq('course_id', courseId)
    .eq('id', materialId);

  if (error) throw new Error(formatSupabaseError(error));
};

export const syncCourseMaterials = async (course: string, materials: CourseMaterial[]) => {
  const courseId = (await findCourseRecord(course))?.id;
  if (!courseId) return;

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
};

export const saveCourseMaterials = syncCourseMaterials;
