import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { reviewRequest, ReviewError, type ReviewView } from '../../services/reviews';
import LearningLayout from './LearningLayout';
import LearningLink from './LearningLink';
import LearningFeedback from './LearningFeedback';
import Markdown from './LearningMarkdown';
import LearningExplanation from './LearningExplanation';
import { useLearningNavigation } from './navigation';

type Pending = { path: string; body: Record<string, unknown> };
function readDraft(key: string): { text: string; assisted: boolean; pending: Pending | null; newRound: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (typeof value?.text === 'string' && value.text.length <= 4000) return { text: value.text, assisted: value.assisted === true,
      newRound: value.newRound === true, pending: value.pending && typeof value.pending.path === 'string' && value.pending.body ? value.pending : null };
  } catch { /* Storage may be unavailable. */ }
  return { text: '', assisted: false, pending: null, newRound: false };
}
function Practice({ id, userId }: { id: string; userId: string }) {
  const { beforeLeaveRef } = useLearningNavigation();
  const key = `tongkk:review:${userId}:${id}`;
  const initial = useRef(readDraft(key));
  const [text, setText] = useState(initial.current.text);
  const [assisted, setAssisted] = useState(initial.current.assisted);
  const [pending, setPending] = useState<Pending | null>(initial.current.pending);
  const [newRound, setNewRound] = useState(initial.current.newRound);
  const [view, setView] = useState<ReviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const activeCommand = useRef(false);
  const refresh = useCallback(async () => {
    try { setView(await reviewRequest<ReviewView>(`/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : '복습을 불러오지 못했어요.'); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const polling = view?.latest?.status === 'pending';
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ text, assisted, pending, newRound })); }
    catch { setError('기기에 저장할 수 없어요. 화면을 닫기 전에 답변을 제출해주세요.'); }
  }, [key, text, assisted, pending, newRound]);
  useEffect(() => {
    beforeLeaveRef.current = async () => { if (busy || pending) throw new Error('제출 결과를 확인한 뒤 이동해주세요.'); };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, busy, pending]);
  async function send(request: Pending) {
    if (activeCommand.current) return;
    activeCommand.current = true; setPending(request); setBusy(true); setError('');
    try {
      const result = await reviewRequest<ReviewView>(request.path, 'POST', request.body);
      setView(result); setPending(null); setNewRound(false); setShowResult(request.path.endsWith('/check'));
    } catch (e) {
      if (e instanceof ReviewError && e.status < 500) { setPending(null); void refresh(); }
      setError(e instanceof Error ? e.message : '제출 결과를 확인하지 못했어요.');
    } finally { activeCommand.current = false; setBusy(false); }
  }
  const attempt = view?.latest;
  useEffect(() => {
    if (attempt?.status === 'ungraded') setText(previous => previous || attempt.answer);
  }, [attempt?.id, attempt?.status, attempt?.answer]);
  const answering = !attempt || attempt.status === 'ungraded' || (Boolean(attempt.check_result) && (newRound || (!showResult && Boolean(view && new Date(view.due_at).getTime() <= Date.now()))));
  const blocked = busy || Boolean(pending) || polling || view?.source_changed || view?.paused;
  return <>
    <div className="learning-page-title"><p className="learning-eyebrow">복습</p><h1>{view?.title || '복습 불러오는 중'}</h1></div>
    {error && <div className="learning-notice learning-error" role="alert">{error}</div>}
    {pending && <button type="button" disabled={busy} onClick={() => { void send(pending); }}>이전 제출 결과 확인</button>}
    {!view && !busy && error && <button type="button" onClick={() => { void refresh(); }}>다시 불러오기</button>}
    {view && <Card className="learning-card">
      {view.paused ? <p>일시 정지한 복습이에요. 복습 관리에서 재개해주세요.</p> : view.source_changed ? <div className="learning-notice">원문이 바뀌었어요. 새 자료로 학습한 뒤 복습을 추가해주세요.</div>
        : answering ? <>
          {attempt?.status === 'ungraded' && <p role="status">평가하지 못했어요. 답변은 보존됐고 일정은 그대로예요.</p>}
          <Markdown text={view.question} />
          <label htmlFor="review-answer"><p>자료를 보지 않고 핵심을 설명해주세요.</p></label>
          <textarea id="review-answer" maxLength={4000} value={text} disabled={blocked}
            onChange={event => setText(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
          <label className="learning-option"><input type="checkbox" checked={assisted} disabled={blocked} onChange={event => setAssisted(event.target.checked)} />자료를 보고 답했어요</label>
          <button type="button" className="primary" disabled={blocked || composing || !text.trim()}
            onClick={() => { void send({ path: `/${id}/answers`, body: { attempt_id: crypto.randomUUID(), answer: text, assisted } }); }}>설명 제출</button>
        </> : attempt.status === 'pending' ? <p role="status">설명 평가 중…</p> : <>
          {attempt.feedback && <LearningFeedback feedback={attempt.feedback} />}
          <details><summary>내 설명</summary><Markdown text={attempt.answer} /></details>
          {view.check && <><h2>기초 확인</h2><Markdown text={view.check.question} />
            <fieldset className="learning-check" disabled={blocked || Boolean(attempt.check_result)}><legend>답안 선택</legend>
              {view.check.options.map((option, index) => <label className={`learning-option${attempt.check_result?.answer_index === index ? ' is-correct' : ''}`} key={index}>
                <input type="radio" name="review-check" value={index} checked={(attempt.check_result?.selected ?? selected) === index} onChange={() => setSelected(index)} />{option}
                {attempt.check_result?.answer_index === index && <span className="learning-badge">정답</span>}</label>)}
            </fieldset>
            {!attempt.check_result && <button type="button" className="primary" disabled={blocked || selected === null} onClick={() => { void send({ path: `/${id}/check`, body: { attempt_id: attempt.id, selected } }); }}>답안 제출</button>}
          </>}
          {attempt.check_result && <div className="learning-notice"><strong>{attempt.check_result.correct ? '정답이에요.' : '다시 확인해요.'}</strong>
            <LearningExplanation text={attempt.check_result.explanation} /><p>다음 복습: {new Date(view.due_at).toLocaleDateString('ko-KR')}</p>
            {!attempt.eligible_for_schedule && <p className="learning-caption">예정일 전 연습이라 복습 일정은 유지돼요.</p>}
            <button type="button" disabled={blocked} onClick={() => { setText(''); setAssisted(false); setNewRound(true); setSelected(null); }}>다시 연습하기</button></div>}
          {view.baseline && <details><summary>처음 학습과 비교</summary>{view.baseline.answer && <Markdown text={view.baseline.answer} />}
            {view.baseline.feedback && <LearningFeedback feedback={view.baseline.feedback} />}</details>}
          {view.previous && <details><summary>지난 복습과 비교</summary><Markdown text={view.previous.answer} />{view.previous.feedback && <LearningFeedback feedback={view.previous.feedback} />}</details>}
        </>}
      <div className="learning-actions"><LearningLink to="/learn" className="learning-button">학습 목록으로</LearningLink></div>
    </Card>}
  </>;
}
export default function ReviewPractice() {
  const { user } = useAuth(); const { cardId } = useParams();
  if (!user) return <Navigate to="/auth" replace />;
  if (!cardId) return <Navigate to="/learn" replace />;
  return <LearningLayout><Practice key={`${user.id}:${cardId}`} id={cardId} userId={user.id} /></LearningLayout>;
}
