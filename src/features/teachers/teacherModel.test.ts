import { describe, expect, it } from 'vitest';
import {
  TEACHER_COURSES,
  buildAssignmentDraft,
  buildCurriculumDraft,
  calculateTeacherStats,
  createTeacherSampleMaterials,
} from './teacherModel';
import type { TeacherCourse, TeacherMaterial } from './teacherModel';

const material = (overrides: Partial<TeacherMaterial> = {}): TeacherMaterial => ({
  id: 'material-1', courseId: 'course', name: '강의 자료.txt', text: '# 스택\n마지막에 넣은 값을 먼저 꺼냅니다.', addedAt: 0, ...overrides,
});

describe('교수자 예시 데이터와 통계', () => {
  it('두 수업의 학생·개념 통계가 동일한 응답을 집계한다', () => {
    expect(TEACHER_COURSES.map(course => course.name)).toEqual(['자료구조', '인공지능 기초']);
    for (const course of TEACHER_COURSES) {
      expect(course.students).toHaveLength(6);
      const attempts = course.students.reduce((sum, student) => sum + student.quizTotal, 0);
      const incorrect = course.students.reduce((sum, student) => sum + student.quizTotal - student.quizCorrect, 0);
      expect(course.concepts.reduce((sum, concept) => sum + concept.attempts, 0)).toBe(attempts);
      expect(course.concepts.reduce((sum, concept) => sum + concept.incorrect, 0)).toBe(incorrect);
      expect(createTeacherSampleMaterials(course.id)).toHaveLength(2);
      expect(createTeacherSampleMaterials(course.id).every(item => item.name.includes('[예시]') && item.text.includes('# '))).toBe(true);
    }
    expect(calculateTeacherStats(TEACHER_COURSES[0])).toMatchObject({
      studentCount: 6, averageProgress: 64, quizAccuracy: 68, studentsNeedingHelp: 2, totalHelpRequests: 22, totalQuizAttempts: 120,
    });
  });

  it('학생별 분모가 달라도 전체 학습 단위와 응답 수에 따라 집계하고 원본 순서를 보존한다', () => {
    const course: TeacherCourse = {
      id: 'course', name: '수업', description: '',
      students: [
        { id: '1', name: '학생 1', completed: 1, total: 1, quizCorrect: 1, quizTotal: 1, weakConcepts: [] },
        { id: '2', name: '학생 2', completed: 1, total: 9, quizCorrect: 1, quizTotal: 9, weakConcepts: ['개념 B'] },
      ],
      concepts: [
        { id: 'a', name: '개념 A', incorrect: 0, attempts: 2, helpCount: 1 },
        { id: 'b', name: '개념 B', incorrect: 8, attempts: 8, helpCount: 3 },
      ],
    };
    const stats = calculateTeacherStats(course);
    expect(stats).toMatchObject({ averageProgress: 20, quizAccuracy: 20, studentsNeedingHelp: 1, totalHelpRequests: 4 });
    expect(stats.concepts.map(concept => concept.incorrectRate)).toEqual([100, 0]);
    expect(course.concepts.map(concept => concept.id)).toEqual(['a', 'b']);
  });

  it('빈 수업과 응답이 없는 학생을 0으로 집계하며 도움 대상으로 임의 분류하지 않는다', () => {
    const empty: TeacherCourse = { id: 'empty', name: '', description: '', students: [], concepts: [] };
    expect(calculateTeacherStats(empty)).toEqual({
      studentCount: 0, averageProgress: 0, quizAccuracy: 0, totalQuizAttempts: 0, studentsNeedingHelp: 0, totalHelpRequests: 0, concepts: [],
    });
    expect(calculateTeacherStats({ ...empty, students: [{ id: 's', name: '학생', completed: 0, total: 0, quizCorrect: 0, quizTotal: 0, weakConcepts: [] }] }).studentsNeedingHelp).toBe(0);
    expect(createTeacherSampleMaterials('unknown')).toEqual([]);
  });
});

