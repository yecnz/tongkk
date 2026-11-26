import { Button, InlineAlert } from '../../components/ui';
import { useLearningScope } from '../learningMate/context';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '../../common';
import { workflowRequest, issueLabels, type LearningIssue, type IssueDetail } from '../../services/workflow';
import './LearningIssues.css';

const eventLabels: Record<string, string> = {
  evidence: '확인할 근거 추가', practice: '학습 근거 추가', start: '복습 중으로 표시',
  reassess: '다시 확인 예정', close: '직접 확인함', reopen: '확인 필요로 변경',
  resolved: '평가로 확인됨', quality_report: '문항 신고로 다시 확인',
};

function EventRows({ events }: { events: IssueDetail['events'] }) {
  return <ul className="learning-issue-events">{events.map(event => <li key={event.id}>
    <span>{eventLabels[event.action] || event.action}</span>
    <time dateTime={event.created_at} title={new Date(event.created_at).toLocaleString('ko-KR')}>
      {new Date(event.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
    </time>
  </li>)}</ul>;
}

function Issue({ id }: { id: string }) {
  const [data, setData] = useState<IssueDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<{ revision: number; command_key: string; action: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    workflowRequest<IssueDetail>(`/learning-issues/${id}`, 'GET', undefined, controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, retry]);
  async function act(action: string) {
    if (!data || busy) return;
    const body = pending || { revision: data.issue.revision, command_key: crypto.randomUUID(), action };
    setPending(body); setBusy(true); setError('');
    try { setData(await workflowRequest<IssueDetail>(`/learning-issues/${id}/actions`, 'POST', body)); setPending(null); }
    catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); }
    finally { setBusy(false); }
  }
  useLearningScope(data ? { courseId: data.concept.course_id, materialId: data.concept.material_id, title: data.concept.title } : null);
  return <Card className="workflow-panel workflow-stack learning-issue-detail">
    {error && <InlineAlert tone="error">{error} <Button type="button" onClick={() => { setError(''); setPending(null); setRetry(n => n + 1); }}>새로 불러오기</Button></InlineAlert>}
    {!data ? !error && <p role="status">이슈를 불러오는 중…</p> : <>
      <div className="workflow-card-heading"><h2>{data.concept.title}</h2><span className="workflow-badge" data-state={data.issue.status}>{issueLabels[data.issue.status]}</span></div>
      <div className="learning-issue-status">
        <div className="learning-issue-section-heading"><h3>상태 표시</h3><p className="workflow-meta">직접 확인한 표시는 AI 평가 결과와 구분해요.</p></div>
        <div className="workflow-actions">
          {(data.issue.status === 'closed' || data.issue.status === 'resolved' ? [['reopen', '다시 확인하기']] : [['start', '복습 중으로 표시'], ['reassess', '다시 확인할 항목으로'], ['close', '확인 완료로 표시']]).map(([action, label]) =>
            <Button type="button" disabled={busy || Boolean(pending && pending.action !== action)} key={action} onClick={() => { void act(action); }}>{pending?.action === action ? '이전 저장 결과 확인' : label}</Button>)}
        </div>
      </div>
      {data.review_card_id && <Link className="ui-button ui-button--primary" to={`/learn/review/${data.review_card_id}`}>기존 문제로 다시 확인하기 →</Link>}
      {data.source_changed && <p className="workflow-muted">이전 자료의 학습 근거입니다.</p>}
      <section className="learning-issue-section" aria-label="원문 근거">
        <div className="learning-issue-section-heading"><h3>원문 근거</h3><p className="workflow-meta">자료에서 가져온 내용</p></div>
        {data.concept.source_refs.map((ref, i) => <blockquote key={i}>{ref.quote}</blockquote>)}
        {!data.concept.source_refs.length && <p className="workflow-muted">연결된 원문이 없습니다.</p>}
      </section>
      <section className="learning-issue-section" aria-label="학습 근거">
        <div className="learning-issue-section-heading"><h3>학습 근거</h3><p className="workflow-meta">내 답변과 확인 결과</p></div>
        {data.evidence.map(e => <article className="workflow-item learning-issue-evidence" key={e.id}>
          <p className="workflow-meta">{new Date(e.created_at).toLocaleString('ko-KR')} · {e.outcome === 'met' ? '확인됨' : e.outcome === 'uncertain' ? '판단 보류' : '보완 필요'}{e.assisted ? ' · 도움 사용' : ''}</p>
          {e.answer !== null && <p className="learning-issue-answer">{String(e.answer)}</p>}
          <Link to={`/learn/${encodeURIComponent(e.session_id)}`}>답변·피드백 보기 →</Link>
        </article>)}
        {!data.evidence.length && <p className="workflow-muted">아직 학습 근거가 없습니다.</p>}
      </section>
      {data.events.length > 0 && <section className="learning-issue-history" aria-label="상태 변경 이력">
        <h3>최근 상태 변경</h3>
        <EventRows events={data.events.slice(0, 2)} />
        {data.events.length > 2 && <details className="learning-issue-older-events">
          <summary>이전 변경 {data.events.length - 2}개</summary>
          <EventRows events={data.events.slice(2)} />
        </details>}
      </section>}
    </>}
  </Card>;
}
export default function LearningIssues() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<LearningIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const id = params.get('issueId');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    workflowRequest<{ issues: LearningIssue[]; total: number }>(`/learning-issues?offset=${page * 30}`, 'GET', undefined, controller.signal)
      .then(value => { setItems(value.issues); setTotal(value.total); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry, id]);
  if (id) return <div className="workflow-surface workflow-stack"><Button  type="button" onClick={() => setParams({ tab: 'issues' })}>← 이슈 목록</Button><Issue key={id} id={id} /></div>;
  return <div className="workflow-surface workflow-stack">
    {error ? <InlineAlert tone="error">{error} <Button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button></InlineAlert>
      : loading ? <p role="status">이슈를 불러오는 중…</p> : <>
        <p className="workflow-muted">학습 이슈 {total}개</p>
        {!items.length && <p>보완할 개념이 없습니다.</p>}
        {items.map(item => <Card key={item.id} className="workflow-panel workflow-stack"><div className="workflow-card-heading"><h3>{item.title}</h3><span className="workflow-badge" data-state={item.status}>{issueLabels[item.status]}</span></div>
          <Button  type="button" onClick={() => setParams({ tab: 'issues', issueId: item.id })}>근거·보완 기록 보기 →</Button></Card>)}
        <div className="workflow-actions"><Button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>이전</Button><Button type="button" disabled={(page + 1) * 30 >= total} onClick={() => setPage(p => p + 1)}>다음</Button></div>
      </>}
  </div>;
}
