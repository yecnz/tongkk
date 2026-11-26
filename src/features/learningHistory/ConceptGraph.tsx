import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { workflowRequest } from '../../services/workflow';
type Member = { id: string; title: string; course_name: string; material_name: string; state: string; source_changed: boolean };
type Graph = { groups: { id: string; title: string; evidence_count: number; members: Member[] }[]; prerequisites: { source: string; target: string }[];
  links: { id: string; source_id: string; target_id: string; relation: string }[]; suggestions: { source_id: string; target_id: string; title: string }[];
  recommendations: { concept_id: string; title: string; reason: string }[];
  connections: { source: string; target: string }[]; study_target_id: string | null;
  study_plan: { concept_id: string; title: string; course_name: string; reason: string }[] };
const labels: Record<string,string> = { needs_review: '보완 필요', needs_confirmation: '확인 필요', recent_stable: '최근 안정', unassessed: '미평가', awaiting_reassessment: '다시 확인 예정', source_changed: '원문 변경' };
export default function ConceptGraph() {
  const { user } = useAuth(); const [data,setData] = useState<Graph|null>(null); const [error,setError] = useState('');
  const [retry,setRetry] = useState(0);
  useEffect(() => { if (!user) return; const c = new AbortController(); workflowRequest<Graph>('/learning-graph','GET',undefined,c.signal).then(setData).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); },[user,retry]);
  if (!user) return <p className="workflow-muted">개념을 연결하려면 로그인해 주세요.</p>;
  const members = data?.groups.flatMap(g => g.members) || [];
  return <div className="workflow-surface workflow-stack"><h2 className="workflow-view-title">개념 지도</h2><p className="workflow-muted">자료에서 관련 개념을 찾아, 이해가 필요한 순서로 학습을 안내해요.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError('');setRetry(n=>n+1); }}>다시 확인</button></p>}
    {!data ? <p role="status">지도를 불러오는 중…</p> : <>
      {data.study_plan?.length > 0 && data.study_target_id && <Card className="workflow-panel workflow-stack">
        <h3>연결된 개념, 순서대로 배우기</h3><p className="workflow-muted">설명을 읽고 직접 풀어보세요. 한 개념을 마치면 다음 학습을 이어서 안내해요.</p>
        <ol className="concept-study-plan" aria-label="추천 학습 순서">{data.study_plan.map((step,index)=><li key={step.concept_id}>
          <span className="concept-study-number" aria-hidden="true">{index+1}</span><div><strong>{step.title}</strong><p className="workflow-meta">{step.course_name}</p><p className="workflow-muted">{step.reason}</p></div>
        </li>)}</ol>
        <Link className="workflow-button workflow-primary" to={`/learn/connected/${data.study_target_id}`}>추천 순서로 학습하기 →</Link>
      </Card>}
      {data.groups.length > 0 && <div className="concept-map" role="region" tabIndex={0} aria-label="개념 관계 지도"><svg viewBox={`0 0 760 ${Math.max(100,data.groups.length*84)}`} aria-label="개념 사이의 학습 흐름"><defs><marker id="concept-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted)" /></marker></defs>
        {data.prerequisites.map(e=>{const a=data.groups.findIndex(g=>g.id===e.source),b=data.groups.findIndex(g=>g.id===e.target);return <path key={`${e.source}:${e.target}`} d={`M 490 ${a*84+35} C 700 ${a*84+35},700 ${b*84+35},490 ${b*84+35}`} fill="none" stroke="var(--color-muted)" markerEnd="url(#concept-arrow)"/>;})}
        {(data.connections || []).map(e=>{const a=data.groups.findIndex(g=>g.id===e.source),b=data.groups.findIndex(g=>g.id===e.target);return <path key={`related:${e.source}:${e.target}`} d={`M 490 ${a*84+35} C 620 ${a*84+35},620 ${b*84+35},490 ${b*84+35}`} fill="none" stroke="var(--color-border)" strokeDasharray="5 5"/>;})}
        {data.groups.map((g,i)=><g key={g.id}><rect x="12" y={i*84+8} width="475" height="62" rx="10" fill="var(--color-card)" stroke="var(--color-border)"/><text x="28" y={i*84+33} fill="var(--color-text)" fontSize="15">{g.title.slice(0,35)}</text><text x="28" y={i*84+54} fill="var(--color-muted)" fontSize="12">{new Set(g.members.map(m=>m.course_name)).size}개 과목 · {g.members.length}개 원문 개념 · 근거 {g.evidence_count}개</text></g>)}
      </svg></div>}
      {data.groups.length > 0 && <p className="workflow-map-hint workflow-meta">좌우로 움직여 개념과 학습 순서를 확인해 주세요.</p>}
      {!members.length ? <p>자료로 학습을 시작하면 관련 개념을 찾아드려요.</p> : <>
        {data.groups.map(g=><Card className="workflow-panel workflow-stack concept-record-card" key={g.id}>
          <div className="workflow-card-heading"><h3>{g.title}</h3>{g.members.length > 1 && <span className="workflow-meta">{g.members.length}개 자료의 학습 기록</span>}</div>
          <ul className="concept-record-list">
            {g.members.map(m=><li className="concept-record-row" key={m.id}>
              <div className="concept-record-copy">
                <div className="concept-record-meta"><span className="concept-record-course">{m.course_name}</span><span className="workflow-badge" data-state={m.state}>{labels[m.state] || m.state}</span></div>
                <p className="concept-record-material"><span>자료</span>{m.material_name}</p>
              </div>
              <Link className="workflow-button concept-record-action" to={`/stats?view=concepts&conceptId=${m.id}`} aria-label={`${m.course_name}의 ${m.title} 학습 기록 보기`}>
                학습 기록 보기 <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
            </li>)}
          </ul>
        </Card>)}

      </>}
    </>}
  </div>;
}
