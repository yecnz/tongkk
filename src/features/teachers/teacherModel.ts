export type TeacherStudent = {
  id: string;
  name: string;
  completed: number;
  total: number;
  quizCorrect: number;
  quizTotal: number;
  weakConcepts: string[];
};

export type TeacherConcept = {
  id: string;
  name: string;
  incorrect: number;
  attempts: number;
  helpCount: number;
};

export type TeacherCourse = {
  id: string;
  name: string;
  description: string;
  students: TeacherStudent[];
  concepts: TeacherConcept[];
};

export type TeacherMaterial = {
  id: string;
  courseId: string;
  name: string;
  text: string;
  addedAt: number;
};

export type TeacherAssignment = {
  id: string;
  courseId: string;
  title: string;
  kind: 'quiz' | 'assignment';
  sourceNames: string[];
  content: string;
  createdAt: number;
};

export type CurriculumWeek = {
  id: string;
  week: number;
  title: string;
  goal: string;
  activity: string;
};

// 교수자 화면의 사용 흐름을 보여 주는 가상 수업·학생 데이터입니다.
export const TEACHER_COURSES: TeacherCourse[] = [
  {
    id: 'data-structures',
    name: '자료구조',
    description: '자료 구성과 문제 해결의 기초',
    students: [
      { id: 'ds-1', name: '학생 1', completed: 10, total: 12, quizCorrect: 17, quizTotal: 20, weakConcepts: ['시간 복잡도'] },
      { id: 'ds-2', name: '학생 2', completed: 8, total: 12, quizCorrect: 14, quizTotal: 20, weakConcepts: ['트리 순회'] },
      { id: 'ds-3', name: '학생 3', completed: 5, total: 12, quizCorrect: 9, quizTotal: 20, weakConcepts: ['시간 복잡도', '재귀'] },
      { id: 'ds-4', name: '학생 4', completed: 12, total: 12, quizCorrect: 19, quizTotal: 20, weakConcepts: [] },
      { id: 'ds-5', name: '학생 5', completed: 7, total: 12, quizCorrect: 12, quizTotal: 20, weakConcepts: ['트리 순회', '재귀'] },
      { id: 'ds-6', name: '학생 6', completed: 4, total: 12, quizCorrect: 10, quizTotal: 20, weakConcepts: ['시간 복잡도', '스택과 큐'] },
    ],
    concepts: [
      { id: 'complexity', name: '시간 복잡도', incorrect: 16, attempts: 30, helpCount: 9 },
      { id: 'tree', name: '트리 순회', incorrect: 10, attempts: 30, helpCount: 6 },
      { id: 'recursion', name: '재귀', incorrect: 8, attempts: 30, helpCount: 5 },
      { id: 'stack-queue', name: '스택과 큐', incorrect: 5, attempts: 30, helpCount: 2 },
    ],
  },
  {
    id: 'ai-basics',
    name: '인공지능 기초',
    description: '모델 학습과 성능 평가의 기초',
    students: [
      { id: 'ai-1', name: '학생 1', completed: 8, total: 10, quizCorrect: 13, quizTotal: 16, weakConcepts: ['과적합'] },
      { id: 'ai-2', name: '학생 2', completed: 6, total: 10, quizCorrect: 10, quizTotal: 16, weakConcepts: ['정밀도와 재현율'] },
      { id: 'ai-3', name: '학생 3', completed: 3, total: 10, quizCorrect: 7, quizTotal: 16, weakConcepts: ['과적합', '손실 함수'] },
      { id: 'ai-4', name: '학생 4', completed: 10, total: 10, quizCorrect: 15, quizTotal: 16, weakConcepts: [] },
      { id: 'ai-5', name: '학생 5', completed: 7, total: 10, quizCorrect: 11, quizTotal: 16, weakConcepts: ['정밀도와 재현율'] },
      { id: 'ai-6', name: '학생 6', completed: 5, total: 10, quizCorrect: 8, quizTotal: 16, weakConcepts: ['손실 함수', '지도 학습'] },
    ],
    concepts: [
      { id: 'overfitting', name: '과적합', incorrect: 12, attempts: 24, helpCount: 8 },
      { id: 'metrics', name: '정밀도와 재현율', incorrect: 10, attempts: 24, helpCount: 6 },
      { id: 'loss', name: '손실 함수', incorrect: 6, attempts: 24, helpCount: 4 },
      { id: 'supervised', name: '지도 학습', incorrect: 4, attempts: 24, helpCount: 2 },
    ],
  },
];

