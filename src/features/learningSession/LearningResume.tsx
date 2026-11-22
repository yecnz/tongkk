import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { listLearningSessions, type SessionSummary } from '../../services/learningSessions';

const statusLabels: Record<string, string> = { preparing: '준비 중', active: '진행 중', paused: '일시 중단', failed: '준비 확인 필요' };

export default function LearningResume() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    listLearningSessions(controller.signal).then(data => setSessions(data.sessions)).catch(() => {
      if (!controller.signal.aborted) setSessions([]);
    });
    return () => controller.abort();
  }, [user]);
  if (!user) return null;
  return <section style={{ margin: '20px 0', padding: '18px 0', borderBottom: '1px solid var(--color-border-soft)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
      <strong>기억에서 꺼내는 학습</strong><Link to="/learn" style={{ color: 'var(--color-pink)' }}>학습 시작 →</Link>
    </div>
    {sessions.length === 0 ? <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 0 }}>직접 설명하고 부족한 부분을 확인해보세요.</p> :
      <ul style={{ padding: 0, marginBottom: 0, listStyle: 'none' }}>{sessions.slice(0, 5).map(session => <li key={session.id} style={{ marginTop: 10 }}>
        <Link to={`/learn/${session.id}`} style={{ color: 'var(--color-text)' }}>{session.material_name} · {statusLabels[session.status]} · 이어서 하기</Link>
      </li>)}</ul>}
  </section>;
}
