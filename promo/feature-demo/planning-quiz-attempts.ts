import type { SavedQuizAttempt, SavedQuizAttemptWithCourse } from '../../src/services/quizAttempts';
export type { SavedQuizAttempt, SavedQuizAttemptWithCourse, QuizAttemptAnswer } from '../../src/services/quizAttempts';

const attempts: SavedQuizAttemptWithCourse[] = [90, 80, 70, 60, 70, 50].map((score, index) => ({
  id: `attempt-demo-${index}`, quizSetId: 'quiz-demo', courseName: '알고리즘', difficulty: '보통', questionType: '객관식', count: 10,
  correctCount: score / 10, scorePercent: score, weakTopics: score < 90 ? ['퀵 정렬의 최악 시간 복잡도'] : [],
  durationSeconds: 480 + index * 60, timedOut: false, materialIds: ['material-demo'],
  createdAt: Date.now() - index * 86400000,
  answers: [{ questionId: 'quick-worst', question: '퀵 정렬의 최악 시간 복잡도는?', type: '객관식', studentAnswer: index === 0 ? 2 : 1, correctAnswer: 2, isCorrect: index === 0,
    explanation: '피벗이 한쪽으로 치우치면 n + (n−1) + … + 1번 비교하여 O(n²)이 됩니다.' }],
}));
export async function loadAllQuizAttemptsFromServer(): Promise<SavedQuizAttemptWithCourse[]> { return structuredClone(attempts); }
export async function loadQuizAttemptsFromServer(course: string): Promise<SavedQuizAttempt[]> { return structuredClone(attempts.filter(item => item.courseName === course)); }
export async function saveQuizAttemptToServer(course: string, attempt: Omit<SavedQuizAttempt, 'id' | 'createdAt'>): Promise<SavedQuizAttempt> {
  const result = { ...attempt, id: crypto.randomUUID(), createdAt: Date.now(), courseName: course }; attempts.unshift(result); return structuredClone(result);
}
