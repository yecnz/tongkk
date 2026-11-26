import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import type { BriefingItem } from '../../services/briefing';
import { learningTargetUrl } from '../../services/learningTargets';
import { reviewRequest, type ReviewCard } from '../../services/reviews';
import { workflowRequest } from '../../services/workflow';

type Recommendations = {
  issues: { id: string; concept_id: string; title: string }[];
  prerequisites?: { concept_id: string; title: string; reason: string }[];
};
type Recommendation = { title: string; reason: string; urgent: boolean; href: string };

export default function LearningRecommendations({ items }: { items: BriefingItem[] }) {
  const { user } = useAuth();
  const [learning, setLearning] = useState<Recommendation[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setErrors([]);
    Promise.allSettled([
      reviewRequest<{ cards: ReviewCard[] }>(),
      workflowRequest<Recommendations>('/learning-concepts/recommendations'),
    ]).then(([reviews, concepts]) => {
      if (!active) return;
      const cards = reviews.status === 'fulfilled' ? reviews.value.cards.filter(card => !card.source_changed).slice(0, 2) : [];
      const issues = concepts.status === 'fulfilled' ? concepts.value.issues.filter(issue => !cards.some(card => card.concept_id === issue.concept_id)).slice(0, 1) : [];
      const prerequisites = concepts.status === 'fulfilled' ? (concepts.value.prerequisites ?? []).slice(0, 1) : [];
      setLearning([
        ...cards.map(card => ({ title: card.title, reason: '예정된 복습 · 기억에서 다시 설명하기', urgent: false, href: learningTargetUrl({ kind: 'review', id: card.id }) })),
        ...issues.map(issue => ({ title: issue.title, reason: '보완할 학습 이슈', urgent: false, href: learningTargetUrl({ kind: 'issue', id: issue.id }) })),
        ...prerequisites.map(item => ({ title: item.title, reason: item.reason, urgent: false, href: `/learn/connected/${encodeURIComponent(item.concept_id)}` })),
      ]);
      setErrors([...(reviews.status === 'rejected' ? ['복습'] : []), ...(concepts.status === 'rejected' ? ['학습 이슈'] : [])]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user, retry]);

  const schedule = items.flatMap(item => item.target ? [{ ...item, href: learningTargetUrl(item.target) }] : []);
  // 임박한 일정과 예정된 복습을 먼저 보여주고, 전체 목록으로 나머지 항목을 연결한다.
  const visible = [...schedule.filter(item => item.urgent), ...learning, ...schedule.filter(item => !item.urgent)].slice(0, 4);

  return <>
    {visible.length > 0 && <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0" aria-label="오늘의 추천 목록">
      {visible.map(item => <li key={`${item.href}:${item.title}`}>
        <Link to={item.href} className="flex w-full items-start gap-2.5 rounded-[10px] bg-surface p-3 text-left no-underline hover:bg-muted-surface">
          <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.urgent ? 'bg-pink' : 'bg-cyan'}`} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] font-bold leading-5 break-words text-text-strong">{item.title}</span>
            <span className="text-xs leading-5 break-words text-text-secondary">{item.reason}</span>
          </span>
          <span aria-hidden className="shrink-0 text-text-secondary">→</span>
        </Link>
      </li>)}
    </ul>}
    {loading && <p role="status" className="m-0 mt-2 text-xs leading-5 text-muted">추천을 확인하는 중…</p>}
    {!loading && !visible.length && !errors.length && <p className="m-0 mt-2 text-xs leading-5 text-muted">지금 챙길 추천 항목이 없습니다.</p>}
    {errors.length > 0 && <p role="alert" className="m-0 mt-2 text-xs leading-5 text-text-secondary">{errors.join('·')} 추천을 불러오지 못했어요. <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-bold text-cyan-deep underline" onClick={() => setRetry(n => n + 1)}>추천 다시 불러오기</button></p>}
    {user && <Link to="/review?tab=today" className="mt-3 inline-block text-xs font-bold text-cyan-deep no-underline hover:underline">복습·학습 이슈 전체 보기 →</Link>}
  </>;
}
