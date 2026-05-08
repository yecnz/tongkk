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
  updatedAt: number;
};

const materialsKey = (course: string) => `tongkk:materials:${course}`;
const legacyMarkdownKey = (course: string) => `tongkk:markdown:${course}`;
const legacyMaterialKey = (course: string) => `tongkk:material:${course}`;
const courseIdKey = (course: string) => `tongkk:course-id:${course}`;

export const getFileMaterialId = (file: Pick<File, "name" | "size">) => `${file.name}:${file.size}`;

export const getCourseMaterials = (course: string): CourseMaterial[] => {
  const raw = localStorage.getItem(materialsKey(course));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CourseMaterial[];
      if (Array.isArray(parsed)) return parsed.filter(m => m.markdown);
    } catch {
      // Fall through to legacy migration.
    }
  }

  const legacyMarkdown = localStorage.getItem(legacyMarkdownKey(course));
  if (!legacyMarkdown) return [];

  let legacyMaterial: Partial<CourseMaterial> | null = null;
  const legacyRaw = localStorage.getItem(legacyMaterialKey(course));
  if (legacyRaw) {
    try {
      legacyMaterial = JSON.parse(legacyRaw) as Partial<CourseMaterial>;
    } catch {
      legacyMaterial = null;
    }
  }

  return [{
    id: legacyMaterial?.name && typeof legacyMaterial.size === "number"
      ? `${legacyMaterial.name}:${legacyMaterial.size}`
      : `legacy:${course}`,
    name: legacyMaterial?.name || "파일명 정보 없음",
    size: typeof legacyMaterial?.size === "number" ? legacyMaterial.size : null,
    type: legacyMaterial?.type || "pdf",
    pages: legacyMaterial?.pages ?? null,
    slides: legacyMaterial?.slides ?? null,
    markdown: legacyMarkdown,
    updatedAt: legacyMaterial?.updatedAt || Date.now(),
  }];
};

export const saveCourseMaterials = (course: string, materials: CourseMaterial[]) => {
  localStorage.setItem(materialsKey(course), JSON.stringify(materials));

  const latest = materials[materials.length - 1];
  if (latest) {
    localStorage.setItem(legacyMarkdownKey(course), latest.markdown);
    localStorage.setItem(legacyMaterialKey(course), JSON.stringify({
      name: latest.name,
      size: latest.size,
      type: latest.type,
      pages: latest.pages,
      slides: latest.slides,
      updatedAt: latest.updatedAt,
    }));
  } else {
    localStorage.removeItem(legacyMarkdownKey(course));
    localStorage.removeItem(legacyMaterialKey(course));
  }

  syncCourseMaterials(course, materials).catch(error => {
    console.warn("강의자료 서버 저장 실패", error);
  });
};

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
});

const toCourseMaterial = (material: {
  id: string;
  name: string;
  size: number | null;
  type: MaterialKind;
  pages: number | null;
  slides: number | null;
  markdown: string;
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
  updatedAt: material.updatedAt || material.updated_at || Date.now(),
});

export const cacheCourseId = (course: string, courseId: string) => {
  localStorage.setItem(courseIdKey(course), courseId);
};

export const getCachedCourseId = (course: string) =>
  localStorage.getItem(courseIdKey(course));

const findCourseRecord = async (course: string): Promise<CourseRecord | null> => {
  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course) || null;
  if (found) cacheCourseId(course, found.id);
  return found;
};

export const loadCourseMaterialsFromServer = async (course: string): Promise<CourseMaterial[]> => {
  const courseId = getCachedCourseId(course) || (await findCourseRecord(course))?.id;
  if (!courseId) return getCourseMaterials(course);

  const localMaterials = getCourseMaterials(course);
  const { data, error } = await supabase
    .from('materials')
    .select('id, name, size, type, pages, slides, markdown, updated_at')
    .eq('course_id', courseId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));

  const materials = (data || [])
    .map(toCourseMaterial);

  if (materials.length === 0 && localMaterials.length > 0) {
    const user = await requireSupabaseUser();
    const { error: insertError } = await supabase
      .from('materials')
      .insert(localMaterials.map(material => ({
        ...toServerMaterial(courseId, material),
        user_id: user.id,
      })));

    if (insertError) throw new Error(formatSupabaseError(insertError));

    return loadCourseMaterialsFromServer(course);
  }

  localStorage.setItem(materialsKey(course), JSON.stringify(materials));
  return materials;
};

export const deleteCourseMaterialFromServer = async (course: string, materialId: string) => {
  const courseId = getCachedCourseId(course) || (await findCourseRecord(course))?.id;
  if (!courseId) return;
  const { error } = await supabase
    .from('materials')
    .delete()
    .eq('course_id', courseId)
    .eq('id', materialId);

  if (error) throw new Error(formatSupabaseError(error));
  await loadCourseMaterialsFromServer(course).catch(() => undefined);
};

export const syncCourseMaterials = async (course: string, materials: CourseMaterial[]) => {
  const courseId = getCachedCourseId(course) || (await findCourseRecord(course))?.id;
  if (!courseId) return;

  const serverMaterials = await loadCourseMaterialsFromServer(course);
  const serverByName = new Map(serverMaterials.map(material => [material.name.trim().toLowerCase(), material]));
  const localNames = new Set(materials.map(material => material.name.trim().toLowerCase()));

  for (const serverMaterial of serverMaterials) {
    if (localNames.has(serverMaterial.name.trim().toLowerCase())) continue;

    await deleteCourseMaterialFromServer(course, serverMaterial.id);
  }

  const user = await requireSupabaseUser();
  for (const material of materials) {
    const key = material.name.trim().toLowerCase();
    if (serverByName.has(key)) continue;

    const { error } = await supabase
      .from('materials')
      .insert({
        ...toServerMaterial(courseId, material),
        user_id: user.id,
      });

    if (error) throw new Error(formatSupabaseError(error));
  }

  await loadCourseMaterialsFromServer(course);
};
