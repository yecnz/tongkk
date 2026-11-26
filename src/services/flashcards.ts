import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import { workflowRequest } from './workflow';

export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';
export type Flashcard = {
  id: string; course_id: string; material_id: string | null; front: string; back: string;
  source_page: number | null; origin_key: string; due_at: string; interval_days: number;
  ease: number; reviews: number; revision: number; created_at: string;
};
export type FlashcardDraft = Pick<Flashcard, 'course_id' | 'front' | 'back'> &
  Partial<Pick<Flashcard, 'material_id' | 'source_page' | 'origin_key'>>;

export async function loadFlashcards(): Promise<Flashcard[]> {
  await requireSupabaseUser();
  const { data, error } = await supabase.from('study_flashcards').select('*').order('due_at').limit(1000);
  if (error) throw new Error(formatSupabaseError(error));
  return data || [];
}

export async function countDueFlashcards(): Promise<number> {
  await requireSupabaseUser();
  const { count, error } = await supabase.from('study_flashcards').select('id', { count: 'exact', head: true })
    .lte('due_at', new Date().toISOString());
  if (error) throw new Error(formatSupabaseError(error));
  return count || 0;
}

export async function saveFlashcard(draft: FlashcardDraft): Promise<Flashcard> {
  await requireSupabaseUser();
  const { data, error } = await supabase.rpc('study_flashcard_create', {
    p_course: draft.course_id, p_material: draft.material_id || null,
    p_front: draft.front.trim(), p_back: draft.back.trim(), p_page: draft.source_page || null,
    p_origin: draft.origin_key || crypto.randomUUID(),
  });
  if (error) throw new Error(formatSupabaseError(error));
  return data;
}

export async function rateFlashcard(card: Flashcard, rating: FlashcardRating, requestId: string): Promise<Flashcard> {
  const { data, error } = await supabase.rpc('study_flashcard_rate', {
    p_card: card.id, p_rating: rating, p_revision: card.revision, p_key: requestId,
  });
  if (error) throw new Error(error.message.includes('FLASHCARD_CONFLICT')
    ? '다른 창에서 복습한 카드예요. 목록을 새로 불러와 주세요.' : formatSupabaseError(error));
  return data;
}

export async function deleteFlashcard(id: string): Promise<void> {
  const { error } = await supabase.from('study_flashcards').delete().eq('id', id);
  if (error) throw new Error(formatSupabaseError(error));
}

export function dueFlashcards(cards: Flashcard[], now = Date.now()): Flashcard[] {
  return cards.filter(card => new Date(card.due_at).getTime() <= now)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
}

export function wrongAnswerBack(answer: number | string | null, explanation: string, options?: string[]): string {
  const text = typeof answer === 'number' ? options?.[answer] : answer;
  return [text ? `정답: ${text}` : '', explanation.trim()].filter(Boolean).join('\n\n');
}

export async function generateFlashcards(markdown: string) {
  return workflowRequest<{ cards: { front: string; back: string; source_page: number | null }[] }>(
    '/flashcards/generate', 'POST', { markdown: markdown.slice(0, 60000), count: 8 });
}
