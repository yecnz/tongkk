import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCourses } from '../../services/courses';
import { loadQuizSetsFromServer } from '../../services/quizSets';
import { saveFlashcard, wrongAnswerBack } from '../../services/flashcards';

type Props = { courseName: string; attemptId: string; questionIndex: number; quizSetId: string | null;
  question: string; correctAnswer: number | string | null; explanation: string; materialIds: string[] };
export default function SaveWrongCard(props: Props) {
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const course = (await fetchCourses()).find(item => item.name === props.courseName);
      if (!course) throw new Error('과목을 찾지 못했어요.');
      const sets = await loadQuizSetsFromServer(props.courseName, { includeQuestions: true });
      const original = sets.find(set => set.id === props.quizSetId)?.questions.find(item => item.question === props.question);
      const back = wrongAnswerBack(props.correctAnswer, original?.explanation || props.explanation, original?.options);
      if (!back) throw new Error('정답 내용을 복원하지 못했어요. 암기 카드 화면에서 직접 작성해주세요.');
      const front = [props.question, original?.options?.map((option, i) => `${i + 1}. ${option}`).join('\n')].filter(Boolean).join('\n\n');
      const page = /\bp\.(\d+)\b/.exec(original?.explanation || props.explanation);
      await saveFlashcard({ course_id: course.id, material_id: props.materialIds.length === 1 ? props.materialIds[0] : null,
        source_page: props.materialIds.length === 1 && page ? Number(page[1]) : null,
        front, back, origin_key: `wrong:${props.attemptId}:${props.questionIndex}` });
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : '카드를 저장하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <div>{saved ? <Link to="/flashcards">암기 카드에 저장됨 · 복습하기 →</Link> : <button type="button" disabled={busy} onClick={() => { void save(); }}>{busy ? '저장 중…' : '암기 카드로 저장'}</button>}
    {error && <p role="alert">{error}</p>}</div>;
}
