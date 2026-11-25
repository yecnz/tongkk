import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '../../common';
import { useAuth } from '../../AuthContext';
import { workflowRequest } from '../../services/workflow';
import { useLearningScope } from '../learningMate/context';
type Concept = { id: string; title: string; state: string; source_changed: boolean; course_id: string; material_id: string;
  evidence_count: number; independent_questions: number; assisted_count: number; delayed_practice: number; last_evaluated_at: string | null; policy_version: string };
const labels: Record<string, string> = { unassessed: '미평가', needs_confirmation: '확인 필요', needs_review: '보완 필요', awaiting_reassessment: '재평가 대기', recent_stable: '최근 안정', source_changed: '원문 변경' };
type Detail = { concept: Concept; evidence: { id: string; source_kind: string; outcome: string; assisted: boolean; independent: boolean; session_id: string; created_at: string }[];
  revisions: { id: string; session_id: string; status: string; created_at: string }[]; issue_id: string | null };
function ConceptDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    workflowRequest<Detail>(`/learning-concepts/${id}`, 'GET', undefined, controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, retry]);
  useLearningScope(data ? { courseId: data.concept.course_id, materialId: data.concept.material_id, title: data.concept.title } : null);
  return <Card className="workflow-panel workflow-stack">
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(n => n + 1); }}>다시 불러오기</button></p>}
    {!data ? <p role="status">기록을 불러오는 중…</p> : <>
      <div className="workflow-card-heading"><h2>{data.concept.title}</h2><span className="workflow-badge" data-state={data.concept.state}>{labels[data.concept.state]}</span></div>
      <dl className="workflow-metrics"><div><dt>수행 근거</dt><dd>{data.concept.evidence_count}개</dd></div><div><dt>도움 사용</dt><dd>{data.concept.assisted_count}회</dd></div><div><dt>독립 설명의 서로 다른 질문</dt><dd>{data.concept.independent_questions}개</dd></div><div><dt>예정일 이후 복습 성공</dt><dd>{data.concept.delayed_practice}회</dd></div></dl>
      <p className="workflow-muted">같은 문제 반복, 피드백을 본 설명 수정, 독립 수행을 구분해요. 한 번의 정답으로 장기 이해를 확정하지 않아요.</p>
      {data.concept.source_changed && <p>원문이 변경되었습니다. 이전 자료의 학습 기록입니다.</p>}
      {data.issue_id && <Link to={`/review?tab=issues&issueId=${data.issue_id}`}>연결된 학습 이슈 →</Link>}
      <h3>최근 수행 기록</h3>{data.evidence.map(e => <section className="workflow-item" key={e.id}><p className="workflow-meta">{new Date(e.created_at).toLocaleString('ko-KR')} · {({ recall: '자기 설명', check: '기초 확인', review: '복습', revision: '설명 개선', quiz: '연결한 오답' } as Record<string, string>)[e.source_kind]} · {e.outcome === 'met' ? '확인됨' : e.outcome === 'uncertain' ? '판단 보류' : '보완 필요'}{e.assisted ? ' · 도움·사전 설명 있음' : ''}</p><Link to={`/learn/${e.session_id}`}>학습 답변·피드백 보기 →</Link></section>)}
      {!data.evidence.length && <p>평가 근거가 없습니다.</p>}
      <h3>설명 개선 이력</h3>{data.revisions.map(r => <Link key={r.id} to={`/learn/${r.session_id}/revisions/${r.id}`}>{new Date(r.created_at).toLocaleString('ko-KR')} · 수정 설명과 평가 보기 →</Link>)}
    </>}
  </Card>;
}
export default function ConceptHistory() {
  const { user } = useAuth(); const [params, setParams] = useSearchParams(); const selected = params.get('conceptId');
  const [data, setData] = useState<{ concepts: Concept[]; total: number } | null>(null); const [page, setPage] = useState(0);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user || selected) return;
    const controller = new AbortController(); setError(''); setData(null);
    workflowRequest<{ concepts: Concept[]; total: number }>(`/learning-concepts?offset=${page * 30}`, 'GET', undefined, controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [user, selected, page, retry]);
  if (!user) return <p className="workflow-muted">개념별 학습 기록을 보려면 로그인하세요.</p>;
  if (selected) return <div className="workflow-surface workflow-stack"><button type="button" className="workflow-button" onClick={() => setParams({ view: 'concepts' })}>← 개념 목록</button><ConceptDetail key={selected} id={selected} /></div>;
  return <div className="workflow-surface workflow-stack"><h2 className="workflow-view-title">개념별 학습 기록</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></p>
      : !data ? <p role="status">기록을 불러오는 중…</p> : <>
        <p className="workflow-muted">학습한 개념 {data.total}개 · 자료 버전별로 기록해요.</p>
        {data.concepts.map(c => <Card key={c.id} className="workflow-panel workflow-stack"><div className="workflow-card-heading"><h3>{c.title}</h3><span className="workflow-badge" data-state={c.state}>{labels[c.state]}</span></div><p className="workflow-meta">수행 근거 {c.evidence_count}개</p>
          <button type="button" className="workflow-button" onClick={() => setParams({ view: 'concepts', conceptId: c.id })}>변화와 근거 보기 →</button></Card>)}
        {!data.total && <p>학습한 개념이 없습니다. 설명 학습을 시작하세요.</p>}
        <div className="workflow-actions"><button type="button" disabled={!page} onClick={() => setPage(p => p - 1)}>이전</button><button type="button" disabled={(page + 1) * 30 >= data.total} onClick={() => setPage(p => p + 1)}>다음</button></div>
      </>}
  </div>;
}
