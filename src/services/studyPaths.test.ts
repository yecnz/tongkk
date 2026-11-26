import { describe, expect, it } from 'vitest';
import { moveChapter, pathProgress, studyPathReturnUrl, type StudyChapter, type StudyPath } from './studyPaths';

const chapter = (id: string, changes: Partial<StudyChapter> = {}): StudyChapter => ({
  id, title: id, objective: '학습', material_id: 'm', material_name: '자료', unit_ids: ['u0'], source_hash: 'hash',
  source_labels: ['1페이지'], included: true, source_changed: false, session_id: null, session_status: null, completed: false, ...changes,
});
const path = (chapters: StudyChapter[]) => ({ chapters } as StudyPath);

describe('학습 코스 진도', () => {
  it('허용된 UUID만 내부 코스 복귀 주소로 사용한다', () => {
    expect(studyPathReturnUrl('123e4567-e89b-42d3-a456-426614174000')).toBe('/study-paths?path=123e4567-e89b-42d3-a456-426614174000');
    expect(studyPathReturnUrl('https://example.com')).toBe(null);
    expect(studyPathReturnUrl('../other')).toBe(null);
    expect(studyPathReturnUrl(null)).toBe(null);
  });
  it('제외한 챕터와 부분 완료를 완료 진도에 포함하지 않는다', () => {
    const result = pathProgress(path([chapter('done', { completed: true }), chapter('excluded', { included: false, completed: true }), chapter('partial', { session_status: 'completed' })]));
    expect(result.total).toBe(2); expect(result.completed).toBe(1); expect(result.next?.id).toBe('partial');
  });
  it('원문이 바뀐 챕터는 다음 학습으로 추천하지 않는다', () => {
    const result = pathProgress(path([chapter('stale', { source_changed: true }), chapter('next')]));
    expect(result.next?.id).toBe('next'); expect(result.completed).toBe(0);
  });
  it('챕터를 옮겨도 원문 연결과 기록을 보존한다', () => {
    const original = [chapter('first'), chapter('second', { session_id: 'session' })];
    const changed = moveChapter(original, 1, -1);
    expect(changed.map(c => c.id)).toEqual(['second', 'first']);
    expect(changed[0].session_id).toBe('session'); expect(original[0].id).toBe('first');
    expect(moveChapter(original, 0, -1)).toBe(original);
  });
});
