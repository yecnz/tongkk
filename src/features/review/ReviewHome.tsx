import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import LearningLayout from '../learningSession/LearningLayout';
import ReviewOverview from '../learningSession/ReviewOverview';
import ReviewNotes from '../../pages/ReviewNotes';
import { reviewTab } from '../../services/learningTargets';

export default function ReviewHome() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = reviewTab(params.get('tab'));
  return <LearningLayout><h1>복습 관리</h1>
    <nav className="workflow-tabs" aria-label="복습 보기">
      {([['today', '오늘 복습'], ['wrong', '오답 문항']] as const).map(([id, label]) =>
        <button type="button" key={id} aria-pressed={tab === id} onClick={() => setParams({ tab: id })}>{label}</button>)}
    </nav>
    {!user ? <p>로그인하면 복습과 학습 기록을 확인할 수 있어요.</p>
      : tab === 'wrong' ? <ReviewNotes key={user.id} embedded /> : <ReviewOverview key={user.id} variant="all" />}
  </LearningLayout>;
}
