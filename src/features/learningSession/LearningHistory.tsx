import { Button, InlineAlert } from '../../components/ui';
import { StartRevision } from '../review/ExplanationRevision';
import { reviewRequest } from '../../services/reviews';
import { useState } from 'react';
import { Card } from '../../common';
import { learningRequest, type LearningHistoryItem, type SessionSummary } from '../../services/learningSessions';
import LearningFeedback from './LearningFeedback';
import Markdown from './LearningMarkdown';
import LearningLink from './LearningLink';

export default function LearningHistory({ sessionId }: { sessionId?: string }) {
  const [data, setData] = useState<{ items?: LearningHistoryItem[]; sessions?: SessionSummary[] } | null>(null);
  const [cards, setCards] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try { setData(await learningRequest(sessionId ? `/${sessionId}/history` : '/history')); }
    catch (e) { setError(e instanceof Error ? e.message : '기록을 불러오지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <Card className="learning-card" style={{ marginTop: 24 }}>
    <h2>{sessionId ? '내 학습 기록' : '완료한 학습'}</h2>
    {!data && <Button type="button" disabled={busy} onClick={() => { void load(); }}>{busy ? '불러오는 중…' : sessionId ? '내 답변·피드백 보기' : '완료한 학습 보기'}</Button>}
    {error && <InlineAlert tone="error">{error}</InlineAlert>}
    {data?.sessions && <ul className="learning-resume-list">{data.sessions.map(record => <li key={record.id}>
      <LearningLink to={`/learn/${record.id}`}><span className="learning-resume-material"><strong>{record.material_name}</strong>
        <small>{record.status === 'completed' ? '완료' : '취소'} · {new Date(record.updated_at).toLocaleDateString('ko-KR')}</small></span><span className="learning-resume-action">기록 보기 →</span></LearningLink>
    </li>)}{!data.sessions.length && <li>완료한 학습이 없습니다.</li>}</ul>}
    {data?.items?.map(item => <details className="learning-result-row" key={item.id}><summary>{item.title}{item.skipped ? ' · 건너뜀' : ''}</summary>
      {item.question && <Markdown text={item.question} />}
      {item.answer ? <><h3>내 설명</h3><Markdown text={item.answer} /></> : <p>제출한 설명이 없습니다.</p>}
      {item.feedback && <LearningFeedback feedback={item.feedback} />}
      {sessionId && item.answer && <StartRevision sessionId={sessionId} itemId={item.id} />}
      {item.check && <><h3>확인 문제</h3><Markdown text={item.check.question} />
        {item.check_result && <><p>내 선택: {item.check.options[item.check_result.selected]}</p><p>정답: {item.check.options[item.check_result.answer_index]}</p><Markdown text={item.check_result.explanation} /></>}</>}
      {Object.entries(item.help).filter(([, text]) => text).map(([kind, text]) => <details key={kind}><summary>{({ source: '원문', hint1: '첫 힌트', hint2: '추가 힌트', reference: '모범 설명' } as Record<string, string>)[kind] || '사용한 도움'}</summary><Markdown text={text!} /></details>)}
      {sessionId && (cards[item.id] ? <LearningLink to={`/learn/review/${cards[item.id]}`} className="ui-button ui-button--secondary">복습 시작 →</LearningLink>
        : <Button type="button" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void reviewRequest<{ id: string }>('', 'POST', { session_id: sessionId, item_id: item.id })
            .then(card => setCards(previous => ({ ...previous, [item.id]: card.id })))
            .catch(e => setError(e instanceof Error ? e.message : '복습을 추가하지 못했어요.')).finally(() => setBusy(false));
        }}>복습에 추가</Button>)}
    </details>)}
  </Card>;
}