const safeCount = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const boundedCount = (value: number, total: number) => Math.min(safeCount(value), safeCount(total));
const percent = (value: number, total: number) => total > 0 ? Math.round(value / total * 100) : 0;

export function calculateTeacherStats(course: TeacherCourse) {
  const totalUnits = course.students.reduce((sum, student) => sum + safeCount(student.total), 0);
  const completedUnits = course.students.reduce((sum, student) => sum + boundedCount(student.completed, student.total), 0);
  const totalQuizAttempts = course.students.reduce((sum, student) => sum + safeCount(student.quizTotal), 0);
  const correctAnswers = course.students.reduce((sum, student) => sum + boundedCount(student.quizCorrect, student.quizTotal), 0);

  return {
    studentCount: course.students.length,
    // 학습 단위·응답 수로 가중하여 전체 수업의 진도와 정답률을 집계합니다.
    averageProgress: percent(completedUnits, totalUnits),
    quizAccuracy: percent(correctAnswers, totalQuizAttempts),
    totalQuizAttempts,
    studentsNeedingHelp: course.students.filter(student =>
      (student.total > 0 && boundedCount(student.completed, student.total) / student.total < 0.5)
      || (student.quizTotal > 0 && boundedCount(student.quizCorrect, student.quizTotal) / student.quizTotal < 0.6),
    ).length,
    totalHelpRequests: course.concepts.reduce((sum, concept) => sum + safeCount(concept.helpCount), 0),
    concepts: course.concepts.map(concept => ({
      ...concept,
      incorrectRate: percent(boundedCount(concept.incorrect, concept.attempts), safeCount(concept.attempts)),
    })).sort((a, b) => b.incorrectRate - a.incorrectRate || b.helpCount - a.helpCount),
  };
}

const SAMPLE_TEXTS: Record<string, { name: string; text: string }[]> = {
  'data-structures': [
    {
      name: '[예시] 자료구조 1주차.txt',
      text: '# 스택과 큐\n스택은 가장 나중에 넣은 데이터를 먼저 꺼내는 LIFO 구조입니다. 큐는 먼저 넣은 데이터를 먼저 꺼내는 FIFO 구조입니다.\n\n# 시간 복잡도\n시간 복잡도는 입력 크기가 커질 때 연산 횟수가 어떻게 증가하는지 나타냅니다. 배열의 모든 원소를 한 번씩 확인하는 순회는 O(n)입니다.',
    },
    {
      name: '[예시] 자료구조 2주차.txt',
      text: '# 재귀\n재귀 함수는 문제를 작은 같은 형태의 문제로 나누고 자기 자신을 호출합니다. 종료 조건이 필요합니다.\n\n# 트리 순회\n이진 트리의 전위 순회는 루트, 왼쪽 부분 트리, 오른쪽 부분 트리 순서입니다. 중위 순회는 왼쪽, 루트, 오른쪽 순서입니다.',
    },
  ],
  'ai-basics': [
    {
      name: '[예시] 인공지능 1주차.txt',
      text: '# 지도 학습\n지도 학습은 입력과 정답이 짝지어진 데이터로 예측 규칙을 학습합니다. 분류와 회귀가 대표적인 과제입니다.\n\n# 손실 함수\n손실 함수는 모델의 예측과 정답 사이의 차이를 수치로 나타냅니다. 학습은 이 손실을 줄이는 방향으로 모델을 조정합니다.',
    },
    {
      name: '[예시] 인공지능 2주차.txt',
      text: '# 과적합\n과적합은 학습 데이터에는 잘 맞지만 새로운 데이터에서 성능이 떨어지는 현상입니다. 검증 데이터를 사용해 일반화 성능을 확인합니다.\n\n# 정밀도와 재현율\n정밀도는 양성으로 예측한 사례 중 실제 양성의 비율입니다. 재현율은 실제 양성 사례 중 양성으로 예측한 비율입니다.',
    },
  ],
};

