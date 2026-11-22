import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../common';
import { useAuth } from '../../AuthContext';
import { listLearningSessions, type SessionSummary } from '../../services/learningSessions';
import './LearningResume.css';

const statusLabels: Record<string, string> = { preparing: '준비 중', active: '진행 중', paused: '일시 중단', failed: '준비 확인 필요' };
export default function LearningResume({ variant = 'dashboard' }: { variant?: 'dashboard' | 'page' }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    listLearningSessions(controller.signal).then(data => { if (!controller.signal.aborted) setSessions(data.sessions); }).catch(() => {
      if (!controller.signal.aborted) setError('진행 중인 학습을 불러오지 못했어요.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, retry]);
  if (!user) return null;
  return <Card className="learning-resume" role="region" aria-label="진행 중인 학습">
    <div className="learning-resume-heading"><div><h2>{variant === 'page' ? '이어서 학습하기' : '기억에서 꺼내는 학습'}</h2>
      <p>직접 설명하고 부족한 부분을 확인해보세요.</p></div>
      {variant === 'dashboard' && <Link to="/learn" className="learning-resume-start">학습 시작 →</Link>}
    </div>
    {loading ? <p className="learning-resume-message" role="status">진행 중인 학습을 불러오는 중…</p> : error ? <div className="learning-resume-error" role="alert">{error}
      <button type="button" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div> : sessions.length === 0
      ? <p className="learning-resume-message">진행 중인 학습이 없어요.{variant === 'page' ? ' 위에서 새 학습을 시작해보세요.' : ' 새 학습을 시작해보세요.'}</p>
      : <ul className="learning-resume-list">{sessions.slice(0, 5).map(session => <li key={session.id}>
        <Link to={`/learn/${session.id}`}><span className="learning-resume-material"><strong>{session.material_name}</strong><small>{statusLabels[session.status] || '진행 상태 확인'}</small></span>
          <span className="learning-resume-action">이어서 하기 →</span></Link></li>)}</ul>}
  </Card>;
}
