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

const findCourseRecord = async (course: string): Promise<CourseRecord | null> => {
  const courses = await fetchCourses();
  const found = courses.find(item => item.name === course) || null;
  return found;
};

export const loadCourseMaterialsFromServer = async (course: string): Promise<CourseMaterial[]> => {
  const courseId = (await findCourseRecord(course))?.id;
  if (!courseId) return [];

  const { data, error } = await supabase
    .from('materials')
    .select('id, name, size, type, pages, slides, markdown, updated_at')
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

export const saveCourseMaterials = syncCourseMaterials;
