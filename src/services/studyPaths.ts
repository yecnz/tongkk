import { workflowRequest } from './workflow';

export type StudyChapter = {
  id: string; title: string; objective: string; material_id: string; material_name: string;
  unit_ids: string[]; source_hash: string; source_labels: string[]; included: boolean;
  source_changed: boolean; session_id: string | null; session_status: string | null; completed: boolean;
};
export type StudyPath = {
  id: string; course_id: string; title: string; revision: number; chapters: StudyChapter[];
  created_at: string; updated_at: string;
};
export function studyPathReturnUrl(id: string | null) {
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? `/study-paths?path=${encodeURIComponent(id)}` : null;
}
export function pathProgress(path: StudyPath) {
  const included = path.chapters.filter(c => c.included);
  return { total: included.length, completed: included.filter(c => c.completed).length,
    next: included.find(c => !c.completed && !c.source_changed) ?? null };
}
export function moveChapter(chapters: StudyChapter[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= chapters.length || target >= chapters.length) return chapters;
  const next = [...chapters];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export const listStudyPaths = (signal?: AbortSignal) => workflowRequest<{ paths: StudyPath[] }>('/study-paths', 'GET', undefined, signal);
export const readStudyPath = (id: string, signal?: AbortSignal) => workflowRequest<StudyPath>(`/study-paths/${encodeURIComponent(id)}`, 'GET', undefined, signal);
export const createStudyPath = (body: { id: string; title: string; course_id: string; material_ids: string[] }) =>
  workflowRequest<StudyPath>('/study-paths', 'POST', body);
export const saveStudyPath = (path: StudyPath) => workflowRequest<StudyPath>(`/study-paths/${path.id}`, 'PUT', {
  revision: path.revision, title: path.title,
  chapters: path.chapters.map(({ id, title, included }) => ({ id, title, included })),
});
export const startStudyChapter = (pathId: string, chapterId: string) =>
  workflowRequest<{ session_id: string }>(`/study-paths/${pathId}/chapters/${chapterId}/start`, 'POST', {});
