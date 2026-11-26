import { Button, InlineAlert } from '../../components/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { listLearningSessions, type SessionSummary } from '../../services/learningSessions';
import { learningTargetUrl } from '../../services/learningTargets';
import type { ResumePoint } from '../../services/dashboardState';

export default function LearningBriefing({ resumePoint }: { resumePoint?: ResumePoint | null }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(false);
    listLearningSessions().then(result => {
      if (!active) return;
      setSessions(result.sessions.filter(session => !['completed', 'abandoned'].includes(session.status)));
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user, retry]);
  if (!user) return null;
  return <Card className="workflow-surface workflow-panel workflow-briefing" aria-label="이어서 학습하기">
    <div className="workflow-heading"><h2 className="workflow-panel-title">이어서 학습하기</h2><Link to="/learn" className="ui-button ui-button--secondary">새 학습 →</Link></div>
    {(resumePoint || sessions.length > 0) && <ul className="workflow-briefing-list">
      {resumePoint && <li><Link className="workflow-briefing-link" to={resumePoint.route} state={resumePoint.state}><span><strong>{resumePoint.title}</strong><small>{resumePoint.course} · {resumePoint.activity}</small></span><span className="workflow-row-action">이어서 하기 →</span></Link></li>}
      {sessions.slice(0, 1).map(session => <li key={session.id}><Link className="workflow-briefing-link" to={learningTargetUrl({ kind: 'session', id: session.id })}><span><strong>{session.material_name}</strong><small>진행 중인 설명 학습</small></span><span className="workflow-row-action">이어서 하기 →</span></Link></li>)}
    </ul>}
    {loading && <p role="status">학습을 확인하는 중…</p>}
    {!loading && !resumePoint && !sessions.length && !error && <p>이어갈 학습이 없습니다. 새 학습을 시작해 주세요.</p>}
    {error && <InlineAlert tone="error">진행 중 학습을 불러오지 못했어요. <Button type="button" onClick={() => setRetry(n => n + 1)}>학습 다시 불러오기</Button></InlineAlert>}
  </Card>;
}
