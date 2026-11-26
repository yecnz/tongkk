import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import LearningLayout from '../features/learningSession/LearningLayout';
import LearningSetup from '../features/learningSession/LearningSetup';
import LearningRunner from '../features/learningSession/LearningRunner';
import StudyPathReturn from '../features/studyPath/StudyPathReturn';

export default function LearningSession() {
  const { user } = useAuth();
  const { sessionId } = useParams();
  if (!user) return <Navigate to="/auth" replace />;
  return <LearningLayout key={user.id}><StudyPathReturn />{sessionId
    ? <LearningRunner key={sessionId} id={sessionId} userId={user.id} />
    : <LearningSetup />}</LearningLayout>;
}
