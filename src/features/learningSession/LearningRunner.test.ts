// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('../../services/courses', () => ({ fetchCourses: async () => [{ id: 'course', name: '테스트 과목' }] }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: async () => [] }));
vi.mock('../../services/learningSessions', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/learningSessions')>(), learningRequest: request,
}));
import LearningSession from '../../pages/LearningSession';
import { LearningApiError, draftKey, type LearningSession as Session } from '../../services/learningSessions';
let root: Root;
let container: HTMLDivElement;
let response: Session;
const standard = ['pause', 'finish', 'abandon'];
function state(phase = 'recall_answering'): Session {
  return { id: 'session', course_id: 'course', material_id: 'material', material_name: '강의 자료.pdf', status: 'active',
    revision: 1, target_minutes: 15, concept_count: 2, completed_count: 0, source_changed: false, result: [], operation: null,
    allowed_actions: [...standard, ...(phase.endsWith('answering') ? ['submit', 'help', 'skip', ...(phase === 'recall_answering' ? ['unknown'] : [])] : ['advance', 'help'])],
    current: { id: 'item-1', title: '개념 하나', position: 0, phase, revision: 1, question: '핵심 원리를 설명해 주세요.', draft: '',
      introduction: null, help: {}, feedback: null, evaluation_error: false, self_check: null, reported: false, check: null, check_result: null } };
}
function next(value: Session) { value.revision = response.revision + 1; response = value; }
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(b => b.textContent === label);
  expect(found, label).toBeTruthy(); return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function poll() { await act(async () => vi.advanceTimersByTimeAsync(1500)); }
async function type(text: string) {
  await act(async () => {
    const input = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render(value: Session) {
  response = value;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/learn/session'] },
    h(Routes, null, h(Route, { path: '/learn/:sessionId', element: h(LearningSession) }),
      h(Route, { path: '/', element: h('p', null, '대시보드 도착') }),
      h(Route, { path: '/summary', element: h('p', null, '자료 상세 도착') })))));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); sessionStorage.clear();
  request.mockReset(); request.mockImplementation(async () => structuredClone(response));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('runs preparation, recall, feedback, hints, check, next concept and results', async () => {
  const preparing = state(); preparing.status = 'preparing'; preparing.current = null; preparing.allowed_actions = ['abandon'];
  preparing.operation = { id: 'op', kind: 'prepare', status: 'running', retryable: false, error_code: null }; await render(preparing);
  expect(container.textContent).toContain('개념 준비 중'); expect(container.querySelector('textarea')).toBeNull();
  next(state()); await poll(); expect(button('설명 제출').disabled).toBe(true); await type('내 설명입니다.');
  const evaluating = state('recall_evaluating'); evaluating.allowed_actions = standard; evaluating.current!.draft = '내 설명입니다.';
  evaluating.operation = { id: 'eval', kind: 'evaluate', status: 'running', retryable: false, error_code: null };
  next(evaluating); await click('설명 제출');
  expect(request.mock.calls.at(-1)?.[2]).toMatchObject({ kind: 'recall', answer: '내 설명입니다.' });
  expect(container.textContent).toContain('설명 평가 중');
  const feedback = state('recall_feedback'); feedback.current!.draft = '내 설명입니다.';
  feedback.current!.feedback = { criteria: [{ criterion_id: 'criterion', status: 'missing', student_quote: '', reason: '원인 설명이 빠졌어요.', source_refs: [{ unit_id: 'u0', quote: '원문 근거' }] }] };
  next(feedback); await poll(); expect(container.textContent).toContain('빠짐');
  expect(container.textContent).not.toContain('모범 설명');
  const help = structuredClone(response); help.current!.help.hint1 = '첫 단계 힌트입니다.'; next(help); await click('첫 힌트');
  expect(container.textContent).toContain('첫 단계 힌트입니다.'); expect(button('다음 힌트').disabled).toBe(false);
  const hint2 = structuredClone(response); hint2.current!.help.hint2 = '두 번째 힌트입니다.'; next(hint2); await click('다음 힌트');
  expect(button('모범 설명').disabled).toBe(false);
  const check = state('check_answering'); check.current!.check = { question: '표현을 바꾼 문제', options: ['보기 하나', '보기 둘'] };
  next(check); await click('확인 문제 풀기 →'); expect(container.textContent).not.toContain('빠짐'); expect(button('답안 제출').disabled).toBe(true);
  await act(async () => (container.querySelector('input[name="check"][value="1"]') as HTMLInputElement).click());
  const checked = structuredClone(response); checked.current!.phase = 'check_feedback'; checked.allowed_actions = [...standard, 'advance', 'help'];
  checked.current!.check_result = { selected: 1, answer_index: 1, correct: true, explanation: '정답 해설입니다.' }; next(checked); await click('답안 제출');
  expect(container.textContent).toContain('정답이에요.');
  const second = state(); second.current!.id = 'item-2'; second.current!.title = '개념 둘'; second.current!.position = 1; second.completed_count = 1;
  next(second); await click('다음 개념 →'); expect(container.textContent).toContain('개념 둘'); expect(button('설명 제출').disabled).toBe(true);
  const complete = state(); complete.status = 'completed'; complete.current = null; complete.completed_count = 2; complete.allowed_actions = [];
  complete.result = [{ title: '개념 하나', recall: 'needs_review', check: 'correct', assisted: true, prior_instruction: true, repeated: false, reported: false },
    { title: '개념 둘', recall: 'ungraded', check: 'ungraded', assisted: false, prior_instruction: false, repeated: false, reported: false, skipped: true }];
  next(complete); await click('이 개념 건너뛰기'); expect(container.textContent).toContain('학습 결과');
  expect(container.textContent).toContain('도움 사용'); expect(container.textContent).toContain('건너뜀'); expect(container.querySelector('textarea')).toBeNull();
});

