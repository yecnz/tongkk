import { useEffect, useRef, useState } from 'react';
import { Card } from '../../common';
import { fetchCourses } from '../../services/courses';
import { removeLocalDraft } from '../../services/learningSessions';
import { useLearningSession } from './useLearningSession';
import { useLearningNavigation } from './navigation';
import RecallInput from './RecallInput';
import Markdown from './LearningMarkdown';
import LearningLink from './LearningLink';
import LearningProgress from './LearningProgress';
import LearningFeedback from './LearningFeedback';
import LearningHelp from './LearningHelp';
import LearningResults from './LearningResults';

function readIntroduction(key: string) {
  try { return sessionStorage.getItem(key) === 'read'; } catch { return false; }
}

export default function LearningRunner({ id, userId }: { id: string; userId: string }) {
  const { session, error, busy, pendingRetry, command, retryPending, refresh, accept } = useLearningSession(id, userId);
  const { beforeLeaveRef } = useLearningNavigation();
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState(false);
  const [reportReason, setReportReason] = useState('question');
  const [reportText, setReportText] = useState('');
  const [readItems, setReadItems] = useState<Set<string>>(() => new Set());
  const [courseName, setCourseName] = useState('');
  const [draftError, setDraftError] = useState('');
  const flushDraft = useRef<(() => Promise<void>) | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const item = session?.current;
  const courseId = session?.course_id;
  const blocked = busy || pendingRetry;
  const introKey = `tongkk:learning-introduction:${userId}:${id}:${item?.id}`;
  const reading = Boolean(item?.introduction && item.phase === 'recall_answering' && !item.draft.trim() && !readItems.has(item.id) && !readIntroduction(introKey));
  const status = session?.status;

  useEffect(() => { setSelected(null); setReport(false); setReportText(''); setReportReason('question'); }, [item?.id]);
  useEffect(() => {
    if (item && item.phase !== 'recall_answering') removeLocalDraft(userId, id, item.id);
  }, [item, id, userId]);
  useEffect(() => {
    if (!courseId) return;
    let active = true;
    fetchCourses().then(courses => { if (active) setCourseName(courses.find(c => c.id === courseId)?.name || ''); }).catch(() => undefined);
    return () => { active = false; };
  }, [courseId]);
  useEffect(() => {
    beforeLeaveRef.current = async () => {
      if (blocked) throw new Error('진행 중인 요청의 결과를 확인한 뒤 이동해주세요.');
      await flushDraft.current?.();
    };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, blocked]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }, [item?.id, item?.phase, reading, status]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setDraftError('');
    try {
      if (['pause', 'finish', 'unknown', 'skip'].includes(action)) await flushDraft.current?.();
      await command('actions', { action, ...extra });
    } catch (e) { setDraftError(e instanceof Error ? e.message : '진행을 저장하지 못했습니다.'); }
  }
  function startRecall() {
    try { sessionStorage.setItem(introKey, 'read'); } catch { /* This visit still remembers the choice in React state. */ }
    setReadItems(previous => new Set(previous).add(item!.id));
  }
  if (!session) return <Card className="learning-card learning-state"><h1 ref={heading} tabIndex={-1}>학습 세션</h1>
    <p role="status">{error || '저장된 학습을 불러오는 중…'}</p>
    {error && <button type="button" onClick={() => { void refresh(); }}>다시 불러오기</button>}
    <LearningLink to="/learn" className="learning-button">학습 설정으로</LearningLink></Card>;
  const permits = (value: string) => session.allowed_actions.includes(value);
  const operation = session.operation;
  const ended = ['completed', 'abandoned'].includes(session.status);
  const stage = ended ? '결과' : session.status === 'paused' ? '일시 중단' : ['preparing', 'failed'].includes(session.status) ? '준비 중'
    : reading ? '먼저 읽기' : item?.phase.startsWith('check') ? '기초 확인' : item?.phase === 'recall_evaluating' ? '평가 중' : ['recall_feedback', 'repair'].includes(item?.phase || '') ? '피드백·보완' : '직접 설명';
  const materialUrl = courseName ? `/summary?${new URLSearchParams({ course: courseName, material: session.material_id, view: 'material' })}` : '';
  const advanceLabel = item?.phase === 'check_feedback' ? (item.position + 1 < session.concept_count ? '다음 개념 →' : '결과 보기 →') : '확인 문제 풀기 →';

  return <>
    <div className="learning-page-title"><p className="learning-eyebrow">학습 세션</p>
      <h1 ref={heading} tabIndex={-1}>{session.status === 'completed' ? '이번 학습에서 확인한 내용' : session.status === 'abandoned' ? '학습을 취소했어요' : session.status === 'paused' ? '잠시 쉬어가도 괜찮아요' : '하나씩 설명하고 확인해요'}</h1>
      <p className="learning-intro">{ended ? '개념별 결과를 살펴보고 다음 학습을 준비해보세요.' : '지금은 ' + stage + ' 단계예요. 내 속도에 맞춰 진행해보세요.'}</p>
    </div>
    <LearningProgress session={session} stage={stage} reading={reading} />
    {session.source_changed && <div className="learning-notice">원문이 변경됐어요. 이 세션은 시작할 때 저장한 원문을 기준으로 진행합니다.</div>}
    {draftError && <div className="learning-notice learning-error" role="alert">{draftError}</div>}
    {error && <div className="learning-notice learning-error" role="alert">{error}
      {pendingRetry && <p><button type="button" disabled={busy} onClick={() => { void retryPending().catch(() => undefined); }}>이전 요청 결과 다시 확인</button></p>}</div>}
    {session.status === 'paused' ? <Card className="learning-card learning-state"><span className="learning-state-symbol" aria-hidden="true">Ⅱ</span>
      <h2>학습을 잠시 멈췄어요</h2><p>저장된 답변과 단계부터 이어서 할 수 있어요.</p>
      <button type="button" className="resume" disabled={blocked} onClick={() => { void act('resume'); }}>이어서 학습 →</button></Card>
      : session.status === 'preparing' || session.status === 'failed' ? <Card className="learning-card learning-state" role="status">
        <span className={operation?.status === 'running' ? 'learning-loading-dot' : 'learning-state-symbol'} aria-hidden="true">{operation?.status === 'running' ? '' : '↻'}</span>
        <h2>{session.status === 'failed' || operation?.status === 'expired' ? '학습 준비를 마치지 못했어요' : '원문에서 질문과 확인 문제를 준비하고 있어요'}</h2>
        <p>선택한 범위에서 최대 {session.concept_count}개 개념을 준비해요.</p>
        {operation?.retryable && <button type="button" className="primary" disabled={blocked} onClick={() => { void command(`operations/${operation.id}/retry`).catch(() => undefined); }}>준비 다시 시도</button>}
        {operation?.status === 'running' && <p className="learning-caption">완료되면 자동으로 학습 화면이 열립니다.</p>}
      </Card> : !ended && item && <div className="learning-grid">
        <Card className="learning-card learning-activity" role="region" aria-labelledby="learning-concept-title">
          <p className="learning-eyebrow">개념 {item.position + 1} · {stage}</p><h2 id="learning-concept-title">{item.title}</h2>
          {reading ? <><Markdown text={item.introduction!} /><p className="learning-caption">읽었다면 설명을 덮고 기억나는 내용을 직접 설명해보세요.</p>
            <div className="learning-actions"><button type="button" className="primary" disabled={blocked} onClick={startRecall}>직접 설명하기 →</button></div></> : <>
            {item.phase === 'recall_answering' && <><Markdown text={item.question} />
              <RecallInput key={item.id} session={session} userId={userId} busy={busy} disabled={pendingRetry} flushRef={flushDraft}
                onSave={accept} onSubmit={text => command('answers', { item_id: item.id, kind: 'recall', answer: text })} /></>}
            {item.phase === 'recall_evaluating' && <div className="learning-notice" role="status">{item.evaluation_error ? '평가 작업이 중단됐어요. 다시 평가하거나 원문과 비교해 자기 점검할 수 있어요.' : '설명과 원문 근거를 비교하고 있어요…'}</div>}
            {item.phase !== 'recall_answering' && item.draft && !item.phase.startsWith('check') && <details className="learning-submitted"><summary>내가 제출한 설명</summary><Markdown text={item.draft} /></details>}
            {item.feedback && !item.phase.startsWith('check') && <LearningFeedback feedback={item.feedback} />}
            {item.evaluation_error && item.phase !== 'recall_evaluating' && <p role="status">AI 평가를 완료하지 못했어요. 답변은 저장됐으며 오답으로 처리하지 않았습니다.</p>}
            {item.self_check && <p className="learning-caption">자기 점검을 기록했어요. AI 평가와 구분해 결과에 표시합니다.</p>}
            {item.phase === 'repair' && <div className="learning-notice">도움 패널에서 필요한 설명을 확인한 뒤, 확인 문제로 이해한 내용을 점검해보세요.</div>}
            {operation?.retryable && operation.kind === 'evaluate' && <button type="button" disabled={blocked} onClick={() => { void command(`operations/${operation.id}/retry`).catch(() => undefined); }}>같은 답변 다시 평가</button>}
            {item.check && <fieldset className="learning-check" disabled={blocked || item.phase !== 'check_answering'}><legend>확인 문제</legend><Markdown text={item.check.question} />
              {item.check.options.map((option, index) => <label className="learning-option" key={index}>
                <input type="radio" name="check" value={index} checked={(item.check_result?.selected ?? selected) === index} onChange={() => setSelected(index)} />
                <span>{option}</span></label>)}
            </fieldset>}
            {item.phase === 'check_answering' && <div className="learning-actions"><button type="button" className="primary" disabled={blocked || selected === null}
              onClick={() => { void command('answers', { item_id: item.id, kind: 'check', answer: selected }).catch(() => undefined); }}>답안 제출</button></div>}
            {item.check_result && <div className={`learning-notice${item.check_result.correct ? ' learning-positive' : ''}`}><strong>{item.check_result.correct ? '이번 확인 문제를 맞혔어요' : '이 부분을 다시 확인해보세요'}</strong>
              <p>정답: {item.check!.options[item.check_result.answer_index]}</p><Markdown text={item.check_result.explanation} /></div>}
            {(permits('advance') || permits('unknown') || permits('skip')) && <div className="learning-actions learning-activity-actions">
              {permits('advance') && <button type="button" className="primary" disabled={blocked} onClick={() => { void act('advance'); }}>{advanceLabel}</button>}
              {permits('unknown') && <button type="button" disabled={blocked} onClick={() => { void act('unknown'); }}>모르겠어요 · 보완하기</button>}
              {permits('skip') && <button type="button" className="learning-text-button" disabled={blocked} onClick={() => { void act('skip'); }}>{item.phase === 'check_answering' ? '확인 문제 건너뛰기' : '이 개념 건너뛰기'}</button>}
            </div>}
          </>}
        </Card>
        <aside className="learning-aside" aria-label="학습 도움과 자료">
          <Card className="learning-card learning-context"><h2>이번 학습</h2><p>{session.material_name}</p>
            <dl className="learning-context-details"><div><dt>현재 개념</dt><dd>{item.position + 1} / {session.concept_count}</dd></div><div><dt>현재 단계</dt><dd>{stage}</dd></div></dl>
            {materialUrl && <LearningLink to={materialUrl} className="learning-context-link">선택한 자료 보기 ↗</LearningLink>}
            <p className="learning-caption">원문을 보며 답했다면 도움을 받은 상태에서의 학습으로 생각해주세요.</p>
          </Card>
          {!reading && permits('help') && <LearningHelp key={item.id} item={item} blocked={blocked} selfCheck={permits('self_check')}
            onHelp={type => { void command('help', { item_id: item.id, help_type: type }).catch(() => undefined); }} onSelfCheck={value => { void act('self_check', { self_check: value }); }} />}
        </aside>
      </div>}
    {ended && <LearningResults results={session.result} />}
    {!ended && <details className="learning-session-menu"><summary>학습 관리</summary><div className="learning-row">
      {permits('pause') && <button type="button" disabled={blocked} onClick={() => { void act('pause'); }}>저장하고 잠시 중단</button>}
      {permits('finish') && <button type="button" disabled={blocked} onClick={() => { void act('finish'); }}>여기까지 학습 마치기</button>}
      {item && <button type="button" disabled={blocked || session.status !== 'active' || item.reported} onClick={() => setReport(value => !value)}>{item.reported ? '확인 필요로 표시됨' : '문항·피드백 오류 알리기'}</button>}
      {permits('abandon') && <button type="button" disabled={blocked} onClick={() => { if (window.confirm('이번 학습을 취소할까요? 제출한 기록은 취소 상태로 보관합니다.')) void act('abandon'); }}>학습 취소</button>}
      <LearningLink to="/learn" className="learning-button">학습 설정으로</LearningLink>
    </div></details>}
    {report && item && !ended && <Card className="learning-card"><h2>어떤 부분을 확인해야 하나요?</h2>
      <label className="learning-field">오류 유형<select aria-label="오류 유형" value={reportReason} onChange={e => setReportReason(e.target.value)}>
        <option value="question">질문</option><option value="answer">정답</option><option value="feedback">피드백</option><option value="source">원문 근거</option></select></label>
      <p><textarea aria-label="오류 설명 (선택)" maxLength={1000} value={reportText} onChange={e => setReportText(e.target.value)} /></p>
      <button type="button" className="primary" disabled={blocked} onClick={() => { void command(`items/${item.id}/report`, { reason: reportReason, description: reportText }).then(() => setReport(false)).catch(() => undefined); }}>기록하기</button>
    </Card>}
  </>;
}
