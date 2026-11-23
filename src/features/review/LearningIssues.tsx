import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '../../common';
import { workflowRequest, issueLabels, type LearningIssue, type IssueDetail } from '../../services/workflow';

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
  return <Card className="learning-card workflow-stack">
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setPending(null); setRetry(n => n + 1); }}>새로 불러오기</button></p>}
    {!data ? <p role="status">이슈를 불러오는 중…</p> : <>
      <h2>{data.concept.title}</h2><p>{issueLabels[data.issue.status]}</p>
      <div className="workflow-tabs">
        {(data.issue.status === 'closed' || data.issue.status === 'resolved' ? [['reopen', '다시 열기']] : [['start', '보완 시작'], ['reassess', '재평가 대기'], ['close', '수동 종료']]).map(([action, label]) =>
          <button type="button" disabled={busy || Boolean(pending && pending.action !== action)} key={action} onClick={() => { void act(action); }}>{pending?.action === action ? '이전 저장 결과 확인' : label}</button>)}
      </div>
      <p className="workflow-muted">보완 후 같은 문제를 맞힌 기록과 독립적인 이해 확인은 구분해요. 수동 종료는 이해 완료 판정이 아니에요.</p>
      {data.review_card_id && <Link to={`/learn/review/${data.review_card_id}`}>기존 문제로 다시 확인하기 →</Link>}
      <h3>원문 근거</h3>{data.concept.source_refs.map((ref, i) => <blockquote key={i}>{ref.quote}</blockquote>)}
      <h3>학습 근거</h3>{data.evidence.map(e => <section key={e.id}>
        <p>{new Date(e.created_at).toLocaleString('ko-KR')} · {e.outcome === 'met' ? '확인됨' : e.outcome === 'uncertain' ? '판단 보류' : '보완 필요'}{e.assisted ? ' · 도움 사용' : ''}</p>
        {e.answer !== null && <p>{String(e.answer)}</p>}
        <Link to={`/learn/${encodeURIComponent(e.session_id)}`}>답변·피드백과 설명 개선 보기 →</Link>
      </section>)}
      <details><summary>상태 변경 이력</summary>{data.events.map(e => <p key={e.id}>{new Date(e.created_at).toLocaleString('ko-KR')} · {({ evidence: '보완 근거 추가', practice: '학습 근거 추가', start: '보완 시작', reassess: '재평가 대기', close: '수동 종료', reopen: '다시 열기' } as Record<string, string>)[e.action] || e.action}</p>)}</details>
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
  if (id) return <><button className="workflow-button" type="button" onClick={() => setParams({ tab: 'issues' })}>← 이슈 목록</button><Issue key={id} id={id} /></>;
  return <div className="workflow-stack">
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></p>
      : loading ? <p role="status">이슈를 불러오는 중…</p> : <>
        <p>학습 이슈 {total}개</p>
        {!items.length && <p>아직 기록된 이슈가 없어요. 학습에서 보완할 개념이 나오면 이곳에 모여요.</p>}
        {items.map(item => <Card key={item.id} className="learning-card"><h2>{item.title}</h2><p>{issueLabels[item.status]}</p>
          <button className="workflow-button" type="button" onClick={() => setParams({ tab: 'issues', issueId: item.id })}>근거·보완 기록 보기 →</button></Card>)}
        <div className="workflow-tabs"><button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>이전</button><button type="button" disabled={(page + 1) * 30 >= total} onClick={() => setPage(p => p + 1)}>다음</button></div>
      </>}
  </div>;
}
