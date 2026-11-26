import SelectField from '../../components/SelectField';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { workflowRequest, type IssueDetail } from '../../services/workflow';
export default function QuizIssueLink({ attemptId, questionIndex }: { attemptId: string; questionIndex: number }) {
  const [concepts, setConcepts] = useState<{ id: string; title: string }[] | null>(null);
  const [selected, setSelected] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run() {
    setBusy(true); setError('');
    try {
      if (concepts === null) setConcepts((await workflowRequest<{ concepts: { id: string; title: string }[] }>(`/learning-issues/quiz/${attemptId}/concepts`)).concepts);
      else setIssue((await workflowRequest<IssueDetail>('/learning-issues/from-quiz', 'POST', { attempt_id: attemptId, question_index: questionIndex, concept_id: selected })).issue.id);
    } catch (e) { setError(e instanceof Error ? e.message : '연결하지 못했어요.'); }
    finally { setBusy(false); }
  }
  if (issue) return <Link to={`/review?tab=issues&issueId=${issue}`}>연결한 학습 이슈 보기 →</Link>;
  return <div>{concepts && (concepts.length ? <SelectField label="관련 개념" value={selected} onChange={setSelected} placeholder="선택하세요" disabled={busy}
    options={concepts.map(c => ({ value: c.id, label: c.title }))} />
    : <p>설명 학습을 완료한 뒤 개념을 연결하세요.</p>)}
    <button type="button" className="workflow-button" aria-busy={busy} disabled={busy || (concepts !== null && !selected)} onClick={() => { void run(); }}>{busy ? concepts === null ? '개념 불러오는 중…' : '연결 중…' : concepts === null ? '학습 이슈에 연결' : '선택한 개념에 연결'}</button>
    {concepts && <p className="workflow-muted">직접 연결한 오답은 확인 필요로 기록됩니다.</p>}{error && <p role="alert">{error}</p>}</div>;
}
