// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SavedQuizAttemptWithCourse } from '../services/quizAttempts';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), user: { id: 'learner' }, toast: vi.fn(),
}));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../services/quizAttempts', () => ({ loadAllQuizAttemptsFromServer: mocks.load }));
vi.mock('../services/wrongAnswerAnalyses', () => ({ loadAllWrongAnswerAnalysesFromServer: async () => new Map(), saveWrongAnswerAnalysisToServer: vi.fn() }));
vi.mock('../services/quizSets', () => ({ loadQuizSetsFromServer: async () => [] }));
vi.mock('../features/learningSession/ReviewOverview', () => ({ default: () => null }));
vi.mock('../features/learningHistory/ConceptGraph', () => ({ default: () => null }));
vi.mock('../features/learningHistory/ConceptHistory', () => ({ default: () => null }));
vi.mock('../features/flashcards/SaveWrongCard', () => ({ default: () => null }));
vi.mock('../features/review/QuizIssueLink', () => ({ default: () => null }));

import Stats from './Stats';
import ReviewNotes from './ReviewNotes';

const attempt = (overrides: Partial<SavedQuizAttemptWithCourse> = {}): SavedQuizAttemptWithCourse => ({
  id: 'attempt', courseName: '수학', quizSetId: 'set', difficulty: '보통', questionType: '객관식',
  count: 5, correctCount: 4, scorePercent: 80, weakTopics: [], answers: [], durationSeconds: 300,
  timedOut: false, materialIds: [], createdAt: new Date('2026-01-02T12:00:00').getTime(), ...overrides,
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.load.mockReset().mockResolvedValue([]);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(component: typeof Stats | typeof ReviewNotes) {
  await act(async () => root.render(h(MemoryRouter, null, h(component))));
}

it('does not present zero scores or an empty history while statistics are loading', async () => {
  let resolve!: (rows: SavedQuizAttemptWithCourse[]) => void;
  mocks.load.mockImplementation(() => new Promise<SavedQuizAttemptWithCourse[]>(done => { resolve = done; }));
  await render(Stats);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('불러오는 중');
  expect(container.textContent).not.toContain('평균 점수');
  expect(container.textContent).not.toContain('아직 풀이 기록이');
  await act(async () => resolve([attempt()]));
  expect(container.textContent).toContain('평균 점수');
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('keeps a statistics error visible and retries without pretending there are no records', async () => {
  mocks.load.mockRejectedValueOnce(new Error('연결을 확인해 주세요')).mockResolvedValueOnce([attempt()]);
  await render(Stats);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('연결을 확인해 주세요');
  expect(container.textContent).not.toContain('아직 풀이 기록이');
  const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '다시 불러오기')!;
  await act(async () => retry.click());
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('평균 점수');
});

it('aligns trend dots with their corresponding bars and date labels', async () => {
  mocks.load.mockResolvedValue([
    attempt({ id: 'a', scorePercent: 100 }),
    attempt({ id: 'b', scorePercent: 40, createdAt: new Date('2026-01-01T12:00:00').getTime() }),
  ]);
  await render(Stats);
  const chart = container.querySelector('svg[role="img"]')!;
  const bars = Array.from(chart.querySelectorAll('rect'));
  const dots = Array.from(chart.querySelectorAll('circle'));
  expect(dots).toHaveLength(2);
  dots.forEach((dot, index) => {
    const bar = bars[index];
    const middle = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(middle);
    expect(Number(bar.parentElement!.querySelector('text')!.getAttribute('x'))).toBeCloseTo(middle);
    expect(middle).toBeGreaterThan(5);
    expect(middle).toBeLessThan(595);
  });
});

it('renders generated math in wrong answers while preserving the learner answer as literal text', async () => {
  mocks.load.mockResolvedValue([attempt({ answers: [{
    question: '계산: $\\frac{1}{2}$', type: '단답형', studentAnswer: '$내 답$', correctAnswer: '$\\frac{2}{4}$',
    isCorrect: false, explanation: '**약분**하면 $\\frac{1}{2}$입니다.',
  }] })]);
  await render(ReviewNotes);
  expect(container.querySelectorAll('.review-question .katex').length).toBe(3);
  expect(container.querySelector('.review-answer-student')?.textContent).toContain('$내 답$');
  expect(container.querySelector('.review-explanation-text strong')?.textContent).toBe('약분');
});
