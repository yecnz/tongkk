import { Button, InlineAlert } from '../../components/ui';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { workflowRequest } from '../../services/workflow';
import LearningLayout from '../learningSession/LearningLayout';
import LearningRunner from '../learningSession/LearningRunner';
import LearningLink from '../learningSession/LearningLink';

export type StudyPath = {
  id: string; target_id: string; status: 'active' | 'completed' | 'invalidated'; position: number;
  steps: { position: number; concept_id: string; title: string; reason: string; course_name: string;
    session_id: string | null; session_status: string | null; session_complete: boolean; source_changed: boolean }[];
};

function Study({ userId, conceptId }: { userId: string; conceptId: string }) {
  const [query, setQuery] = useSearchParams();
  const pathId = query.get('path');
  const commandKey = useRef(crypto.randomUUID());
  const introContextRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<StudyPath | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    setError(''); setBusy(true);
    async function load() {
      let value = pathId ? await workflowRequest<StudyPath>(`/learning-graph/paths/${encodeURIComponent(pathId)}`) : null;
      if (value && value.target_id !== conceptId) throw new Error('이 학습 순서의 개념을 다시 확인해주세요.');
      if (!value || (value.status === 'active' && !value.steps[value.position]?.session_id)) {
        value = await workflowRequest<StudyPath>('/learning-graph/paths', 'POST', {
          concept_id: conceptId, idempotency_key: pathId || commandKey.current,
        });
      }
      if (!active) return;
      setPath(value);
      setCompleted(Boolean(value.steps[value.position]?.session_complete));
      if (value.id !== pathId) setQuery({ path: value.id }, { replace: true });
    }
    void load().catch(e => { if (active) setError(e instanceof Error ? e.message : '학습 순서를 불러오지 못했어요.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [conceptId, pathId, retry, setQuery]);

  async function next() {
    if (!path || busy) return;
    setBusy(true); setError('');
    try {
      const value = await workflowRequest<StudyPath>(`/learning-graph/paths/${path.id}/next`, 'POST', { position: path.position });
      setPath(value); setCompleted(Boolean(value.steps[value.position]?.session_complete));
    } catch (e) { setError(e instanceof Error ? e.message : '다음 학습을 준비하지 못했어요.'); }
    finally { setBusy(false); }
  }

  const current = path?.steps[path.position];
  return <>
    {error && <InlineAlert tone="error" >{error} <Button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>다시 확인</Button></InlineAlert>}
    {!path ? (error ? <LearningLink className="ui-button ui-button--ghost" to="/stats?view=graph">개념 지도로 돌아가기</LearningLink> : <p role="status">연결된 개념의 학습을 준비하는 중…</p>) : path.status === 'completed' ? <Card className="learning-card workflow-surface workflow-stack">
      <h1>연결된 개념 학습을 마쳤어요</h1><p>개념별 답변과 확인 결과를 학습 기록에 저장했어요.</p><LearningLink to="/stats?view=graph" className="ui-button ui-button--secondary">개념 지도 보기 →</LearningLink>
    </Card> : path.status === 'invalidated' || current?.source_changed ? <Card className="learning-card workflow-surface workflow-stack">
      <h1>새 학습 순서를 준비해주세요</h1><p>현재 자료와 학습 기록을 기준으로 다시 시작할 수 있어요.</p><LearningLink to="/stats?view=graph" className="ui-button ui-button--secondary">개념 지도로 돌아가기</LearningLink>
    </Card> : <>
      <div ref={introContextRef} className="concept-study-context"><Card className="learning-card workflow-surface workflow-stack" aria-label="연결된 개념 학습 순서">
        <div className="workflow-card-heading"><strong>연결된 개념 학습</strong><span className="workflow-meta">{path.position + 1} / {path.steps.length}</span></div>
        <ol className="concept-study-plan is-compact" aria-label="학습 진행">{path.steps.map(step => <li key={step.position} aria-current={step.position === path.position ? 'step' : undefined}>
          <span className="concept-study-number" aria-hidden="true">{step.position < path.position ? '✓' : step.position + 1}</span><span>{step.title}</span>
        </li>)}</ol><p className="workflow-muted">{current?.reason}</p>
      </Card></div>
      {current?.session_id && <LearningRunner key={current.session_id} id={current.session_id} userId={userId} onCompletedChange={setCompleted} introContextRef={introContextRef}
        completionActions={completed ? <div className="learning-actions"><Button type="button" variant="primary" disabled={busy} onClick={() => { void next(); }}>
          {busy ? '다음 학습 준비 중…' : path.position + 1 < path.steps.length ? `다음 개념: ${path.steps[path.position + 1].title} →` : '학습 마치기'}
        </Button></div> : undefined} />}
      <div className="learning-actions"><LearningLink className="ui-button ui-button--ghost" to="/stats?view=graph">개념 지도 보기</LearningLink></div>
    </>}
  </>;
}

export default function ConnectedLearning() {
  const { user } = useAuth();
  const { conceptId } = useParams();
  if (!user) return <Navigate to="/auth" replace />;
  if (!conceptId) return <Navigate to="/stats?view=graph" replace />;
  return <LearningLayout key={`${user.id}:${conceptId}`}><Study userId={user.id} conceptId={conceptId} /></LearningLayout>;
}
