import { fetchCourses } from './courses';
import { workflowRequest } from './workflow';
export type PreparationKind = 'summary' | 'quiz' | 'pack';
export type Preparation = { id: string; course_id: string; material_id: string; pages: string; source_changed: boolean;
  artifacts: { id: string; kind: PreparationKind; status: 'queued' | 'ready' | 'failed' | 'applied' | 'discarded'; generation: number; error_code: string | null; applied_id: string | null;
    preview: { content?: string; questions?: { question: string; options: string[]; explanation: string }[]; concepts?: string[] } }[] };
export async function queuePreparation(course: string, materialId: string, kinds: PreparationKind[], pages = '', regenerate = false, id: string = crypto.randomUUID()) {
  const courseId = (await fetchCourses()).find(c => c.name === course)?.id;
  if (!courseId) throw new Error('과목을 찾을 수 없어요.');
  return workflowRequest<Preparation>('/preparation-requests', 'POST', { id, course_id: courseId, material_id: materialId, kinds, pages, regenerate });
}
export async function prepareUploadedMaterials(course: string, materials: { id: string; name: string }[], kinds: PreparationKind[]) {
  if (!kinds.length) return '';
  const failures: string[] = [];
  for (const material of materials) {
    try { await queuePreparation(course, material.id, kinds); }
    catch { failures.push(material.name); }
  }
  return failures.length ? `${failures.join(', ')} 자료는 자동 준비를 시작하지 못했어요. 자료 상세에서 범위와 준비 설정을 확인해 주세요.` : '학습 자료 준비를 예약했어요. 자료 상세에서 결과를 확인할 수 있어요.';
}
