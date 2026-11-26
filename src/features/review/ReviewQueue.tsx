import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../common';
import { useAuth } from '../../AuthContext';
import { reviewRequest, type ReviewCard } from '../../services/reviews';
import { workflowRequest, WorkflowError } from '../../services/workflow';

function Row({ card, refresh }: { card: ReviewCard; refresh: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const pending = useRef<{ action: string; revision: number; command_key: string; days: number } | null>(null);
  async function action(name: string) {
    if (busy) return;
    pending.current ||= { action: name, revision: card.revision || 0, command_key: crypto.randomUUID(), days: 1 };
    setBusy(true); setError('');
    try { await workflowRequest(`/learning-workflow/reviews/${card.id}/actions`, 'POST', pending.current); pending.current = null; refresh(); }
    catch (e) { if (e instanceof WorkflowError && e.status < 500) pending.current = null; setError(e instanceof Error ? e.message : '변경하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <Card className="workflow-panel workflow-stack"><div className="workflow-card-heading"><h3>{card.title}</h3><span className="workflow-badge" data-state={card.paused ? 'closed' : 'connected'}>{card.paused ? '일시 정지' : '복습 예정'}</span></div><p className="workflow-meta">{new Date(card.due_at).toLocaleString('ko-KR')}</p>
    {card.source_changed && <p className="workflow-muted">원문이 변경되었습니다. 다시 학습해 주세요.</p>}
    <div className="workflow-actions">{!card.source_changed && !card.paused && <Link className="workflow-button workflow-primary" to={`/learn/review/${card.id}`}>설명하며 복습하기 →</Link>}{[[card.paused ? 'resume' : 'pause', card.paused ? '재개' : '일시 정지'], ['postpone', '1일 미루기']].map(([name, label]) =>
      <button type="button" key={name} disabled={busy || Boolean(pending.current && pending.current.action !== name)} onClick={() => { void action(name); }}>{pending.current?.action === name ? '이전 변경 확인' : label}</button>)}</div>
    {error && <p role="alert">{error} <button type="button" onClick={refresh}>새로 불러오기</button></p>}
  </Card>;
}
export default function ReviewQueue({ day }: { day?: string }) {
  const { user } = useAuth();
  const [cards, setCards] = useState<ReviewCard[]>([]); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0); const [all, setAll] = useState(false);
  useEffect(() => {
    if (!user) return;
    let active = true; setLoading(true); setError('');
    const request = day ? workflowRequest<{ cards: ReviewCard[] }>(`/learning-workflow/reviews/${day}`) : reviewRequest<{ cards: ReviewCard[] }>(`?due_only=${!all}&limit=100`);
    request.then(v => { if (active) setCards(v.cards); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, day, all, retry]);
  if (!user) return null;
  return <section className="workflow-surface workflow-stack" aria-label={day ? '선택한 날의 복습' : '복습 목록'}><h2>{day ? '이 날의 복습' : '오늘 복습'}</h2>
    {!day && <label className="workflow-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />예정·일시 정지 복습도 보기</label>}
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></p>
      : loading ? <p role="status">복습을 불러오는 중…</p> : cards.length ? cards.map(c => <Row key={`${c.id}:${c.revision}`} card={c} refresh={() => setRetry(n => n + 1)} />) : <p>표시할 복습이 없습니다.</p>}
  </section>;
}
