import { describe, expect, it } from 'vitest';
import { dueFlashcards, wrongAnswerBack, type Flashcard } from './flashcards';

describe('flashcards', () => {
  it('only offers cards whose server schedule is due, oldest first', () => {
    const now = Date.parse('2026-11-26T03:00:00Z');
    const cards = [2, -2, -1].map(delta => ({ id: String(delta), due_at: new Date(now + delta * 1000).toISOString() } as Flashcard));
    expect(dueFlashcards(cards, now).map(card => card.id)).toEqual(['-2', '-1']);
    expect(cards.map(card => card.id)).toEqual(['2', '-2', '-1']);
  });
  it('never turns an internal choice index into the memorized answer', () => {
    expect(wrongAnswerBack(1, '근거', ['오답', '정답'])).toBe('정답: 정답\n\n근거');
    expect(wrongAnswerBack(1, '근거')).toBe('근거');
    expect(wrongAnswerBack(null, '')).toBe('');
  });
});
