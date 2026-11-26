import LearningSession from '../../src/pages/LearningSession';
import Flashcards from '../../src/features/flashcards/Flashcards';
import LearningIssues from '../../src/features/review/LearningIssues';
import StudyPaths from '../../src/features/studyPath/StudyPaths';
import LearningLayout from '../../src/features/learningSession/LearningLayout';
import ExplanationRevision from '../../src/features/review/ExplanationRevision';
import ReviewPractice from '../../src/features/learningSession/ReviewPractice';
import '../../src/styles/learning-workflow.css';

function IssuesDemo() {
  return <LearningLayout active="오답 노트">
    <div className="workflow-page-heading"><h1>복습 관리</h1><p className="workflow-muted">복습할 내용과 보완할 개념을 확인하세요.</p></div>
    <LearningIssues />
  </LearningLayout>;
}

export const learningScreens = {
  explain: LearningSession,
  cards: Flashcards,
  issues: IssuesDemo,
  courses: StudyPaths,
};
export const learningRouteScreens = { revision: ExplanationRevision, review: ReviewPractice };
export default learningScreens;
