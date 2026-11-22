import type { Feedback } from '../../services/learningSessions';
import LearningExplanation from './LearningExplanation';

const labels = { met: '확인됨', missing: '빠짐', contradicted: '수정 필요', uncertain: '판단 보류' };
export default function LearningFeedback({ feedback }: { feedback: Feedback }) {
  return <div className="learning-feedback-list">{feedback.criteria.map(criterion =>
    <section className="learning-feedback" key={criterion.criterion_id}>
      <span className={`learning-badge${criterion.status === 'met' ? '' : ' is-pink'}`}>{labels[criterion.status]}</span>
      <LearningExplanation text={criterion.reason} label="설명 보기" />
      <details className="learning-feedback-evidence"><summary>근거 보기</summary>
        {criterion.student_quote && <blockquote>내 설명: {criterion.student_quote}</blockquote>}
        {criterion.source_refs.map((ref, i) => <blockquote key={`${ref.unit_id}-${i}`}>원문: {ref.quote}</blockquote>)}
      </details>
    </section>)}</div>;
}
