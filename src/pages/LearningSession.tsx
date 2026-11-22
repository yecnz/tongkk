import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useAuth } from '../AuthContext';
import { normalizeBoldSpacing, normalizeMathDelimiters } from '../common';
import { fetchCourses, type CourseRecord } from '../services/courses';
import { loadCourseMaterialsFromServer, type CourseMaterial } from '../services/materials';
import { learningRequest, removeLocalDraft, type LearningSession as Session, type Scopes } from '../services/learningSessions';
import { useLearningSession } from '../features/learningSession/useLearningSession';
import RecallInput from '../features/learningSession/RecallInput';
import LearningResume from '../features/learningSession/LearningResume';
import '../features/learningSession/LearningSession.css';

function Markdown({ text }: { text: string }) {
  return <div className="learning-help"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
    {normalizeBoldSpacing(normalizeMathDelimiters(text))}
  </ReactMarkdown></div>;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="learning-page"><header className="learning-header">
    <Link to="/" style={{ fontWeight: 800, color: 'var(--color-pink)', textDecoration: 'none', fontSize: 22 }}>Tongkk</Link>
    <span>학습 세션</span><Link to="/summary" style={{ marginLeft: 'auto', color: 'inherit' }}>자료 보기</Link>
  </header><main className="learning-main">{children}</main></div>;
}

