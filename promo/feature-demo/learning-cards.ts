export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';
export type Flashcard = { id: string; course_id: string; material_id: string | null; front: string; back: string; source_page: number | null; origin_key: string; due_at: string; interval_days: number; ease: number; reviews: number; revision: number; created_at: string };
export type FlashcardDraft = Pick<Flashcard, 'course_id' | 'front' | 'back'> & Partial<Pick<Flashcard, 'material_id' | 'source_page' | 'origin_key'>>;
const copy = <T,>(value: T): T => structuredClone(value);
const seeds = [
  { front: '퀵 정렬의 평균 시간 복잡도와 최악 시간 복잡도는?', back: '평균 **O(n log n)**, 최악 **O(n²)**입니다. 피벗으로 나뉜 배열이 균형을 이룰수록 재귀 깊이가 작아집니다.', source_page: 1 },
  { front: '안정 정렬이 보존하는 것은?', back: '**같은 키를 가진 원소의 상대 순서**입니다. 이름순으로 정렬한 뒤 안정 정렬로 점수순으로 정렬하면 같은 점수 안에서 이름순이 유지됩니다.', source_page: 2 },
  { front: '선택 정렬이 이미 정렬된 배열에서도 O(n²)인 이유는?', back: '각 위치에 놓을 최솟값을 찾기 위해 남은 구간을 끝까지 비교합니다. 비교 횟수는 (n−1)+(n−2)+…+1입니다.', source_page: 2 },
];
let cards: Flashcard[] = [];
export function resetLearningCards() { cards = seeds.map((seed, i) => ({ ...seed, id: `flashcard-demo-${i}`, course_id: 'course-demo', material_id: 'material-demo', origin_key: `seed-${i}`, due_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(), interval_days: 1, ease: 2.5, reviews: i, revision: 1, created_at: new Date().toISOString() })); }
resetLearningCards();
export const loadFlashcards = async () => copy(cards);
export function dueFlashcards(rows: Flashcard[], now = Date.now()) { return rows.filter(card => Date.parse(card.due_at) <= now).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)); }
export const countDueFlashcards = async () => dueFlashcards(cards).length;
export async function saveFlashcard(draft: FlashcardDraft) {
  if (!draft.front.trim() || !draft.back.trim()) throw new Error('질문과 답을 입력해주세요.');
  const previous = cards.find(card => card.origin_key === draft.origin_key); if (previous) return copy(previous);
  const card: Flashcard = { ...draft, front: draft.front.trim(), back: draft.back.trim(), id: crypto.randomUUID(), material_id: draft.material_id || null, source_page: draft.source_page || null, origin_key: draft.origin_key || crypto.randomUUID(), due_at: new Date().toISOString(), interval_days: 0, ease: 2.5, reviews: 0, revision: 1, created_at: new Date().toISOString() };
  cards.push(card); return copy(card);
}
export async function rateFlashcard(card: Flashcard, rating: FlashcardRating) {
  const interval = { again: 1 / 144, hard: 1, good: 3, easy: 7 }[rating];
  const updated = { ...card, interval_days: interval, reviews: card.reviews + 1, revision: card.revision + 1, due_at: new Date(Date.now() + interval * 86400000).toISOString() };
  cards = cards.map(item => item.id === card.id ? updated : item); return copy(updated);
}
export async function deleteFlashcard(id: string) { cards = cards.filter(card => card.id !== id); }
export const generateFlashcards = async () => ({ cards: copy(seeds) });
export function wrongAnswerBack(answer: number | string | null, explanation: string, options?: string[]) { const text = typeof answer === 'number' ? options?.[answer] : answer; return [text ? `정답: ${text}` : '', explanation.trim()].filter(Boolean).join('\n\n'); }