export function createTeacherSampleMaterials(courseId: string): TeacherMaterial[] {
  return (SAMPLE_TEXTS[courseId] ?? []).map((material, index) => ({
    ...material,
    id: `sample-${courseId}-${index + 1}`,
    courseId,
    addedAt: 0,
  }));
}

type DraftTopic = { title: string; source: string };

function materialTopics(material: TeacherMaterial): DraftTopic[] {
  const source = material.name.trim() || '이름 없는 강의 자료';
  const lines = material.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headings = lines.filter(line => /^#{1,6}\s+/.test(line));
  const candidates = headings.length ? headings : lines.filter(line => line.length <= 80 && !/[.!?。]$/.test(line));
  const titles = [...new Set(candidates.map(line => line.replace(/^#{1,6}\s+/, '').replace(/^[-*•]\s+/, '').trim()).filter(Boolean))];
  const fallback = lines[0]?.replace(/^#{1,6}\s+/, '').slice(0, 70)
    || source.replace(/\.[^.]+$/, '');
  return (titles.length ? titles.slice(0, 20) : [fallback]).map(title => ({ title, source }));
}

// 자료별 주제를 번갈아 배치하여 앞쪽 자료에만 초안이 편중되지 않도록 합니다.
function draftTopics(materials: TeacherMaterial[]): DraftTopic[] {
  const groups = materials.map(materialTopics);
  const topics: DraftTopic[] = [];
  const depth = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < depth; index += 1) {
    groups.forEach(group => { if (group[index]) topics.push(group[index]); });
  }
  return topics;
}

function draftAmount(value: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;
}

const DRAFT_PROMPTS = {
  quiz: {
    normal: [
      '핵심 개념을 자신의 말로 설명하세요.',
      '적용할 수 있는 예시를 하나 들고 이유를 설명하세요.',
      '학습할 때 혼동하기 쉬운 점을 짚고 올바르게 설명하세요.',
      '관련된 개념 하나를 고르고 공통점과 차이점을 설명하세요.',
      '이 개념이 필요한 상황과 필요하지 않은 상황을 비교하세요.',
      '문제에 적용하는 과정을 단계별로 설명하세요.',
      '성립에 필요한 조건 하나를 고르고 그 이유를 설명하세요.',
      '활용했을 때의 장점과 한계를 각각 설명하세요.',
      '잘못 적용한 예시를 만들고 어떻게 수정해야 하는지 설명하세요.',
      '이해 여부를 확인할 질문을 하나 만들고 답의 근거를 설명하세요.',
    ],
    easy: [
      '뜻을 쉬운 말로 한 문장으로 써보세요.',
      '쉬운 예시를 하나 들어보세요.',
      '헷갈렸던 점 하나와 알게 된 점을 써보세요.',
      '함께 배운 개념 하나를 떠올려 이름을 써보세요.',
      '어떤 상황에서 도움이 되는지 써보세요.',
      '설명하는 순서를 두세 단계로 나누어 써보세요.',
      '꼭 기억해야 할 특징 하나를 써보세요.',
      '좋은 점 하나를 자신의 말로 써보세요.',
      '틀리게 설명한 문장 하나를 만들고 바르게 고쳐보세요.',
      '친구에게 물어볼 짧은 질문 하나와 답을 써보세요.',
    ],
  },
  assignment: {
    normal: [
      '핵심 개념을 요약하고 직접 만든 예시를 제시하세요.',
      '개념을 활용하는 작은 문제를 만들고 풀이 과정을 작성하세요.',
      '흔한 오해를 하나 선정하고 근거를 들어 바로잡는 설명을 작성하세요.',
      '관련 개념을 연결하는 개념도를 만들고 관계를 설명하세요.',
      '서로 다른 두 활용 사례를 비교하는 표를 작성하세요.',
      '처음 배우는 사람을 위한 단계별 학습 안내서를 작성하세요.',
      '적용이 어려운 상황을 제시하고 보완 방법을 제안하세요.',
      '작은 실습을 설계하고 예상 결과와 확인 방법을 작성하세요.',
      '자기 점검 문항 세 개와 각 문항의 해설을 작성하세요.',
      '토론할 질문 하나를 정하고 두 가지 관점과 자신의 결론을 정리하세요.',
    ],
    easy: [
      '핵심 내용을 세 줄로 요약하고 쉬운 예시 하나를 써보세요.',
      '간단한 문제 하나를 만들고 답을 써보세요.',
      '헷갈렸던 내용을 잘못된 설명과 바른 설명으로 나누어 써보세요.',
      '중요한 낱말 세 개를 골라 그림이나 화살표로 연결해 보세요.',
      '예시 두 개를 골라 같은 점과 다른 점을 표로 정리해 보세요.',
      '친구가 따라 할 수 있도록 세 단계의 설명을 만들어 보세요.',
      '더 알고 싶은 점 하나를 고르고 확인할 방법을 써보세요.',
      '직접 해볼 수 있는 작은 활동 하나와 예상 결과를 써보세요.',
      '복습 질문 두 개를 만들고 짧은 답을 써보세요.',
      '친구와 이야기할 질문 하나와 자신의 생각을 써보세요.',
    ],
  },
};

export function buildAssignmentDraft(
  materials: TeacherMaterial[],
  kind: TeacherAssignment['kind'],
  count: number,
  difficulty: string,
): string {
  if (!materials.length) return '';
  const topics = draftTopics(materials);
  const amount = draftAmount(count, 20, 5);
  const level = difficulty.trim() || '보통';
  const prompts = DRAFT_PROMPTS[kind][/쉬움|기초|기본/.test(level) ? 'easy' : 'normal'];
  const tasks = Array.from({ length: amount }, (_, index) => {
    const topic = topics[index % topics.length];
    const extension = /심화|어려움|상급/.test(level) ? ' 조건을 바꾸었을 때의 차이도 분석하세요.' : '';
    const repeatGuidance = index >= prompts.length ? ' 앞선 답변과 다른 예시를 사용하세요.' : '';
    return `${index + 1}. 「${topic.title}」에 대해 ${prompts[index % prompts.length]}${extension}${repeatGuidance}\n   출처: ${topic.source}\n   ${kind === 'quiz' ? '정답·해설' : '제출 형식·평가 기준'}: [교수자가 검토 후 작성]`;
  });
  const excerpts = materials.map(material => {
    const excerpt = material.text.replace(/\s+/g, ' ').trim().slice(0, 180);
    return `- ${material.name.trim() || '이름 없는 강의 자료'}: ${excerpt || '본문 없이 파일명을 주제로 구성했습니다.'}`;
  });

  return [
    `[템플릿 초안 · 교수자 검토 필요]`,
    `${kind === 'quiz' ? '퀴즈' : '과제'} · ${amount}개 항목 · 난이도 ${level}`,
    '자료의 제목과 문장을 이용해 구성한 편집용 초안입니다. 문항의 적절성과 정답·평가 기준을 확인해 주세요.',
    '',
    '참고 자료',
    ...excerpts,
    '',
    ...tasks.flatMap(task => [task, '']),
  ].join('\n').trim();
}

export function buildCurriculumDraft(materials: TeacherMaterial[], weeks: number): CurriculumWeek[] {
  if (!materials.length) return [];
  const topics = draftTopics(materials);
  return Array.from({ length: draftAmount(weeks, 16, 4) }, (_, index) => {
    const topic = topics[index % topics.length];
    const review = index >= topics.length;
    return {
      id: `week-${index + 1}`,
      week: index + 1,
      title: `${topic.title}${review ? ' · 복습과 적용' : ''}`,
      goal: `「${topic.title}」의 ${review ? '핵심 개념을 연결하고 새로운 예시에 적용해요.' : '핵심 개념을 이해하고 자신의 말로 설명해요.'}`,
      activity: `${topic.source} 읽기 → ${review ? '응용 문제 풀이와 동료 피드백' : '예시 토론과 짧은 이해 확인'} → 어려웠던 점 함께 정리`,
    };
  });
}