function Start() {
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [course, setCourse] = useState(query.get('course') || '');
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [material, setMaterial] = useState(query.get('material') || '');
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [familiarity, setFamiliarity] = useState('attended');
  const [minutes, setMinutes] = useState(15);
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    let active = true;
    fetchCourses().then(rows => { if (active) setCourses(rows); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setMaterials([]);
    setScopes(null);
    if (!course) return;
    setLoading(true);
    loadCourseMaterialsFromServer(course).then(rows => { if (active) setMaterials(rows); })
      .catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [course]);
  const courseId = courses.find(c => c.name === course)?.id;
  useEffect(() => {
    setScopes(null);
    setSelected([]);
    if (!courseId || !material) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    learningRequest<Scopes>(`/scopes?${new URLSearchParams({ course_id: courseId, material_id: material })}`,
      'GET', undefined, controller.signal).then(value => {
      setScopes(value);
      if (value.total_chars <= value.max_chars) setSelected(value.units.map(u => u.id));
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '범위를 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [courseId, material]);

  const chars = scopes ? scopes.units.filter(u => selected.includes(u.id)).reduce((sum, u) => sum + u.chars, 0) + Math.max(0, selected.length - 1) * 2 : 0;
  async function start() {
    if (!courseId || !scopes) return;
    setBusy(true); setError('');
    const body = pending.current || {
      course_id: courseId, material_id: material, source_hash: scopes.source_hash,
      scope: selected.length === scopes.units.length ? { type: 'all' } : { type: 'units', unit_ids: selected }, familiarity, target_minutes: minutes,
      concept_count: count, idempotency_key: crypto.randomUUID(),
    };
    pending.current = body;
    try {
      const value = await learningRequest<Session>('', 'POST', body);
      pending.current = null;
      navigate(`/learn/${value.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '학습을 시작하지 못했습니다.');
      // A definite client rejection did not reserve work; inputs can be corrected.
      if (e && typeof e === 'object' && 'status' in e && Number(e.status) < 500) pending.current = null;
    } finally { setBusy(false); }
  }

  return <>
    <p className="learning-muted">약 15분 · 회상 → 보완 → 기초 확인</p>
    <h1>읽은 내용을 직접 설명해볼까요?</h1>
    <p>먼저 기억에서 꺼낸 뒤 원문·힌트로 보완해요. 처음 배우는 내용은 짧은 설명부터 시작합니다.</p>
    <section className="learning-card">
      <div className="learning-row">
        <label>과목 <select aria-label="과목" value={course} disabled={busy || Boolean(pending.current)} onChange={e => { setCourse(e.target.value); setMaterial(''); }}>
          <option value="">과목 선택</option>{courses.map(c => <option key={c.id}>{c.name}</option>)}
        </select></label>
        <label>자료 <select aria-label="자료" value={material} disabled={busy || !course || Boolean(pending.current)} onChange={e => setMaterial(e.target.value)}>
          <option value="">자료 선택</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>
      </div>
      {loading && <p role="status">학습 범위를 불러오는 중…</p>}
      {scopes && <>
        <h2 style={{ marginTop: 24 }}>학습할 범위</h2>
        <p className="learning-muted">선택한 원문 {chars.toLocaleString()} / {scopes.max_chars.toLocaleString()}자</p>
        <fieldset className="learning-scope" disabled={busy || Boolean(pending.current)}><legend>페이지 또는 원문 구간 선택</legend>
          {scopes.units.map(unit => <label key={unit.id}><input type="checkbox" checked={selected.includes(unit.id)} onChange={e =>
            setSelected(previous => e.target.checked ? [...previous, unit.id] : previous.filter(id => id !== unit.id))} />
            <span>{unit.label} <small className="learning-muted">· {unit.chars.toLocaleString()}자</small></span></label>)}
        </fieldset>
        {chars > scopes.max_chars && <p role="alert">한 번에 학습할 범위를 줄여주세요.</p>}
      </>}
      <div className="learning-row">
        <label>시작 방식 <select aria-label="시작 방식" value={familiarity} disabled={busy || Boolean(pending.current)} onChange={e => setFamiliarity(e.target.value)}>
          <option value="attended">수업 후 회상</option><option value="new">처음 배우기</option>
        </select></label>
        <label>목표 시간 <select aria-label="목표 시간" value={minutes} disabled={busy || Boolean(pending.current)} onChange={e => setMinutes(Number(e.target.value))}>
          {[10, 15, 20, 30].map(n => <option key={n} value={n}>{n}분</option>)}</select></label>
        <label>개념 수 <select aria-label="개념 수" value={count} disabled={busy || Boolean(pending.current)} onChange={e => setCount(Number(e.target.value))}>
          {[1, 2, 3].map(n => <option key={n} value={n}>{n}개</option>)}</select></label>
      </div>
      <p className="learning-muted">시간은 분량을 정하는 참고값이에요. 시간이 지나도 강제로 종료하지 않아요.</p>
      {error && <div className="learning-notice learning-error" role="alert">{error}</div>}
      <button type="button" className="primary" disabled={busy || loading || !scopes || !selected.length || chars > scopes.max_chars} onClick={() => { void start(); }}>
        {busy ? '학습을 여는 중…' : pending.current ? '같은 요청 다시 확인' : '학습 시작'}
      </button>
    </section><LearningResume />
  </>;
}

const criterionLabels = { met: '설명에서 확인됨', missing: '설명에 빠진 부분', contradicted: '다시 확인할 부분', uncertain: '판단 보류' };
const recallLabels = { sufficient: '핵심 설명 확인', needs_review: '보완 필요', uncertain: '추가 확인 필요', ungraded: '미평가', self_report: '자기 점검' };
const checkLabels = { correct: '맞힘', incorrect: '다시 확인 필요', ungraded: '미평가' };

function Runner({ id, userId }: { id: string; userId: string }) {
  const { session, error, busy, pendingRetry, command, retryPending, refresh, accept } = useLearningSession(id, userId);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState(false);
  const [reportReason, setReportReason] = useState('question');
  const [reportText, setReportText] = useState('');
  const flushDraft = useRef<(() => Promise<void>) | null>(null);
  const [draftError, setDraftError] = useState('');
  const item = session?.current;
  useEffect(() => { setSelected(null); setReport(false); }, [item?.id]);
  useEffect(() => {
    if (item && item.phase !== 'recall_answering') removeLocalDraft(userId, id, item.id);
  }, [item?.id, item?.phase, id, userId, item]);
  const act = (action: string, extra: Record<string, unknown> = {}) => {
    void (async () => {
      setDraftError('');
      try {
        if (['pause', 'finish', 'unknown', 'skip'].includes(action)) await flushDraft.current?.();
        await command('actions', { action, ...extra });
      } catch (e) { setDraftError(e instanceof Error ? e.message : '진행을 저장하지 못했습니다.'); }
    })();
  };
  const blocked = busy || pendingRetry;
  if (!session) return <><h1>학습 세션</h1><p role="status">{error || '저장된 학습을 불러오는 중…'}</p>
    {error && <button type="button" onClick={() => { void refresh(); }}>다시 불러오기</button>}<p><Link to="/learn">학습 목록으로</Link></p></>;
  const permits = (value: string) => session.allowed_actions.includes(value);
  const operation = session.operation;

  return <>
    <p className="learning-muted">{session.material_name} · 목표 {session.target_minutes}분</p>
    <h1>{session.status === 'completed' ? '이번 학습에서 확인한 내용' : session.status === 'abandoned' ? '학습을 취소했어요' : '기억하고, 설명하고, 확인하기'}</h1>
    <p>{session.completed_count} / {session.concept_count}개 개념 진행</p>
    <progress value={session.completed_count} max={session.concept_count} aria-label="개념 진행률" />
    {session.source_changed && <div className="learning-notice">원문이 변경됐어요. 이 세션은 시작할 때 저장한 원문을 기준으로 진행합니다.</div>}
    {draftError && <div className="learning-notice learning-error" role="alert">{draftError}</div>}
    {error && <div className="learning-notice learning-error" role="alert">{error}
      {pendingRetry && <p><button type="button" disabled={busy} onClick={() => { void retryPending().catch(() => undefined); }}>이전 요청 결과 다시 확인</button></p>}</div>}
    {session.status === 'paused' ? <section className="learning-card"><h2>학습을 잠시 멈췄어요</h2><p>저장된 답변과 단계부터 이어서 할 수 있어요.</p></section> :
      session.status === 'preparing' || session.status === 'failed' ? <section className="learning-card" role="status">
        <h2>{session.status === 'failed' || operation?.status === 'expired' ? '학습 준비를 마치지 못했어요' : '원문에서 질문과 확인 문제를 준비하고 있어요'}</h2>
        <p>준비 중에는 요약·모범답안을 먼저 보여주지 않아요.</p>
        {operation?.retryable && <button type="button" disabled={blocked} onClick={() => { void command(`operations/${operation.id}/retry`).catch(() => undefined); }}>준비 다시 시도</button>}
        {operation?.status === 'running' && <p>완료되면 자동으로 학습 화면이 열립니다.</p>}
      </section> : item && <>
        <section className="learning-card">
          <p className="learning-muted">개념 {item.position + 1} · {item.phase.startsWith('check') ? '기초 확인' : '자기 설명'}</p>
          <h2>{item.title}</h2>
          {item.introduction && <div className="learning-notice"><strong>먼저 살펴보기</strong><Markdown text={item.introduction} /></div>}
          {item.phase === 'recall_answering' && <>
            <Markdown text={item.question} />
            <RecallInput key={item.id} session={session} userId={userId} busy={busy} disabled={pendingRetry}
              flushRef={flushDraft} onSave={accept} onSubmit={text => command('answers', { item_id: item.id, kind: 'recall', answer: text })} />
          </>}
          {item.phase === 'recall_evaluating' && <p role="status">{item.evaluation_error ? '평가 작업이 중단됐어요. 다시 평가하거나 원문과 비교해 자기 점검할 수 있어요.' : '설명과 원문 근거를 비교하고 있어요…'}</p>}
          {item.phase !== 'recall_answering' && item.draft && !item.phase.startsWith('check') && <details><summary>내가 제출한 설명</summary><Markdown text={item.draft} /></details>}
          {item.feedback && !item.phase.startsWith('check') && <div>
            {item.feedback.criteria.map(criterion => <div className="learning-feedback" key={criterion.criterion_id}>
              <strong>{criterionLabels[criterion.status]}</strong><p>{criterion.reason}</p>
              {criterion.student_quote && <blockquote>내 설명: {criterion.student_quote}</blockquote>}
              {criterion.source_refs.map((ref, i) => <details key={i}><summary>판정 근거 · {ref.unit_id}</summary><blockquote>{ref.quote}</blockquote></details>)}
            </div>)}
          </div>}
          {item.evaluation_error && item.phase !== 'recall_evaluating' && <p role="status">AI 평가를 완료하지 못했어요. 답변은 저장됐으며 오답으로 처리하지 않았습니다.</p>}
          {item.self_check && <p>자기 점검을 기록했어요. AI 평가와 구분해 결과에 표시합니다.</p>}
          {item.phase === 'repair' && <p>원문·힌트를 확인한 뒤 다른 표현의 문제로 확인해보세요.</p>}
          {operation?.retryable && operation.kind === 'evaluate' && <button type="button" disabled={blocked} onClick={() => { void command(`operations/${operation.id}/retry`).catch(() => undefined); }}>같은 답변 다시 평가</button>}
          {item.check && <><Markdown text={item.check.question} />
            {item.check.options.map((option, index) => <label className="learning-option" key={index}>
              <input type="radio" name="check" value={index} checked={(item.check_result?.selected ?? selected) === index}
                disabled={blocked || item.phase !== 'check_answering'} onChange={() => setSelected(index)} />
              <span>{option}</span></label>)}
            {item.phase === 'check_answering' && <button type="button" className="primary" disabled={blocked || selected === null}
              onClick={() => { void command('answers', { item_id: item.id, kind: 'check', answer: selected }).catch(() => undefined); }}>선택 제출</button>}
          </>}
          {item.check_result && <div className="learning-notice"><strong>{item.check_result.correct ? '이번 확인 문제를 맞혔어요' : '이 부분을 다시 확인해보세요'}</strong>
            <p>정답: {item.check!.options[item.check_result.answer_index]}</p><Markdown text={item.check_result.explanation} /></div>}
        </section>
        {permits('help') && <section className="learning-card"><h2>필요할 때 도움 받기</h2>
          <div className="learning-row">{[['source', '관련 원문'], ['hint1', '첫 힌트'], ['hint2', '다음 힌트'], ['reference', '모범 설명']].map(([type, label]) =>
            <button type="button" key={type} disabled={blocked || Boolean(item.help[type])} onClick={() => { void command('help', { item_id: item.id, help_type: type }).catch(() => undefined); }}>{label}</button>)}</div>
          <p className="learning-muted">열어본 도움은 수행 결과에 함께 기록돼요.</p>
          {Object.entries(item.help).filter(([, text]) => text).map(([type, text]) => <div key={type}><Markdown text={text!} /></div>)}
          {permits('self_check') && item.help.reference && <div className="learning-row">{[['understood', '설명을 이해했어요'], ['needs_review', '추가 확인이 필요해요'], ['unknown', '아직 모르겠어요']].map(([value, label]) =>
            <button type="button" disabled={blocked} key={value} onClick={() => act('self_check', { self_check: value })}>{label}</button>)}</div>}
        </section>}
        <div className="learning-row">
          {permits('advance') && <button type="button" className="primary" disabled={blocked} onClick={() => act('advance')}>{item.phase === 'check_feedback' ? '다음 개념 / 마무리' : '확인 문제로'}</button>}
          {permits('unknown') && <button type="button" disabled={blocked} onClick={() => act('unknown')}>모르겠어요 · 보완하기</button>}
          {permits('skip') && <button type="button" disabled={blocked} onClick={() => act('skip')}>{item.phase === 'check_answering' ? '확인 문제 건너뛰기' : '이 개념은 나중에'}</button>}
          <button type="button" disabled={blocked || item.reported} onClick={() => setReport(value => !value)}>{item.reported ? '확인 필요로 표시됨' : '문항·피드백 오류 알리기'}</button>
        </div>
        {report && <section className="learning-card"><h2>어떤 부분을 확인해야 하나요?</h2>
          <select aria-label="오류 유형" value={reportReason} onChange={e => setReportReason(e.target.value)}>
            <option value="question">질문</option><option value="answer">정답</option><option value="feedback">피드백</option><option value="source">원문 근거</option>
          </select><p><textarea aria-label="오류 설명 (선택)" maxLength={1000} value={reportText} onChange={e => setReportText(e.target.value)} /></p>
          <button type="button" disabled={blocked} onClick={() => { void command(`items/${item.id}/report`, { reason: reportReason, description: reportText }).then(() => setReport(false)).catch(() => undefined); }}>기록하기</button>
        </section>}
      </>}
    {['completed', 'abandoned'].includes(session.status) && <>
      <p>이번 세션의 자기 설명과 보완 직후 기초 확인 결과예요. 장기 기억이나 새로운 상황의 응용 능력은 아직 평가하지 않았어요.</p>
      {session.result.map((result, index) => <section className="learning-card" key={index}><h2>{result.title}</h2>
        <p>자기 설명: {recallLabels[result.recall]} · 확인 문제: {checkLabels[result.check]}</p>
        <p className="learning-muted">{result.assisted ? '도움 사용 기록 있음' : '앱 내 도움 사용 기록 없음'}{result.prior_instruction ? ' · 설명·보완 후 수행' : ''}{result.repeated ? ' · 이전에 노출된 준비 묶음' : ''}{result.reported ? ' · 내용 확인 필요' : ''}</p>
      </section>)}
      <div className="learning-notice">다음에는 자료를 보지 않고 다시 설명해보세요. 확인이 남은 부분은 원문과 비교해보면 좋아요.</div>
      <Link to="/learn">다른 범위 학습하기 →</Link>
    </>}
    <div className="learning-row">
      {permits('pause') && <button type="button" disabled={blocked} onClick={() => act('pause')}>저장하고 잠시 중단</button>}
      {permits('resume') && <button type="button" className="primary" disabled={blocked} onClick={() => act('resume')}>이어서 학습</button>}
      {permits('finish') && <button type="button" disabled={blocked} onClick={() => act('finish')}>여기까지 학습 마치기</button>}
      {permits('abandon') && <button type="button" disabled={blocked} onClick={() => { if (window.confirm('이번 학습을 취소할까요? 제출한 기록은 취소 상태로 보관합니다.')) act('abandon'); }}>학습 취소</button>}
      <Link to="/learn">학습 목록</Link>
    </div>
  </>;
}

export default function LearningSession() {
  const { user } = useAuth();
  const { sessionId } = useParams();
  if (!user) return <Navigate to="/auth" replace />;
  return <Frame>{sessionId ? <Runner key={`${user.id}:${sessionId}`} id={sessionId} userId={user.id} /> : <Start key={user.id} />}</Frame>;
}
