import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../common';
import { useAuth } from '../../AuthContext';
import { reviewRequest, type ReviewCard } from '../../services/reviews';
import './LearningResume.css';

type Stats = { completed_sessions: number; initial_checks: number; initial_correct: number; due_cards: number;
  changed_cards: number; retention_checks: number; retention_correct: number };
export default function ReviewOverview({ variant = 'dashboard' }: { variant?: 'dashboard' | 'all' | 'stats' }) {
  const { user } = useAuth();
  const [data, setData] = useState<{ cards: ReviewCard[]; stats: Stats; fetchedAt: number } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setData(null); setError('');
    Promise.all([variant === 'stats' ? Promise.resolve({ cards: [] }) : reviewRequest<{ cards: ReviewCard[] }>(`?due_only=${variant !== 'all'}`),
      reviewRequest<Stats>('/stats')]).then(([cards, stats]) => { if (active) setData({ ...cards, stats, fetchedAt: Date.now() }); })
      .catch(() => { if (active) setError('복습 기록을 불러오지 못했어요.'); });
    return () => { active = false; };
  }, [user, retry, variant]);
  if (!user) return null;
  const ratio = (correct: number, total: number) => total ? `${correct}/${total}회` : '아직 기록 없음';
  return <Card className="learning-resume" role="region" aria-label="복습 현황">
    <div className="learning-resume-heading"><div><h2>{variant === 'stats' ? '학습과 기억 유지' : variant === 'all' ? '내 복습 목록' : '오늘 복습'}</h2>
      <p>{variant === 'stats' ? '학습 직후와 시간이 지난 뒤의 독립 수행을 따로 봐요.' : '예정일에 다시 설명하고 문제로 확인해요.'}</p></div>
      {variant !== 'all' && <Link to="/learn" className="learning-resume-start">학습·복습 보기 →</Link>}</div>
    {error ? <div className="learning-resume-error" role="alert">{error}<button type="button" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div>
      : !data ? <p role="status">불러오는 중…</p> : <>
        <p className="learning-resume-message">완료한 학습 {data.stats.completed_sessions}회 · 복습 예정 {data.stats.due_cards}개</p>
        {variant === 'stats' ? <><p>학습 직후 확인: {ratio(data.stats.initial_correct, data.stats.initial_checks)}</p>
          <p>시간을 둔 독립 수행: {ratio(data.stats.retention_correct, data.stats.retention_checks)}</p>
          <p className="learning-resume-message">도움 없이 예정일 이후 설명·문제를 모두 제출한 기록이에요. 판단 보류와 변경된 원문은 제외해요.</p></>
          : data.cards.length === 0 ? <p className="learning-resume-message">{variant === 'all' ? '완료 학습에서 복습할 개념을 등록해보세요.' : '지금 복습할 개념이 없어요.'}</p>
            : <ul className="learning-resume-list">{data.cards.map(card => <li key={card.id}>
              <Link to={card.source_changed ? '/learn' : `/learn/review/${card.id}`}><span className="learning-resume-material"><strong>{card.title}</strong>
                <small>{card.source_changed ? '원문 변경 · 새 학습 필요' : new Date(card.due_at).getTime() <= data.fetchedAt ? '복습 예정일 · 기억에서 다시 설명해보세요' : `${new Date(card.due_at).toLocaleDateString('ko-KR')} 복습 예정`}</small></span>
                <span className="learning-resume-action">{card.source_changed ? '새 학습' : '복습하기'} →</span></Link></li>)}</ul>}
        {data.stats.changed_cards > 0 && <p className="learning-resume-message">원문이 바뀐 개념 {data.stats.changed_cards}개는 새 학습이 필요해요.</p>}
      </>}
  </Card>;
}
