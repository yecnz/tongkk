import type { SavedQuizAttempt, SavedQuizAttemptWithCourse } from './quizAttempts';

const toLocalDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export type ScorePoint = { date: string; scorePercent: number };
export type CoursePerformance = {
  courseName: string;
  attempts: number;
  averageScore: number;
  progressPercent: number;
  totalQuestions: number;
  totalMinutes: number;
  latestAt: number;
};

const WEAK_TOPIC_STOP_WORDS = new Set([
  '다음',
  '설명',
  '대한',
  '것은',
  '중에서',
  '무엇',
  '어느',
  '가장',
  '옳은',
  '아닌',
  '경우',
  '보기',
  '문제',
  '정답',
]);

const tidyTopic = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^(다음|아래|보기|문제)\s*(중|에서|은|는|의)?\s*/g, '')
    .replace(/\s+(은|는|이|가|을|를|으로|로|에|에서|중|대한|관한)$/g, '')
    .replace(/(에\s*대한|에\s*관한|에\s*따른)$/g, '')
    .trim();

const firstMeaningfulWords = (text: string, limit = 3) => {
  const words = text
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length >= 2 && !WEAK_TOPIC_STOP_WORDS.has(word));
  return words.slice(0, limit).join(' ');
};

const hasConceptSignal = (topic: string) =>
  /(정렬|탐색|자료구조|기억장치|주기억장치|보조기억장치|운영체제|프로세스|스레드|데이터베이스|트랜잭션|정규화|인덱스|네트워크|프로토콜|알고리즘|시간복잡도|공간복잡도|수행시간|액세스|읽기|쓰기|동작|곰팡이|세균|바이러스)/.test(topic);

export function normalizeWeakTopic(topic: string, context = ''): string {
  const source = `${topic} ${context}`.trim();
  const cleaned = tidyTopic(topic.replace(/[?!.,:;()[\]{}'"`]/g, ' '));
  const sourceCleaned = tidyTopic(source.replace(/[?!.,:;()[\]{}'"`]/g, ' '));
  if (!cleaned) return '';
  if (cleaned === '곰팡') return '곰팡이';

  const quoted = topic.match(/[「『"']([^」』"']{2,30})[」』"']/);
  if (quoted?.[1]) return tidyTopic(quoted[1]);

  const exactPatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/([가-힣A-Za-z0-9\s]{2,24}? 정렬)의 수행 시간/, match => match[1]],
    [/([가-힣A-Za-z0-9\s]{2,24}? 정렬)의 시간 복잡도/, match => `${match[1]} 시간복잡도`],
    [/(정렬)이 아주 나쁜 경우/, () => '정렬 최악 경우'],
    [/([가-힣A-Za-z0-9\s]{2,24}?)의 액세스 방법/, match => `${match[1]} 액세스 방법`],
    [/([가-힣A-Za-z0-9\s]{2,24}?)의 읽기 동작/, match => `${match[1]} 읽기 동작`],
    [/([가-힣A-Za-z0-9\s]{2,24}?)의 쓰기 동작/, match => `${match[1]} 쓰기 동작`],
  ];

  for (const [pattern, build] of exactPatterns) {
    const match = sourceCleaned.match(pattern);
    if (match) return tidyTopic(build(match));
  }

  const beforeKeyPhrase = sourceCleaned.match(/(.{2,34}?)(?:의\s*)?(수행 시간|시간 복잡도|공간 복잡도|액세스 방법|읽기 동작|쓰기 동작|탐색 방법|정렬 방식|자료구조)/);
  if (beforeKeyPhrase) {
    const subject = tidyTopic(beforeKeyPhrase[1]);
    const concept = beforeKeyPhrase[2].replace(/\s+/g, '');
    return subject ? `${subject} ${concept}` : concept;
  }

  const contextWords = firstMeaningfulWords(sourceCleaned, 4);
  if (hasConceptSignal(contextWords)) return tidyTopic(contextWords);

  const clause = cleaned.split(/\s+(?:은|는|이|가|으로|로|때|라면|일 때)\s*/)[0];
  const fallback = firstMeaningfulWords(clause || cleaned, 4);
  return tidyTopic(fallback || cleaned.slice(0, 24));
}

export function inferWeakTopicFromQuestion(question: string, context = ''): string {
  return normalizeWeakTopic(question, context);
}

export function scoreTrend(attempts: SavedQuizAttempt[]): ScorePoint[] {
  return [...attempts]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-12)
    .map(attempt => ({ date: toLocalDateKey(attempt.createdAt), scorePercent: attempt.scorePercent }));
}

export function studyStreak(attempts: SavedQuizAttempt[]): number {
  if (attempts.length === 0) return 0;
  const dateKeys = new Set(attempts.map(attempt => toLocalDateKey(attempt.createdAt)));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  // 오늘 아직 학습 기록이 없으면 어제부터 센다. 그래야 자정이 지나도(오늘 풀기 전)
  // 어제까지 쌓인 연속 기록이 0으로 초기화되지 않는다. 어제도 없으면 연속이 끊긴 것이라 0.
  if (!dateKeys.has(toLocalDateKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dateKeys.has(toLocalDateKey(cursor.getTime()))) return 0;
  }
  let streak = 0;
  while (dateKeys.has(toLocalDateKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function totalStudyMinutes(attempts: SavedQuizAttempt[]): number {
  const totalSeconds = attempts.reduce((sum, attempt) => sum + (attempt.durationSeconds ?? 0), 0);
  return Math.round(totalSeconds / 60);
}

export function averageScore(attempts: SavedQuizAttempt[]): number {
  if (attempts.length === 0) return 0;
  return Math.round(attempts.reduce((sum, attempt) => sum + attempt.scorePercent, 0) / attempts.length);
}

export function totalQuestionCount(attempts: SavedQuizAttempt[]): number {
  return attempts.reduce((sum, attempt) => sum + attempt.count, 0);
}

export function recentAttempts<T extends SavedQuizAttempt>(attempts: T[], limit = 5): T[] {
  return [...attempts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function coursePerformance(attempts: SavedQuizAttemptWithCourse[]): CoursePerformance[] {
  const grouped = new Map<string, SavedQuizAttemptWithCourse[]>();
  for (const attempt of attempts) {
    const rows = grouped.get(attempt.courseName) || [];
    rows.push(attempt);
    grouped.set(attempt.courseName, rows);
  }

  return [...grouped.entries()]
    .map(([courseName, rows]) => {
      const latestAt = Math.max(...rows.map(row => row.createdAt));
      const attemptsCount = rows.length;
      const questions = totalQuestionCount(rows);
      const scoreAverage = averageScore(rows);
      const daysSinceLatest = Math.max(0, (Date.now() - latestAt) / 86_400_000);
      const questionWeight = Math.min(questions / 30, 1) * 45;
      const attemptWeight = Math.min(attemptsCount / 5, 1) * 25;
      const recencyWeight = Math.max(0, 1 - daysSinceLatest / 14) * 20;
      const scoreWeight = (scoreAverage / 100) * 10;

      return {
        courseName,
        attempts: attemptsCount,
        averageScore: scoreAverage,
        progressPercent: Math.round(questionWeight + attemptWeight + recencyWeight + scoreWeight),
        totalQuestions: questions,
        totalMinutes: totalStudyMinutes(rows),
        latestAt,
      };
    })
    .sort((a, b) => b.latestAt - a.latestAt);
}
