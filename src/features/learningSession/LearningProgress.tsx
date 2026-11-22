import { Card } from '../../common';
import type { LearningSession } from '../../services/learningSessions';

export default function LearningProgress({ session, stage, reading }: { session: LearningSession; stage: string; reading: boolean }) {
  const finished = ['completed', 'abandoned'].includes(session.status);
  const steps = reading || session.current?.introduction ? ['먼저 읽기', '직접 설명', '피드백·보완', '기초 확인'] : ['직접 설명', '피드백·보완', '기초 확인'];
  const phase = session.current?.phase || '';
  const current = reading ? 0 : phase.startsWith('check') ? steps.length - 1 : ['repair', 'recall_feedback'].includes(phase) ? steps.length - 2 : steps.length - 3;
  return <Card className="learning-card learning-progress" role="region" aria-label="학습 진행 상태">
    <div className="learning-section-heading"><div><p className="learning-eyebrow">{session.material_name}</p>
      <strong>{finished ? '이번 세션 결과' : session.status === 'preparing' || session.status === 'failed' ? '학습 준비' : `개념 ${(session.current?.position ?? 0) + 1} / ${session.concept_count}`}</strong></div>
      <span className="learning-badge">{stage}</span></div>
    <div className="learning-progress-meta"><span>{session.completed_count} / {session.concept_count}개 개념 진행</span><span>목표 {session.target_minutes}분</span></div>
    <progress value={session.completed_count} max={session.concept_count} aria-label="개념 진행률" />
    {!finished && session.current && <ol className="learning-steps" aria-label="현재 개념의 학습 순서">{steps.map((label, index) =>
      <li key={label} aria-current={session.status === 'active' && index === current ? 'step' : undefined} className={index < current ? 'is-past' : ''}>
        <span aria-hidden="true">{index < current ? '✓' : index + 1}</span>{label}</li>)}</ol>}
  </Card>;
}
