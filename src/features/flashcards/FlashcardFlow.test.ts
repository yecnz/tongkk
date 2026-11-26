// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Flashcard } from '../../services/flashcards';

const state = vi.hoisted(() => ({ cards: [] as Flashcard[], rpc: vi.fn(), from: vi.fn(), lostSave: false }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('../../services/supabase', () => ({ requireSupabaseUser: async () => ({ id: 'owner' }),
  formatSupabaseError: (error: { message: string }) => error.message, supabase: { rpc: state.rpc, from: state.from } }));
vi.mock('../../services/backend', () => ({ BACKEND_URL: '/api', getJsonRequestHeaders: async () => ({ Authorization: 'Bearer test', 'Content-Type': 'application/json' }), parseApiError: async () => '생성 실패' }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course', name: '운영체제' }] }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: async (_course: string, options?: { includeMarkdown: boolean }) =>
  [{ id: 'lecture', name: '1강.pdf', markdown: options?.includeMarkdown ? '<!-- p.2 -->프로세스는 실행 중인 프로그램이며 주소 공간과 실행 상태를 갖는다.' : '' }] }));
vi.mock('../../services/quizSets', () => ({ loadQuizSetsFromServer: async () => [{ id: 'quiz', questions: [
  { question: '프로세스란?', options: ['파일', '실행 중인 프로그램'], explanation: '실행 상태가 있어요. p.2' },
] }] }));
import Flashcards from './Flashcards';
import SaveWrongCard from './SaveWrongCard';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); state.cards = []; state.lostSave = false;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ cards: [{ front: '프로세스란?', back: '실행 중인 프로그램', source_page: 2 }] })));
  state.from.mockImplementation(() => ({
    select: () => ({ order: () => ({ limit: async () => ({ data: structuredClone(state.cards), error: null }) }) }),
    delete: () => ({ eq: async (_column: string, id: string) => { state.cards = state.cards.filter(c => c.id !== id); return { error: null }; } }),
  }));
  state.rpc.mockImplementation(async (name: string, data: Record<string, unknown>) => {
    if (name === 'study_flashcard_create') {
      let card = state.cards.find(c => c.origin_key === data.p_origin);
      if (!card) {
        card = { id: crypto.randomUUID(), course_id: String(data.p_course), material_id: data.p_material as string | null,
          front: String(data.p_front), back: String(data.p_back), source_page: data.p_page as number | null, origin_key: String(data.p_origin),
          due_at: '2026-01-01T00:00:00Z', interval_days: 0, ease: 2.5, reviews: 0, revision: 0, created_at: '2026-01-01T00:00:00Z' };
        state.cards.push(card);
      }
      if (state.lostSave) { state.lostSave = false; return { data: null, error: { message: '저장 응답 유실' } }; }
      return { data: structuredClone(card), error: null };
    }
    const card = state.cards.find(c => c.id === data.p_card)!;
    Object.assign(card, { due_at: '2099-01-01T00:00:00Z', reviews: card.reviews + 1, revision: card.revision + 1 });
    return { data: structuredClone(card), error: null };
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(page = '/flashcards') {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [page] }, h(Routes, null,
    h(Route, { path: '/flashcards', element: h(Flashcards) }),
    h(Route, { path: '/review', element: h(SaveWrongCard, { courseName: '운영체제', attemptId: 'attempt', questionIndex: 0,
      quizSetId: 'quiz', question: '프로세스란?', correctAnswer: 1, explanation: '기록된 해설', materialIds: ['lecture'] }) }),
    h(Route, { path: '/', element: h('p', null, '대시보드 화면') }),
  ))));
}
async function click(label: string, scope: ParentNode = container) {
  const button = [...scope.querySelectorAll('button')].find(b => b.textContent === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
async function tab(label: string) { await click(label, container.querySelector('nav[aria-label="암기 카드 보기"]')!); }
async function edit(index: number, value: string) {
  await act(async () => {
    const input = container.querySelectorAll('textarea')[index];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function draft() {
  await tab('카드 만들기');
  await act(async () => { const select = container.querySelectorAll('select')[1]; select.value = 'lecture'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('자료에서 카드 초안 만들기');
}

it('creates an edited AI card, reviews it, reopens the library and deletes only after confirmation', async () => {
  await render(); await draft(); await edit(0, '프로세스를 내 말로 설명하면?'); await click('카드 저장');
  const request = state.rpc.mock.calls[0][1];
  expect(request).toMatchObject({ p_course: 'course', p_material: 'lecture', p_front: '프로세스를 내 말로 설명하면?', p_page: 2 });
  expect(fetch).toHaveBeenCalledWith('/api/flashcards/generate', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer test' }) }));
  await tab('오늘 복습 1'); expect(container.textContent).not.toContain('실행 중인 프로그램');
  await click('답 확인하기'); expect(container.textContent).toContain('실행 중인 프로그램');
  const source = new URL(container.querySelector('a[href^="/source"]')!.getAttribute('href')!, 'https://test.local');
  expect(Object.fromEntries(source.searchParams)).toMatchObject({ material: 'lecture', page: '2' });
  await click('알겠음'); expect(container.textContent).toContain('지금 복습할 카드를 모두 확인했어요');
  await act(async () => root.unmount()); root = createRoot(container); await render();
  await tab('내 카드 1'); expect(container.textContent).toContain('1회 복습');
  await click('카드 삭제'); await click('취소'); expect(state.cards).toHaveLength(1);
  await click('카드 삭제'); await click('삭제 확인'); expect(state.cards).toHaveLength(0);
  expect(container.textContent).toContain('아직 저장한 카드가 없어요');
});

it('creates a manual card without attributing it to a source material', async () => {
  await render(); await tab('카드 만들기'); await click('직접 카드 추가');
  await edit(0, '질문'); await edit(1, '직접 쓴 답'); await click('카드 저장');
  expect(state.cards[0]).toMatchObject({ front: '질문', back: '직접 쓴 답', material_id: null, source_page: null });
});

it('recovers from failed AI generation without losing the selected material', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('일시적인 연결 실패'));
  await render(); await draft();
  expect(container.textContent).toContain('일시적인 연결 실패');
  expect(container.querySelectorAll('select')[1].value).toBe('lecture');
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  await click('자료에서 카드 초안 만들기');
  expect(container.querySelector('textarea')?.value).toBe('프로세스란?');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps the reload action available after switching tabs following a failed initial load', async () => {
  state.from.mockImplementationOnce(() => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: '카드 조회 실패' } }) }) }) }));
  await render(); await tab('카드 만들기');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('카드 조회 실패');
  await click('다시 불러오기');
  expect(container.querySelector('select')?.textContent).toContain('운영체제');
  expect(container.textContent).not.toContain('카드 조회 실패');
});