describe('자료 기반 편집용 초안', () => {
  it('자료가 없으면 퀴즈·과제·커리큘럼을 만들지 않는다', () => {
    expect(buildAssignmentDraft([], 'quiz', 5, '보통')).toBe('');
    expect(buildAssignmentDraft([], 'assignment', 5, '보통')).toBe('');
    expect(buildCurriculumDraft([], 4)).toEqual([]);
  });

  it('여러 자료의 제목을 번갈아 사용하고 근거와 검토 안내를 보존한다', () => {
    const materials = [material({ text: '# 스택\n설명\n# 큐\n설명' }), material({ id: 'm2', name: '트리.txt', text: '# 트리 순회\n전위 순회를 배웁니다.' })];
    const draft = buildAssignmentDraft(materials, 'quiz', 3, '보통');
    expect(draft).toContain('템플릿 초안 · 교수자 검토 필요');
    expect(draft).toContain('1. 「스택」');
    expect(draft).toContain('2. 「트리 순회」');
    expect(draft).toContain('3. 「큐」');
    expect(draft).toContain('전위 순회를 배웁니다.');
    expect(draft).toContain('정답·해설: [교수자가 검토 후 작성]');
    expect(draft).toContain('출처: 트리.txt');
    expect(buildAssignmentDraft(materials, 'assignment', 1, '심화')).toContain('조건을 바꾸었을 때의 차이도 분석하세요.');
    expect(buildAssignmentDraft(materials, 'assignment', 1, '심화')).toContain('제출 형식·평가 기준');
  });

  it('본문만 있는 자료와 본문을 추출하지 못한 자료도 빈 제목 없이 처리한다', () => {
    const prose = buildAssignmentDraft([material({ text: '강의 본문은 자료구조를 설명합니다.' })], 'quiz', 1, '');
    expect(prose).toContain('「강의 본문은 자료구조를 설명합니다.」');
    expect(prose).toContain('난이도 보통');
    const filenameOnly = buildAssignmentDraft([material({ name: '강의.pdf', text: '' })], 'quiz', 1, '기본');
    expect(filenameOnly).toContain('「강의」');
    expect(filenameOnly).toContain('본문 없이 파일명을 주제로 구성했습니다.');
  });

  it('주제 하나만 입력해도 10개 문항이 반복되지 않고 쉬움 난이도는 간단한 표현을 사용한다', () => {
    const topicOnly = [material({ name: '직접 입력한 주제', text: '# 시간 복잡도' })];
    const questions = (content: string) => content.split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));
    for (const kind of ['quiz', 'assignment'] as const) {
      for (const level of ['쉬움', '보통', '심화']) {
        const items = questions(buildAssignmentDraft(topicOnly, kind, 10, level));
        expect(items).toHaveLength(10);
        expect(new Set(items).size).toBe(10);
        expect(items.every(item => item.includes('「시간 복잡도」'))).toBe(true);
      }
      const easy = questions(buildAssignmentDraft(topicOnly, kind, 10, '쉬움'));
      const normal = questions(buildAssignmentDraft(topicOnly, kind, 10, '보통'));
      expect(easy.every((item, index) => item !== normal[index])).toBe(true);
    }
    expect(buildAssignmentDraft(topicOnly, 'quiz', 1, '쉬움')).toContain('쉬운 말로 한 문장');
    expect(buildAssignmentDraft(topicOnly, 'assignment', 1, '쉬움')).toContain('세 줄로 요약');
  });

  it('문항 수와 주차 수를 제한하고 잘못된 숫자를 처리한다', () => {
    const materials = [material()];
    const questionCount = (count: number) => buildAssignmentDraft(materials, 'quiz', count, '보통').match(/^\d+\. /gm)?.length;
    expect(questionCount(1000)).toBe(20);
    expect(questionCount(-2)).toBe(1);
    expect(questionCount(2.9)).toBe(2);
    expect(questionCount(Number.NaN)).toBe(5);
    expect(buildCurriculumDraft(materials, 1000)).toHaveLength(16);
    expect(buildCurriculumDraft(materials, -2)).toHaveLength(1);
    expect(buildCurriculumDraft(materials, Number.POSITIVE_INFINITY)).toHaveLength(4);
  });

  it('커리큘럼을 연속 주차로 구성하고 자료를 고루 반영하며 반복 주제를 복습으로 표시한다', () => {
    const materials = [material(), material({ id: 'm2', name: '큐.txt', text: '# 큐\n먼저 넣은 값을 먼저 꺼냅니다.' })];
    const weeks = buildCurriculumDraft(materials, 3);
    expect(weeks.map(week => week.week)).toEqual([1, 2, 3]);
    expect(new Set(weeks.map(week => week.id)).size).toBe(3);
    expect(weeks.map(week => week.title)).toEqual(['스택', '큐', '스택 · 복습과 적용']);
    expect(weeks[1].activity).toContain('큐.txt');
    expect(weeks[2].goal).toContain('새로운 예시에 적용');
  });
});