it('separates first reading from recall, remembers it on reload, and hides it in the check', async () => {
  const fresh = state(); fresh.current!.introduction = '먼저 읽는 개념 설명'; await render(fresh);
  expect(container.querySelector('textarea')).toBeNull(); expect(container.textContent).toContain('먼저 읽는 개념 설명');
  await click('직접 설명하기 →'); expect(container.querySelector('textarea')).not.toBeNull(); expect(container.textContent).not.toContain('먼저 읽는 개념 설명');
  expect(sessionStorage.getItem('tongkk:learning-introduction:user:session:item-1')).toBe('read');
  await act(async () => root.unmount()); root = createRoot(container); await render(fresh);
  expect(container.querySelector('textarea')).not.toBeNull();
  const feedback = state('recall_feedback'); feedback.current!.introduction = '먼저 읽는 개념 설명'; next(feedback);
  // Remount to load this persisted server stage without introducing a test-only refresh button.
  await act(async () => root.unmount()); root = createRoot(container); await render(feedback);
  const check = state('check_answering'); check.current!.introduction = '먼저 읽는 개념 설명'; check.current!.check = { question: '기초 확인 질문', options: ['A', 'B'] }; next(check);
  await click('확인 문제 풀기 →'); expect(container.textContent).not.toContain('먼저 읽는 개념 설명'); expect(container.textContent).toContain('기초 확인 질문');
});

it('pauses and resumes at the saved answer screen', async () => {
  const initial = state(); initial.current!.draft = '저장한 설명'; await render(initial);
  await act(async () => (container.querySelector('.learning-session-menu > summary') as HTMLElement).click());
  const paused = structuredClone(response); paused.status = 'paused'; paused.allowed_actions = ['resume', 'finish', 'abandon']; next(paused); await click('저장하고 잠시 중단');
  expect(container.textContent).toContain('학습을 잠시 멈췄어요'); expect(container.querySelector('textarea')).toBeNull();
  const resumed = state(); resumed.current!.draft = '저장한 설명'; next(resumed); await click('이어서 학습 →'); expect(container.querySelector('textarea')?.value).toBe('저장한 설명');
});

it('shows help immediately and reveals the source with one click, without an accordion', async () => {
  await render(state());
  const help = container.querySelector('[aria-label="도움 받기"]')!;
  expect(help.querySelector('details')).toBeNull();
  expect(button('첫 힌트').disabled).toBe(false);
  const source = structuredClone(response); source.current!.help.source = '확인할 원문 근거입니다.'; next(source);
  await click('관련 원문 보기');
  expect(request.mock.calls.at(-1)?.[2]).toMatchObject({ help_type: 'source', item_id: 'item-1' });
  expect(help.querySelector('[aria-label="원문 근거"]')?.textContent).toContain('확인할 원문 근거입니다.');
  expect(help.querySelector('[aria-label="원문 근거"]')?.querySelector('details')).toBeNull();
});

it('lets a failed evaluation use reference and self check without claiming AI grading', async () => {
  const failed = state('recall_feedback'); failed.current!.evaluation_error = true; failed.allowed_actions.push('self_check'); await render(failed);
  expect(container.textContent).toContain('오답으로 처리하지 않았어요');
  const reference = structuredClone(response); reference.current!.help.reference = '모범 설명 본문'; next(reference); await click('모범 설명');
  const self = structuredClone(response); self.current!.phase = 'repair'; self.current!.self_check = 'needs_review'; next(self); await click('추가 확인이 필요해요');
  expect(container.textContent).toContain('AI 평가와 별도로'); expect(request.mock.calls.at(-1)?.[2]).toMatchObject({ action: 'self_check', self_check: 'needs_review' });
});

it('retries failed preparation and ambiguous commands without losing the request identity', async () => {
  const failed = state(); failed.status = 'failed'; failed.current = null; failed.allowed_actions = ['abandon'];
  failed.operation = { id: 'prep', kind: 'prepare', status: 'failed', retryable: true, error_code: 'GENERATION_FAILED' }; await render(failed);
  request.mockRejectedValueOnce(new LearningApiError('일시적인 서버 오류', 503, 'UNAVAILABLE')); await click('준비 다시 시도');
  const first = request.mock.calls.at(-1)!; expect(button('준비 다시 시도').disabled).toBe(true);
  next(state()); await click('이전 요청 결과 다시 확인'); expect(request.mock.calls.at(-1)).toEqual(first); expect(container.querySelector('textarea')).not.toBeNull();
});