it('keeps an uncertain save immutable and retries the same content without duplicating the card', async () => {
  await render(); await draft(); state.lostSave = true; await click('카드 저장');
  expect(container.textContent).toContain('저장 응답 유실');
  expect([...container.querySelectorAll('textarea')].every(input => input.disabled)).toBe(true);
  await click('저장 다시 확인');
  expect(state.rpc.mock.calls[1]).toEqual(state.rpc.mock.calls[0]);
  expect(state.cards).toHaveLength(1); expect(container.textContent).toContain('저장됨');
});

it('saves a wrong answer with its actual option text and continues to the review queue', async () => {
  await render('/review'); state.lostSave = true; await click('암기 카드로 저장');
  expect(container.textContent).toContain('저장 응답 유실');
  await click('암기 카드로 저장'); expect(state.cards).toHaveLength(1);
  expect(state.cards[0]).toMatchObject({ back: '정답: 실행 중인 프로그램\n\n실행 상태가 있어요. p.2', material_id: 'lecture', source_page: 2, origin_key: 'wrong:attempt:0' });
  await act(async () => container.querySelector('a')!.click());
  expect(container.querySelector('[aria-label="복습 카드"]')).not.toBeNull();
  await click('답 확인하기'); expect(container.textContent).toContain('정답: 실행 중인 프로그램');
});

it('preserves an unsaved draft when cancelling material changes or page navigation', async () => {
  await render(); await draft(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => { const select = container.querySelectorAll('select')[1]; select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelectorAll('select')[1].value).toBe('lecture');
  expect(container.querySelector('textarea')?.value).toBe('프로세스란?');
  await act(async () => (container.querySelector('.learning-header-back') as HTMLAnchorElement).click());
  expect(container.textContent).toContain('카드 초안을 확인하고 저장');
  expect(container.textContent).not.toContain('대시보드 화면');
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockReturnValue(true);
  await act(async () => (container.querySelector('.learning-header-back') as HTMLAnchorElement).click());
  expect(container.textContent).toContain('대시보드 화면');
});

it('protects a hidden draft when following the wrong-answer link from the empty review queue', async () => {
  await render(); await draft(); await tab('오늘 복습 0');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => (container.querySelector('a[href="/review?tab=wrong"]') as HTMLAnchorElement).click());
  expect(confirm).toHaveBeenCalledOnce();
  await tab('카드 만들기'); expect(container.querySelector('textarea')?.value).toBe('프로세스란?');
});

it('protects a hidden draft while recovering a failed review response', async () => {
  state.cards = [{ id: 'older', course_id: 'course', material_id: null, front: '이전 카드', back: '이전 답', source_page: null,
    origin_key: 'old', due_at: '2026-01-01T00:00:00Z', interval_days: 0, ease: 2.5, reviews: 0, revision: 0, created_at: '' }];
  await render(); await draft(); await tab('오늘 복습 1'); await click('답 확인하기');
  state.rpc.mockResolvedValueOnce({ data: null, error: { message: '복습 응답 유실' } }); await click('알겠음');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false), loads = state.from.mock.calls.length;
  await click('최신 복습 상태 확인'); expect(confirm).toHaveBeenCalledOnce(); expect(state.from).toHaveBeenCalledTimes(loads);
  await click('알겠음 · 다시 저장'); await tab('카드 만들기');
  expect(container.querySelector('textarea')?.value).toBe('프로세스란?');
});
