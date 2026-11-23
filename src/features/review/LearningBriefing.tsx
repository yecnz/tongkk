import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { listLearningSessions, type SessionSummary } from '../../services/learningSessions';
import { reviewRequest, type ReviewCard } from '../../services/reviews';
import { learningTargetUrl } from '../../services/learningTargets';

export default function LearningBriefing() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true); setErrors([]);
    Promise.allSettled([listLearningSessions(), reviewRequest<{ cards: ReviewCard[] }>()]).then(([a, b]) => {
      if (!active) return;
      setSessions(a.status === 'fulfilled' ? a.value.sessions : []);
      setCards(b.status === 'fulfilled' ? b.value.cards.filter(c => !c.source_changed) : []);
      setErrors([...(a.status === 'rejected' ? ['진행 중 학습'] : []), ...(b.status === 'rejected' ? ['복습'] : [])]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user, retry]);
  if (!user) return null;
  return <Card className="learning-resume" aria-label="이어갈 학습과 복습">
    <div className="learning-resume-heading"><h2>이어서 학습하기</h2><Link to="/learn">새 학습 →</Link></div>
    {loading ? <p role="status">학습을 확인하는 중…</p> : <>
      <ul className="learning-resume-list">
        {sessions.slice(0, 1).map(s => <li key={s.id}><Link to={learningTargetUrl({ kind: 'session', id: s.id })}>{s.material_name} · 이어서 하기 →</Link></li>)}
        {cards.slice(0, 2).map(c => <li key={c.id}><Link to={learningTargetUrl({ kind: 'review', id: c.id })}>{c.title} · 기억에서 다시 설명하기 →</Link></li>)}
      </ul>
      {!sessions.length && !cards.length && !errors.length && <p>지금 이어갈 학습이 없어요. 새 학습을 시작해보세요.</p>}
      <Link to="/review?tab=today">복습 전체 보기 →</Link>
      {errors.length > 0 && <p role="alert">{errors.join('·')} 정보를 불러오지 못했어요. <button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></p>}
    </>}
  </Card>;
}
