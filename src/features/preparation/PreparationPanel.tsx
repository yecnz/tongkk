import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../common';
import { fetchCourses } from '../../services/courses';
import { queuePreparation, type Preparation, type PreparationKind } from '../../services/preparation';
import { workflowRequest } from '../../services/workflow';
import { invalidateSummariesCache } from '../../services/summaries';
import { invalidateQuizSetsCache } from '../../services/quizSets';
const labels: Record<PreparationKind, string> = { summary: '요약', quiz: '퀴즈', pack: '설명 학습' };
export function PreparationOptions({ value, onChange, disabled }: { value: PreparationKind[]; onChange: (v: PreparationKind[]) => void; disabled?: boolean }) {
  return <div className="workflow-options">{(Object.keys(labels) as PreparationKind[]).map(kind => <label key={kind}><input type="checkbox" disabled={disabled} checked={value.includes(kind)} onChange={e => onChange(e.target.checked ? [...value, kind] : value.filter(k => k !== kind))} />{labels[kind]}</label>)}</div>;
}
export default function PreparationPanel({ course, materialId, onApplied }: { course: string; materialId: string; onApplied?: (kind: PreparationKind, id: string) => void }) {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<Preparation[]>([]);
  const [kinds, setKinds] = useState<PreparationKind[]>(['summary']); const [pages, setPages] = useState('');
  const [regenerate, setRegenerate] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0); const entry = useRef<string | null>(null);
  const polling = items.some(r => r.artifacts.some(a => a.status === 'queued'));
  useEffect(() => {
    if (!open) return;
    let active = true;
    async function load() {
      const id = (await fetchCourses()).find(c => c.name === course)?.id;
      if (!id) throw new Error('과목을 찾을 수 없습니다.');
      const value = await workflowRequest<{ requests: Preparation[] }>(`/preparation-requests?${new URLSearchParams({ course_id: id, material_id: materialId })}`);
      if (active) { setItems(value.requests); setError(''); }
    }
    void load().catch(e => { if (active) setError(e.message); });
    const timer = polling ? setInterval(() => { void load().catch(e => { if (active) setError(e.message); }); }, 2500) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [open, course, materialId, retry, polling]);
  async function create() {
    if (busy) return;
    entry.current ||= crypto.randomUUID(); setBusy(true); setError('');
    try { await queuePreparation(course, materialId, kinds, pages, regenerate, entry.current); entry.current = null; setRetry(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : '준비를 시작하지 못했어요.'); }
    finally { setBusy(false); }
  }
  async function action(id: string, name: string) {
    setBusy(true); setError('');
    try {
      const result = await workflowRequest<{ applied_id: string | null }>(`/preparation-requests/artifacts/${id}/actions`, 'POST', { action: name });
      invalidateSummariesCache(course); invalidateQuizSetsCache(course);
      if (name === 'apply' && result.applied_id) { const artifact = items.flatMap(r => r.artifacts).find(a => a.id === id); if (artifact) onApplied?.(artifact.kind, result.applied_id); }
      setRetry(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : '결과를 적용하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <Card className="workflow-surface workflow-panel workflow-stack workflow-preparation"><button type="button" className="workflow-preparation-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>학습 자료 자동 준비 {open ? '접기' : '열기'}</button>
    {open && <><p className="workflow-muted">요약·퀴즈·설명 학습 초안을 검토하고 저장해 주세요.</p>
      <PreparationOptions value={kinds} disabled={busy} onChange={value => { entry.current = null; setKinds(value); }} />
      <label className="workflow-field">페이지 범위 <input value={pages} disabled={busy} placeholder="전체 또는 1-3, 5" onChange={e => { entry.current = null; setPages(e.target.value); }} /></label>
      <label className="workflow-check"><input type="checkbox" checked={regenerate} disabled={busy} onChange={e => { entry.current = null; setRegenerate(e.target.checked); }} />기존 결과 대신 새로 생성</label>
      <button type="button" className="workflow-button workflow-primary" disabled={busy || !kinds.length} onClick={() => { void create(); }}>선택한 학습 자료 준비</button>
      {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>상태 확인</button></p>}
      {items.map(request => <section className="workflow-stack" key={request.id}><p className="workflow-meta">{request.pages ? `${request.pages}쪽` : '전체 범위'}{request.source_changed ? ' · 원문 변경' : ''}</p>
        {request.artifacts.map(artifact => <div className="workflow-subsection" key={artifact.id}><div className="workflow-card-heading"><h3>{labels[artifact.kind]}</h3><span className="workflow-badge" data-state={artifact.status}>{({ queued: '준비 중', ready: '초안 준비됨', failed: '준비 실패', applied: '저장됨', discarded: '폐기됨' })[artifact.status]}</span></div>
          {artifact.status === 'ready' && <details className="workflow-details"><summary>초안 확인</summary>{artifact.preview.content && <p style={{ whiteSpace: 'pre-wrap' }}>{artifact.preview.content}</p>}
            {artifact.preview.questions?.map((q, i) => <div key={i}><p>{q.question}</p><ol>{q.options.map((o, j) => <li key={j}>{o}</li>)}</ol><p>{q.explanation}</p></div>)}
            {artifact.preview.concepts?.map((title, i) => <p key={i}>{title}</p>)}</details>}
          <div className="workflow-actions">
            {artifact.status === 'ready' && <button type="button" className="workflow-primary" disabled={busy || request.source_changed} onClick={() => { void action(artifact.id, 'apply'); }}>확인한 초안 저장</button>}
            {artifact.status === 'failed' && artifact.generation < 3 && <button type="button" disabled={busy || request.source_changed} onClick={() => { void action(artifact.id, 'retry'); }}>실패한 작업 다시 시도</button>}
            {!['applied', 'discarded'].includes(artifact.status) && <button type="button" disabled={busy} onClick={() => { void action(artifact.id, 'discard'); }}>취소·폐기</button>}
            {artifact.status === 'applied' && artifact.kind === 'pack' && <Link to={`/learn?${new URLSearchParams({ course, material: materialId })}`}>설명 학습 시작 →</Link>}
          </div>
        </div>)}
      </section>)}
    </>}
  </Card>;
}
