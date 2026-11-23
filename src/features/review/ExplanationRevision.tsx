import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { explanationChanges } from '../../services/explanationChanges';
import { workflowRequest, WorkflowError } from '../../services/workflow';
import type { Feedback } from '../../services/learningSessions';
import LearningLayout from '../learningSession/LearningLayout';
import { useLearningNavigation } from '../learningSession/navigation';
import LearningFeedback from '../learningSession/LearningFeedback';

export type RevisionView = { title: string; question: string; baseline: string; baseline_feedback: Feedback | null; source_changed: boolean;
  revision: { id: string; session_id: string; item_id: string; answer: string; revision: number; status: 'draft' | 'pending' | 'graded' | 'ungraded' };
  evaluation: { id: string; status: 'pending' | 'graded' | 'ungraded'; feedback: Feedback | null; error_code: string | null } | null };

export function StartRevision({ sessionId, itemId, parentId }: { sessionId: string; itemId: string; parentId?: string }) {
  const { user } = useAuth(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const command = useRef<string | null>(null);
  async function start() {
    if (!user || busy) return;
    const storageKey = `tongkk:revision-entry:${user.id}:${sessionId}:${itemId}:${parentId || 'initial'}`;
    if (!command.current) {
      try { command.current = localStorage.getItem(storageKey) || crypto.randomUUID(); localStorage.setItem(storageKey, command.current); }
      catch { command.current = crypto.randomUUID(); }
    }
    setBusy(true); setError('');
    try {
      const result = await workflowRequest<RevisionView>('/explanation-revisions', 'POST', { id: command.current, session_id: sessionId, item_id: itemId, parent_id: parentId || null });
      try { localStorage.removeItem(storageKey); } catch { /* Server draft is preserved. */ }
      navigate(`/learn/${sessionId}/revisions/${result.revision.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : '설명 개선을 시작하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <div><button type="button" className="workflow-button" disabled={busy} onClick={() => { void start(); }}>{parentId ? '새 수정본 만들기' : '설명 다듬기'}</button>{error && <p role="alert">{error}</p>}</div>;
}
function Editor({ id, userId }: { id: string; userId: string }) {
  const { beforeLeaveRef } = useLearningNavigation();
  const [data, setData] = useState<RevisionView | null>(null);
  const [text, setText] = useState(''); const textRef = useRef(''); const dataRef = useRef<RevisionView | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const [conflictDraft, setConflictDraft] = useState<string | null>(null);
  const [composing, setComposing] = useState(false); const [retry, setRetry] = useState(0);
  const key = `tongkk:revision:${userId}:${id}`;
  const pending = useRef<{ expected_revision: number; command_key: string } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const accept = useCallback((value: RevisionView) => { dataRef.current = value; setData(value); }, []);
  useEffect(() => {
    const controller = new AbortController();
    workflowRequest<RevisionView>(`/explanation-revisions/${id}`, 'GET', undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      accept(value);
      let draft = value.revision.answer;
      try {
        const local = JSON.parse(localStorage.getItem(key) || 'null');
        if (value.revision.status === 'draft' && local?.baseRevision === value.revision.revision && typeof local.text === 'string') draft = local.text;
        if (value.revision.status === 'draft' && typeof local?.text === 'string' && local.baseRevision !== value.revision.revision && local.text !== draft) setConflictDraft(local.text);
        if (local?.pending?.command_key) {
          if (value.evaluation?.id === local.pending.command_key) { pending.current = null; localStorage.removeItem(key); }
          else pending.current = local.pending;
        }
      } catch { /* The server remains the source of truth. */ }
      textRef.current = draft; setText(draft);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, key, accept, retry]);
  const flush = useCallback(() => {
    const task = queue.current.catch(() => undefined).then(async () => {
      const current = dataRef.current;
      if (!current || current.revision.status !== 'draft' || textRef.current === current.revision.answer) return;
      const value = await workflowRequest<RevisionView>(`/explanation-revisions/${id}/draft`, 'PATCH', {
        expected_revision: current.revision.revision, answer: textRef.current, assisted: true });
      accept(value); setSaved(true);
      try { localStorage.setItem(key, JSON.stringify({ text: textRef.current, baseRevision: value.revision.revision, pending: pending.current })); }
      catch { setError('기기에 저장할 수 없어요. 화면을 닫기 전에 저장 상태를 확인해주세요.'); }
    });
    queue.current = task; return task;
  }, [accept, id, key]);
  useEffect(() => {
    if (!data || data.revision.status !== 'draft' || composing) return;
    const timer = setTimeout(() => { void flush().catch(e => setError(e.message)); }, 700);
    return () => clearTimeout(timer);
  }, [text, composing, data, flush]);
  useEffect(() => {
    beforeLeaveRef.current = async () => { if (busy || pending.current) throw new Error('평가 제출 결과를 확인한 뒤 이동해주세요.'); await flush(); };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, busy, flush]);
  const polling = data?.evaluation?.status === 'pending';
  useEffect(() => {
    if (!polling) return;
    let active = true;
    const timer = setInterval(() => { void workflowRequest<RevisionView>(`/explanation-revisions/${id}`).then(v => { if (active) accept(v); }).catch(e => { if (active) setError(e.message); }); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [id, polling, accept]);
  function change(value: string) {
    textRef.current = value; setText(value); setSaved(false);
    try { localStorage.setItem(key, JSON.stringify({ text: value, baseRevision: dataRef.current?.revision.revision, pending: pending.current })); }
    catch { setError('기기에 초안을 저장할 수 없어요.'); }
  }
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await flush();
      const current = dataRef.current!;
      pending.current ||= { expected_revision: current.revision.revision, command_key: crypto.randomUUID() };
      try { localStorage.setItem(key, JSON.stringify({ text: textRef.current, baseRevision: current.revision.revision, pending: pending.current })); } catch { /* The in-memory command key still protects retries. */ }
      accept(await workflowRequest<RevisionView>(`/explanation-revisions/${id}/submit`, 'POST', pending.current));
      pending.current = null; try { localStorage.removeItem(key); } catch { /* Server submission is saved. */ }
    } catch (e) { if (e instanceof WorkflowError && e.status < 500) pending.current = null; setError(e instanceof Error ? e.message : '제출 결과를 확인하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <div className="workflow-stack"><h1>설명 개선</h1>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(n => n + 1); }}>서버 기록 확인</button></p>}
    {!data ? <p role="status">설명을 불러오는 중…</p> : <>
      <h2>{data.title}</h2><p>{data.question}</p>
      {conflictDraft !== null && <div role="alert"><p>서버와 다른 기기 초안이 남아 있어요.</p><button type="button" className="workflow-button" onClick={() => { change(conflictDraft); setConflictDraft(null); }}>기기 초안을 편집창으로 가져오기</button></div>}
      {data.source_changed && <p role="alert">원문이 바뀌었어요. 새 원문으로 학습한 뒤 설명을 개선해주세요.</p>}
      <Card className="learning-card"><h3>처음 제출한 설명</h3><p style={{ whiteSpace: 'pre-wrap' }}>{data.baseline}</p>{data.baseline_feedback && <LearningFeedback feedback={data.baseline_feedback} />}</Card>
      <Card className="learning-card"><h3>수정 설명</h3>
        <textarea aria-label="수정 설명" maxLength={4000} value={text} disabled={busy || data.revision.status !== 'draft' || data.source_changed}
          onChange={e => change(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
        <details><summary>변경 내용 비교</summary>{explanationChanges(data.baseline, text).map((change, index) => <p key={index} style={{ whiteSpace: 'pre-wrap' }}>{change.kind === 'removed' ? <del>− {change.text}</del> : change.kind === 'added' ? <ins>+ {change.text}</ins> : change.text}</p>)}</details>
        <p className="workflow-muted">{saved ? '저장됨 · ' : ''}피드백을 참고한 보완 수행으로 기록해요. 독립적인 기억 확인은 복습에서 진행해요.</p>
        {!polling && data.revision.status !== 'graded' && <button type="button" className="workflow-button" disabled={busy || composing || !text.trim() || data.source_changed} onClick={() => { void submit(); }}>{pending.current ? '이전 제출 결과 확인' : data.evaluation?.status === 'ungraded' ? '같은 설명 재평가' : '수정 설명 평가'}</button>}
        {polling && <p role="status">설명을 평가하는 중…</p>}
        {data.evaluation?.status === 'ungraded' && <p>평가하지 못했어요. 답변은 보존됐어요.</p>}
        {data.evaluation?.feedback && <LearningFeedback feedback={data.evaluation.feedback} />}
        {data.revision.status === 'graded' && <StartRevision sessionId={data.revision.session_id} itemId={data.revision.item_id} parentId={id} />}
      </Card>
    </>}
  </div>;
}
export default function ExplanationRevision() {
  const { user } = useAuth(); const { revisionId } = useParams();
  if (!user) return <Navigate to="/auth" replace />;
  if (!revisionId) return <Navigate to="/learn" replace />;
  return <LearningLayout><Editor key={`${user.id}:${revisionId}`} id={revisionId} userId={user.id} /></LearningLayout>;
}