it('flushes the answer before opening the same material and blocks navigation if saving fails', async () => {
  await render(state()); await type('이동 전에 저장할 내용');
  request.mockRejectedValueOnce(new LearningApiError('저장할 수 없어요', 503, 'UNAVAILABLE'));
  const material = () => [...container.querySelectorAll('a')].find(a => a.textContent === '선택한 자료 보기 ↗')!;
  expect(material().getAttribute('href')).toBe('/summary?course=' + encodeURIComponent('테스트 과목').replaceAll('%20', '+') + '&material=material&view=material');
  await act(async () => material().click()); expect(container.textContent).toContain('저장할 수 없어요'); expect(container.querySelector('textarea')?.value).toBe('이동 전에 저장할 내용');
  expect(localStorage.getItem(draftKey('user', 'session', 'item-1'))).toContain('이동 전에 저장할 내용');
  const saved = structuredClone(response); saved.current!.draft = '이동 전에 저장할 내용'; saved.current!.revision++; next(saved);
  await act(async () => material().click()); expect(container.textContent).toContain('자료 상세 도착');
  expect(request.mock.calls.at(-1)?.[1]).toBe('PATCH');
});

it('shows a distinct result action for the final concept and focuses each new stage', async () => {
  const last = state('check_feedback'); last.current!.position = 1; last.current!.check = { question: '마지막 문제', options: ['A', 'B'] };
  last.current!.check_result = { selected: 0, answer_index: 0, correct: true, explanation: '맞아요' }; await render(last);
  expect(button('결과 보기 →').disabled).toBe(false); expect(document.activeElement).toBe(container.querySelector('h1'));
  expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('기초 확인');
});


it('uses the current stage as the title and shows the correct option once', async () => {
  const checked = state('check_feedback');
  checked.current!.check = { question: '어떤 단원인가요?', options: ['판다스 데이터 처리', '데이터베이스 설치'] };
  checked.current!.check_result = { selected: 0, answer_index: 0, correct: true, explanation: '목차의 시간 인덱스·그룹화·결측값 처리가 근거예요.' };
  await render(checked);
  expect(container.querySelector('h1')?.textContent).toBe('기초 확인');
  expect(container.textContent).not.toContain('내 속도에 맞춰');
  expect(container.textContent).toContain('정답이에요.');
  expect(container.textContent?.match(/판다스 데이터 처리/g)).toHaveLength(1);
  expect(container.querySelector('.learning-option.is-correct')?.textContent).toContain('판다스 데이터 처리정답');
  expect(container.querySelector('.learning-explanation')).toBeNull();
});

it('marks an incorrect choice separately and preserves old long explanations behind a disclosure', async () => {
  const checked = state('check_feedback');
  checked.current!.check = { question: '어떤 단원인가요?', options: ['판다스 데이터 처리', '데이터베이스 설치'] };
  const long = '자세한 근거와 조건을 설명하는 이전 해설입니다. '.repeat(10);
  checked.current!.check_result = { selected: 1, answer_index: 0, correct: false, explanation: long };
  await render(checked);
  expect(container.textContent).toContain('다시 확인해요.');
  expect(container.querySelector('.learning-option.is-correct')?.textContent).toContain('판다스 데이터 처리');
  expect(container.querySelector('.learning-option.is-incorrect')?.textContent).toContain('데이터베이스 설치내 선택');
  const disclosure = container.querySelector('.learning-explanation') as HTMLDetailsElement;
  expect(disclosure.open).toBe(false);
  await act(async () => disclosure.querySelector('summary')!.click());
  expect(disclosure.open).toBe(true);
  expect(disclosure.querySelector('p')?.textContent).toBe(long.trim());
});

it('keeps feedback evidence collapsed and preserves exact student and source quotes', async () => {
  const feedback = state('recall_feedback');
  feedback.current!.feedback = { criteria: [{ criterion_id: 'c1', status: 'contradicted', student_quote: '내가 쓴 원래 문장',
    reason: '시간 간격을 두는 방식으로 수정해 주세요.', source_refs: [{ unit_id: 'u0', quote: '원문의 조건과 수식 t > 0' }] }] };
  await render(feedback);
  expect(container.textContent).toContain('수정 필요');
  const evidence = container.querySelector('.learning-feedback-evidence') as HTMLDetailsElement;
  expect(evidence.open).toBe(false);
  await act(async () => evidence.querySelector('summary')!.click());
  expect(evidence.open).toBe(true);
  expect(evidence.textContent).toContain('내가 쓴 원래 문장'); expect(evidence.textContent).toContain('원문의 조건과 수식 t > 0');
});
