import { useSearchParams } from 'react-router-dom';
import { studyPathReturnUrl } from '../../services/studyPaths';
import LearningLink from '../learningSession/LearningLink';

export default function StudyPathReturn() {
  const [params] = useSearchParams();
  const url = studyPathReturnUrl(params.get('studyPath'));
  return url ? <div className="learning-actions"><LearningLink to={url} className="learning-button">← 학습 코스로 돌아가기</LearningLink></div> : null;
}
