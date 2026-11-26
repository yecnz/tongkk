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
function readDraft(key: string): { text: string; assisted: boolean; pending: Pending | null; newRound: boolean; prompt: {id:string|null;text:string}|null } {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (typeof value?.text === 'string' && value.text.length <= 4000) return { text: value.text, assisted: value.assisted === true,
      prompt: typeof value.prompt?.text === 'string' ? value.prompt : null, newRound: value.newRound === true, pending: value.pending && typeof value.pending.path === 'string' && value.pending.body ? value.pending : null };
  } catch { /* Storage may be unavailable. */ }
  return { text: '', assisted: false, pending: null, newRound: false, prompt:null };
}
function Practice({ id, userId }: { id: string; userId: string }) {
  const { beforeLeaveRef } = useLearningNavigation();
  const key = `tongkk:review:${userId}:${id}`;
  const initial = useRef(readDraft(key));
  const [prompt,setPrompt] = useState(initial.current.prompt);
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
  const [preparing,setPreparing] = useState(false);
  useEffect(()=>{ if(!view?.auto_questions || view.question_status || view.source_changed || view.paused || initial.current.text.trim())return;setPreparing(true);void reviewRequest<ReviewView>(`/${id}/questions`,'POST',{}).then(setView).catch(e=>setError(e.message)).finally(()=>setPreparing(false));},[id,view?.auto_questions,view?.question_status,view?.source_changed,view?.paused,view?.due_at]);
  async function prepare(retry=false) { if (preparing) return; setPreparing(true);setError(''); try { setView(await reviewRequest<ReviewView>(`/${id}/questions`,'POST',{retry})); } catch(e) { setError(e instanceof Error?e.message:'새 문제를 준비하지 못했어요.'); } finally {setPreparing(false);} }
  const polling = view?.latest?.status === 'pending' || view?.question_status === 'queued';
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ text, assisted, pending, newRound, prompt })); }
    catch { setError('기기에 저장할 수 없습니다. 화면을 닫기 전에 답변을 제출하세요.'); }
  }, [key, text, assisted, pending, newRound, prompt]);
  useEffect(() => {
    beforeLeaveRef.current = async () => { if (busy || pending) throw new Error('제출 결과를 확인한 뒤 이동하세요.'); };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, busy, pending]);
  async function send(request: Pending) {
    if (activeCommand.current) return;
    activeCommand.current = true; setPending(request); setBusy(true); setError('');
    try {
      const result = await reviewRequest<ReviewView>(request.path, 'POST', request.body);
      setView(result); setPending(null); setNewRound(false); setShowResult(request.path.endsWith('/check')); if(request.path.endsWith('/check')){setText('');setPrompt(null);}
    } catch (e) {
      if (e instanceof ReviewError && e.status < 500) { setPending(null); void refresh(); }
      setError(e instanceof Error ? e.message : '제출 결과를 확인하지 못했어요.');
    } finally { activeCommand.current = false; setBusy(false); }
  }
  const attempt = view?.latest;
  useEffect(() => {
    if (attempt?.status === 'ungraded') { setText(previous => previous || attempt.answer); setPrompt(previous=>previous||{id:attempt.question_id||null,text:attempt.question||view?.question||''}); }
  }, [attempt?.id, attempt?.status, attempt?.answer,attempt?.question_id,attempt?.question,view?.question]);
  const answering = !attempt || attempt.status === 'ungraded' || (Boolean(attempt.check_result) && (newRound || (!showResult && Boolean(view && new Date(view.due_at).getTime() <= Date.now()))));
  const blocked = preparing || busy || Boolean(pending) || polling || view?.source_changed || view?.paused;
  return <div className="workflow-surface">
    <div className="learning-page-title"><p className="learning-eyebrow">복습</p><h1>{view?.title || '복습 불러오는 중'}</h1></div>
    {error && <div className="learning-notice learning-error" role="alert">{error}</div>}
    {pending && <button type="button" disabled={busy} onClick={() => { void send(pending); }}>이전 제출 결과 확인</button>}
    {!view && !busy && error && <button type="button" onClick={() => { void refresh(); }}>다시 불러오기</button>}
    {view && <Card className="workflow-panel workflow-stack">
      {view.paused ? <p>복습이 일시 정지되었습니다. 복습 관리에서 재개하세요.</p> : view.source_changed ? <div className="learning-notice">원문이 변경되었습니다. 새 자료를 학습한 뒤 복습을 추가하세요.</div>
        : answering ? <>
          {attempt?.status === 'ungraded' && <p role="status">평가하지 못했어요. 답변은 보존됐고 일정은 그대로예요.</p>}
          <Markdown text={prompt?.text || (text.trim() ? view.question : view.next_question || view.question)} />
          <p className="learning-caption">{view.question_id ? '새 사례로 복습합니다.' : '기존 문제로 연습합니다.'}</p>
          {view.question_status==='queued' ? <p role="status">새 복습 문제를 준비하는 중…</p> : view.question_status==='ready' ? null : <button type="button" disabled={preparing||busy||Boolean(pending)||Boolean(text.trim())} onClick={()=>{void prepare(view.question_status==='failed');}}>{view.question_status==='failed'?'새 문제 생성 다시 시도':'새 복습 문제 준비'}</button>}
          <label htmlFor="review-answer"><p>자료를 보지 않고 핵심을 설명하세요.</p></label>
          <textarea id="review-answer" maxLength={4000} value={text} disabled={blocked}
            onChange={event => { if (!prompt) setPrompt({id:view.question_id||null,text:view.next_question||view.question}); if(!event.target.value) setPrompt(null); setText(event.target.value); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
          <label className="learning-option"><input type="checkbox" checked={assisted} disabled={blocked} onChange={event => setAssisted(event.target.checked)} />자료를 보고 답했어요</label>
          <button type="button" className="primary" disabled={blocked || composing || !text.trim()}
            onClick={() => { void send({ path: `/${id}/answers`, body: { attempt_id: crypto.randomUUID(), answer: text, assisted, question_id: prompt?.id || null } }); }}>설명 제출</button>
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
            {!attempt.eligible_for_schedule && <p className="learning-caption">예정일 전 연습은 복습 일정에 반영되지 않습니다.</p>}
            <button type="button" disabled={blocked} onClick={() => { setText(''); setPrompt(null); setAssisted(false); setNewRound(true); setSelected(null); }}>다시 연습하기</button></div>}
          {view.baseline && <details><summary>처음 학습과 비교</summary>{view.baseline.answer && <Markdown text={view.baseline.answer} />}
            {view.baseline.feedback && <LearningFeedback feedback={view.baseline.feedback} />}</details>}
          {view.previous && <details><summary>지난 복습과 비교</summary><Markdown text={view.previous.answer} />{view.previous.feedback && <LearningFeedback feedback={view.previous.feedback} />}</details>}
        </>}
      <div className="learning-actions"><LearningLink to="/learn" className="learning-button">학습 목록으로</LearningLink></div>
    </Card>}
  </div>;
}
export default function ReviewPractice() {
  const { user } = useAuth(); const { cardId } = useParams();
  if (!user) return <Navigate to="/auth" replace />;
  if (!cardId) return <Navigate to="/learn" replace />;
  return <LearningLayout><Practice key={`${user.id}:${cardId}`} id={cardId} userId={user.id} /></LearningLayout>;
}
