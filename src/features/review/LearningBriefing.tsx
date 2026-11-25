import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { listLearningSessions, type SessionSummary } from '../../services/learningSessions';
import { reviewRequest, type ReviewCard } from '../../services/reviews';
import { workflowRequest } from '../../services/workflow';
import { learningTargetUrl } from '../../services/learningTargets';

export default function LearningBriefing() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [issues, setIssues] = useState<{ id: string; concept_id: string; title: string }[]>([]);
  const [prerequisites,setPrerequisites] = useState<{concept_id:string;title:string;reason:string}[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true); setErrors([]);
    Promise.allSettled([listLearningSessions(), reviewRequest<{ cards: ReviewCard[] }>(), workflowRequest<{ issues: { id: string; concept_id: string; title: string }[]; prerequisites?:{concept_id:string;title:string;reason:string}[] }>('/learning-concepts/recommendations')]).then(([a, b, c]) => {
      if (!active) return;
      setSessions(a.status === 'fulfilled' ? a.value.sessions : []);
      setCards(b.status === 'fulfilled' ? b.value.cards.filter(c => !c.source_changed) : []);
      setIssues(c.status === 'fulfilled' ? c.value.issues : []);
      setPrerequisites(c.status === 'fulfilled' ? c.value.prerequisites || [] : []);
      setErrors([...(c.status === 'rejected' ? ['학습 이슈'] : []),...(a.status === 'rejected' ? ['진행 중 학습'] : []), ...(b.status === 'rejected' ? ['복습'] : [])]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user, retry]);
  if (!user) return null;
  return <Card className="workflow-surface workflow-panel workflow-briefing" aria-label="이어갈 학습과 복습">
    <div className="workflow-heading"><h2 className="workflow-panel-title">이어서 학습하기</h2><Link to="/learn" className="workflow-button">새 학습 →</Link></div>
    {loading ? <p role="status">학습을 확인하는 중…</p> : <>
      <ul className="workflow-briefing-list">
        {sessions.slice(0, 1).map(s => <li key={s.id}><Link className="workflow-briefing-link" to={learningTargetUrl({ kind: 'session', id: s.id })}><span><strong>{s.material_name}</strong><small>진행 중인 설명 학습</small></span><span className="workflow-row-action">이어서 하기 →</span></Link></li>)}
        {cards.slice(0, 2).map(c => <li key={c.id}><Link className="workflow-briefing-link" to={learningTargetUrl({ kind: 'review', id: c.id })}><span><strong>{c.title}</strong><small>예정된 복습</small></span><span className="workflow-row-action">기억에서 다시 설명하기 →</span></Link></li>)}
        {issues.filter(i => !cards.slice(0, 2).some(c => c.concept_id === i.concept_id)).slice(0, 1).map(i => <li key={i.id}><Link className="workflow-briefing-link" to={learningTargetUrl({ kind: 'issue', id: i.id })}><span><strong>{i.title}</strong><small>보완할 학습 이슈</small></span><span className="workflow-row-action">보완 근거 확인하기 →</span></Link></li>)}
        {prerequisites.slice(0,1).map(p=><li key={p.concept_id}><Link className="workflow-briefing-link" to={`/stats?view=concepts&conceptId=${p.concept_id}`}><span><strong>{p.title}</strong><small>{p.reason}</small></span><span className="workflow-row-action">먼저 보완하기 →</span></Link></li>)}
      </ul>
      {!sessions.length && !cards.length && !issues.length && !prerequisites.length && !errors.length && <p>이어갈 학습이 없습니다. 새 학습을 시작하세요.</p>}
      <div className="workflow-briefing-footer"><Link to="/review?tab=today">복습 전체 보기 →</Link></div>
      {errors.length > 0 && <p role="alert">{errors.join('·')} 정보를 불러오지 못했어요. <button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></p>}
    </>}
  </Card>;
}
