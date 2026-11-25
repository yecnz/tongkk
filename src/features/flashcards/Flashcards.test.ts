// @vitest-environment jsdom
import { act, createElement as h, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), rate: vi.fn(), generate: vi.fn(), save: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../learningSession/LearningLayout', () => ({ default: ({ children }: PropsWithChildren) => children }));
vi.mock('../learningSession/navigation', () => ({ useLearningNavigation: () => ({ beforeLeaveRef: { current: null }, go: vi.fn() }) }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course', name: '운영체제' }] }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: async () => [] }));
vi.mock('../../services/flashcards', async importOriginal => ({ ...await importOriginal<object>(), loadFlashcards: mocks.load, rateFlashcard: mocks.rate, generateFlashcards: mocks.generate, saveFlashcard: mocks.save }));
import Flashcards from './Flashcards';
let root: Root, container: HTMLDivElement;
const card = { id: 'card', course_id: 'course', front: '인출 질문', back: '숨겨진 정답', due_at: '2026-01-01T00:00:00Z', revision: 0, reviews: 0 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mocks.load.mockResolvedValue([card]);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(h(MemoryRouter, null, h(Flashcards)))); }
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
it('requires recall before showing the answer and records the selected rating', async () => {
  mocks.rate.mockResolvedValue({ ...card, revision: 1, due_at: '2099-01-01T00:00:00Z' });
  await render(); expect(container.textContent).not.toContain('숨겨진 정답');
  await click('답 확인하기'); expect(container.textContent).toContain('숨겨진 정답');
  await click('알겠음');
  expect(mocks.rate).toHaveBeenCalledWith(card, 'good', expect.any(String));
  expect(container.textContent).toContain('지금 복습할 카드를 모두 확인했어요');
});
it('retries a lost response with the same request key and rating', async () => {
  mocks.rate.mockRejectedValueOnce(new Error('연결 끊김')).mockResolvedValueOnce({ ...card, due_at: '2099-01-01T00:00:00Z' });
  await render(); await click('답 확인하기'); await click('어려움');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('연결 끊김');
  expect(Array.from(container.querySelectorAll('button')).find(item => item.textContent === '쉬움')?.disabled).toBe(true);
  await click('어려움 · 다시 저장');
  expect(mocks.rate.mock.calls[0]).toEqual(mocks.rate.mock.calls[1]);
});
it('makes a new question hidden after rating the previous card', async () => {
  mocks.load.mockResolvedValue([card, { ...card, id: 'second', front: '다음 질문', back: '두번째 답' }]);
  mocks.rate.mockResolvedValue({ ...card, due_at: '2099-01-01T00:00:00Z' });
  await render(); await click('답 확인하기'); await click('쉬움');
  expect(container.textContent).toContain('다음 질문');
  expect(container.textContent).not.toContain('두번째 답');
});
