import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import CustomSelect from '../../components/CustomSelect';
import { workflowRequest } from '../../services/workflow';
type Member = { id: string; title: string; course_name: string; material_name: string; state: string; source_changed: boolean };
type Graph = { groups: { id: string; title: string; evidence_count: number; members: Member[] }[]; prerequisites: { source: string; target: string }[];
  links: { id: string; source_id: string; target_id: string; relation: string }[]; suggestions: { source_id: string; target_id: string; title: string }[];
  recommendations: { concept_id: string; title: string; reason: string }[] };
const labels: Record<string,string> = { needs_review: '보완 필요', needs_confirmation: '확인 필요', recent_stable: '최근 안정', unassessed: '미평가', awaiting_reassessment: '재평가 대기', source_changed: '원문 변경' };
export default function ConceptGraph() {
  const { user } = useAuth(); const [data,setData] = useState<Graph|null>(null); const [error,setError] = useState('');
  const [busy,setBusy] = useState(false); const [source,setSource] = useState(''); const [target,setTarget] = useState(''); const [relation,setRelation] = useState('prerequisite');
  const [retry,setRetry] = useState(0);
  useEffect(() => { if (!user) return; const c = new AbortController(); workflowRequest<Graph>('/learning-graph','GET',undefined,c.signal).then(setData).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); },[user,retry]);
  async function connect(a:string,b:string,kind:string) { setBusy(true); setError(''); try { setData(await workflowRequest<Graph>('/learning-graph/links','POST',{id:crypto.randomUUID(),source_id:a,target_id:b,relation:kind})); } catch(e) { setError(e instanceof Error ? e.message : '개념을 연결하지 못했어요.'); } finally { setBusy(false); } }
  async function remove(id:string) { setBusy(true); try { setData(await workflowRequest<Graph>(`/learning-graph/links/${id}`,'DELETE')); } catch(e) { setError(e instanceof Error ? e.message : '연결을 해제하지 못했어요.'); } finally { setBusy(false); } }
  if (!user) return <p className="workflow-muted">개념을 연결하려면 로그인해 주세요.</p>;
  const members = data?.groups.flatMap(g => g.members) || []; const names = Object.fromEntries(members.map(m => [m.id,`${m.title} · ${m.course_name}`]));
  return <div className="workflow-surface workflow-stack"><h2 className="workflow-view-title">개념 지도</h2><p className="workflow-muted">같은 개념을 연결하거나 학습 순서를 설정해 주세요. 원문별 기록은 유지됩니다.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError('');setRetry(n=>n+1); }}>다시 확인</button></p>}
    {!data ? <p role="status">지도를 불러오는 중…</p> : <>
      {data.recommendations.map(r=><Card key={r.concept_id} className="workflow-panel workflow-stack"><h3>먼저 보완하기: {r.title}</h3><p className="workflow-muted">{r.reason}</p><Link to={`/stats?view=concepts&conceptId=${r.concept_id}`}>수행 근거 보기 →</Link></Card>)}
      {data.groups.length > 0 && <div className="concept-map" role="region" tabIndex={0} aria-label="개념 관계 지도"><svg viewBox={`0 0 760 ${Math.max(100,data.groups.length*84)}`} aria-label="선수 관계 화살표"><defs><marker id="concept-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted)" /></marker></defs>
        {data.prerequisites.map(e=>{const a=data.groups.findIndex(g=>g.id===e.source),b=data.groups.findIndex(g=>g.id===e.target);return <path key={`${e.source}:${e.target}`} d={`M 490 ${a*84+35} C 700 ${a*84+35},700 ${b*84+35},490 ${b*84+35}`} fill="none" stroke="var(--color-muted)" markerEnd="url(#concept-arrow)"/>;})}
        {data.groups.map((g,i)=><g key={g.id}><rect x="12" y={i*84+8} width="475" height="62" rx="10" fill="var(--color-card)" stroke="var(--color-border)"/><text x="28" y={i*84+33} fill="var(--color-text)" fontSize="15">{g.title.slice(0,35)}</text><text x="28" y={i*84+54} fill="var(--color-muted)" fontSize="12">{new Set(g.members.map(m=>m.course_name)).size}개 과목 · {g.members.length}개 원문 개념 · 근거 {g.evidence_count}개</text></g>)}
      </svg></div>}
      {data.groups.length > 0 && <p className="workflow-map-hint workflow-meta">좌우로 움직여 개념과 학습 순서를 확인해 주세요.</p>}
      {!members.length ? <p>학습을 완료하면 개념이 표시됩니다.</p> : <>
        <Card className="workflow-panel workflow-stack"><h3>개념 연결</h3><div className="workflow-form-grid"><label className="workflow-field">먼저 공부할 개념 / 같은 개념<CustomSelect value={source} onChange={setSource} options={[{value:'',label:'선택'},...members.filter(m=>!m.source_changed).map(m=>({value:m.id,label:`${names[m.id]} · ${m.material_name}`}))]} aria-label="먼저 공부할 개념 / 같은 개념" /></label>
          <label className="workflow-field">연결 유형<CustomSelect value={relation} onChange={setRelation} options={[{value:'prerequisite',label:'선수 개념 → 다음 개념'},{value:'equivalent',label:'같은 뜻의 개념'}]} aria-label="연결 유형" /></label>
          <label className="workflow-field workflow-span-full">연결할 개념<CustomSelect value={target} onChange={setTarget} options={[{value:'',label:'선택'},...members.filter(m=>!m.source_changed && m.id!==source).map(m=>({value:m.id,label:`${names[m.id]} · ${m.material_name}`}))]} aria-label="연결할 개념" /></label></div>
          <button type="button" className="workflow-primary" disabled={busy||!source||!target||source===target} onClick={()=>{void connect(source,target,relation);}}>연결 저장</button></Card>
        {data.suggestions.length>0 && <Card className="workflow-panel workflow-stack"><h3>같은 개념인지 확인해 주세요</h3>{data.suggestions.map(s=><div className="workflow-item" key={`${s.source_id}:${s.target_id}`}><p>{names[s.source_id]} ↔ {names[s.target_id]}</p><button type="button" disabled={busy} onClick={()=>{void connect(s.source_id,s.target_id,'equivalent');}}>같은 개념으로 연결</button></div>)}</Card>}
        {data.groups.map(g=><Card className="workflow-panel workflow-stack" key={g.id}><h3>{g.title}</h3>{g.members.map(m=><p key={m.id}><Link to={`/stats?view=concepts&conceptId=${m.id}`}>{m.course_name} · {m.material_name} · {labels[m.state] || m.state} →</Link></p>)}</Card>)}
        <Card className="workflow-panel workflow-stack"><h3>저장한 관계</h3>{data.links.map(e=><div className="workflow-card-heading" key={e.id}><p>{names[e.source_id]} {e.relation==='equivalent'?'↔':'→'} {names[e.target_id]}</p><button type="button" disabled={busy} onClick={()=>{void remove(e.id);}}>연결 해제</button></div>)}{!data.links.length&&<p>연결한 관계가 없습니다.</p>}</Card>
      </>}
    </>}
  </div>;
}
