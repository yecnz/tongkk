import type { Feedback } from '../../services/learningSessions';

const labels = { met: '설명에서 확인됨', missing: '설명에 빠진 부분', contradicted: '다시 확인할 부분', uncertain: '판단 보류' };
export default function LearningFeedback({ feedback }: { feedback: Feedback }) {
  return <div className="learning-feedback-list">{feedback.criteria.map(criterion =>
    <section className="learning-feedback" key={criterion.criterion_id}>
      <span className={`learning-badge${criterion.status === 'met' ? '' : ' is-pink'}`}>{labels[criterion.status]}</span>
      <p>{criterion.reason}</p>
      {criterion.student_quote && <blockquote>내 설명: {criterion.student_quote}</blockquote>}
      {criterion.source_refs.map((ref, i) => <details key={`${ref.unit_id}-${i}`}><summary>판정 근거 보기</summary><blockquote>{ref.quote}</blockquote></details>)}
    </section>)}</div>;
}
