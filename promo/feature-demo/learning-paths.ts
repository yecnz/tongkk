import { learningRequest, type LearningSession } from './learning-sessions';
export type StudyChapter = { id: string; title: string; objective: string; material_id: string; material_name: string; unit_ids: string[]; source_hash: string; source_labels: string[]; included: boolean; source_changed: boolean; session_id: string | null; session_status: string | null; completed: boolean };
export type StudyPath = { id: string; course_id: string; title: string; revision: number; chapters: StudyChapter[]; created_at: string; updated_at: string };
const copy = <T,>(value: T): T => structuredClone(value);
export const demoPathId = '67d5bc70-687e-4a96-a0e8-a7f637480251';
const paths: Record<string, StudyPath> = {};
function chapters(): StudyChapter[] { return [
  ['시간 복잡도와 성장률', '입력 크기와 실행 시간의 관계를 설명합니다.', 'p.1 · 시간 복잡도'],
  ['퀵 정렬과 피벗', '평균과 최악의 차이를 피벗·분할에 연결합니다.', 'p.2 · 정렬 알고리즘'],
  ['안정 정렬과 알고리즘 선택', '안정성이 필요한 사례를 설명하고 정렬 방법을 고릅니다.', 'p.3 · 알고리즘 비교'],
].map(([title, objective, label], i) => ({ id: `chapter-demo-${i}`, title, objective, material_id: 'material-demo', material_name: '알고리즘 3주차 강의자료.pdf', unit_ids: [`unit-demo-${i + 1}`], source_hash: 'demo-source', source_labels: [label], included: true, source_changed: false, session_id: i === 0 ? 'demo-session-completed' : null, session_status: i === 0 ? 'completed' : null, completed: i === 0 })); }
export function resetLearningPaths() { Object.keys(paths).forEach(id => delete paths[id]); const now = new Date().toISOString(); paths[demoPathId] = { id: demoPathId, course_id: 'course-demo', title: '정렬 알고리즘 차근차근', revision: 1, chapters: chapters(), created_at: now, updated_at: now }; }
resetLearningPaths();
export function studyPathReturnUrl(id: string | null) { return id && paths[id] ? `/study-paths?path=${encodeURIComponent(id)}` : null; }
export function pathProgress(path: StudyPath) { const included = path.chapters.filter(c => c.included); return { total: included.length, completed: included.filter(c => c.completed).length, next: included.find(c => !c.completed && !c.source_changed) || null }; }
export function moveChapter(rows: StudyChapter[], index: number, direction: -1 | 1) { const target = index + direction; if (index < 0 || target < 0 || index >= rows.length || target >= rows.length) return rows; const next = [...rows]; [next[index], next[target]] = [next[target], next[index]]; return next; }
export async function readStudyPath(id: string) {
  const path = paths[id]; if (!path) throw new Error('이 예시 코스를 찾을 수 없어요. 코스 목록에서 다시 열어주세요.');
  for (const chapter of path.chapters) if (chapter.session_id) { const session = await learningRequest<LearningSession>(`/${chapter.session_id}`); chapter.session_status = session.status; chapter.completed = session.status === 'completed' && session.completed_count >= session.concept_count; }
  return copy(path);
}
export async function listStudyPaths() { return { paths: await Promise.all(Object.keys(paths).map(readStudyPath)) }; }
export async function createStudyPath(body: { id: string; title: string; course_id: string; material_ids: string[] }) {
  if (paths[body.id]) return readStudyPath(body.id);
  const now = new Date().toISOString(); paths[body.id] = { id: body.id, title: body.title, course_id: body.course_id, revision: 1, chapters: chapters().map(chapter => ({ ...chapter, completed: false })), created_at: now, updated_at: now }; return copy(paths[body.id]);
}
export async function saveStudyPath(path: StudyPath) { paths[path.id] = { ...copy(path), revision: path.revision + 1, updated_at: new Date().toISOString() }; return copy(paths[path.id]); }
export async function startStudyChapter(pathId: string, chapterId: string) {
  const chapter = paths[pathId]?.chapters.find(c => c.id === chapterId); if (!chapter) throw new Error('예시 챕터를 찾을 수 없어요.');
  if (!chapter.session_id || chapter.session_status === 'abandoned') { const session = await learningRequest<LearningSession>('', 'POST', { concept_count: 2 }); chapter.session_id = session.id; chapter.session_status = session.status; }
  return { session_id: chapter.session_id };
}
