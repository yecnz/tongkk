import { Button, PageHeading } from '../../components/ui';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import LearningLayout from '../learningSession/LearningLayout';
import ReviewQueue from './ReviewQueue';
import LearningIssues from './LearningIssues';
import ReviewNotes from '../../pages/ReviewNotes';
import { reviewTab } from '../../services/learningTargets';

export default function ReviewHome() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = reviewTab(params.get('tab'));
  return <LearningLayout active="오답 노트"><PageHeading title="복습 관리" description="복습할 내용과 보완할 개념을 확인해 주세요." />
    <nav className="ui-tabs" aria-label="복습 보기">
      {([['today', '오늘 복습'], ['issues', '학습 이슈'], ['wrong', '오답 문항']] as const).map(([id, label]) =>
        <Button type="button" key={id} aria-pressed={tab === id} onClick={() => setParams({ tab: id })}>{label}</Button>)}
    </nav>
    {!user ? <p>복습과 학습 기록을 보려면 로그인해 주세요.</p>
      : tab === 'issues' ? <LearningIssues key={user.id} /> : tab === 'wrong' ? <ReviewNotes key={user.id} embedded /> : <ReviewQueue key={user.id} />}
  </LearningLayout>;
}
