import { Button, InlineAlert, PageHeading } from '../../components/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import CustomSelect from '../../components/CustomSelect';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { loadCourseMaterialsFromServer, type CourseMaterial } from '../../services/materials';
import { deleteFlashcard, dueFlashcards, generateFlashcards, loadFlashcards, rateFlashcard, saveFlashcard, type Flashcard, type FlashcardRating } from '../../services/flashcards';
import LearningLayout from '../learningSession/LearningLayout';
import LearningLink from '../learningSession/LearningLink';
import { useLearningNavigation } from '../learningSession/navigation';
import Markdown from '../learningSession/LearningMarkdown';
import { SourceLink } from '../sources/SourceLink';
import '../../styles/learning-workflow.css';
import './Flashcards.css';

const ratings: [FlashcardRating, string][] = [['again', '다시'], ['hard', '어려움'], ['good', '알겠음'], ['easy', '쉬움']];
type Draft = { key: string; front: string; back: string; source_page: number | null; saved: boolean; submitted?: boolean };
function Workspace() {
  const { beforeLeaveRef } = useLearningNavigation();
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [courseId, setCourseId] = useState('');
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [materialId, setMaterialId] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<'review' | 'create' | 'library'>('review');
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ card: Flashcard; rating: FlashcardRating; key: string } | null>(null);
  const [pendingRating, setPendingRating] = useState<FlashcardRating | null>(null);
  const course = courses.find(item => item.id === courseId);
  const queue = dueFlashcards(cards);
  const current = queue[0];
  const material = materials.find(item => item.id === materialId);
  const dirty = drafts.some(draft => !draft.saved && Boolean(draft.front.trim() || draft.back.trim()));
  const courseName = (id: string) => courses.find(item => item.id === id)?.name || '과목';
  const discardDrafts = () => !dirty || window.confirm('저장하지 않은 카드 초안이 있어요. 초안을 버리고 계속할까요?');

  useEffect(() => {
    if (revealed && mode === 'review') answerRef.current?.focus({ preventScroll: true });
  }, [revealed, mode, current?.id]);

  useEffect(() => {
    beforeLeaveRef.current = async () => {
      if (busy) throw new Error('카드 처리가 끝난 뒤 이동해주세요.');
      if (dirty && !window.confirm('저장하지 않은 카드 초안이 있어요. 저장하지 않고 이동할까요?')) throw new Error('카드 초안을 확인하고 저장해주세요.');
    };
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => { beforeLeaveRef.current = null; window.removeEventListener('beforeunload', prevent); };
  }, [beforeLeaveRef, busy, dirty]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setLoadError('');
    Promise.all([fetchCourses(), loadFlashcards()]).then(([available, saved]) => {
      if (!cancelled) { setCourses(available); setCards(saved); setCardsLoaded(true); setCourseId(previous => available.some(item => item.id === previous) ? previous : available[0]?.id || ''); }
    }).catch(e => { if (!cancelled) setLoadError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);
  useEffect(() => {
    let cancelled = false;
    setMaterials([]); setMaterialId(''); setDrafts([]);
    if (!course) { setMaterialLoading(false); return; }
    setMaterialLoading(true);
    loadCourseMaterialsFromServer(course.name, { includeMarkdown: true }).then(rows => {
      if (!cancelled) setMaterials(rows);
    }).catch(e => { if (!cancelled) setLoadError(e.message); }).finally(() => { if (!cancelled) setMaterialLoading(false); });
    return () => { cancelled = true; };
  }, [course]);

  async function action(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : '처리하지 못했어요. 다시 시도해주세요.'); }
    finally { setBusy(false); }
  }
  function rate(rating: FlashcardRating) {
    if (!current || busy) return;
    const request = pending.current || { card: current, rating, key: crypto.randomUUID() };
    pending.current = request; setPendingRating(request.rating);
    void action(async () => {
      const updated = await rateFlashcard(request.card, request.rating, request.key);
      setCards(previous => previous.map(item => item.id === updated.id ? updated : item));
      pending.current = null; setPendingRating(null); setRevealed(false);
      setNotice(`저장했어요. 다음 복습: ${new Date(updated.due_at).toLocaleString('ko-KR')}`);
    });
  }
  function save(draft: Draft) {
    setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, submitted: true } : item));
    void action(async () => {
      const card = await saveFlashcard({ course_id: courseId, material_id: materialId || null, front: draft.front,
        back: draft.back, source_page: draft.source_page, origin_key: draft.key });
      setCards(previous => previous.some(item => item.id === card.id) ? previous : [...previous, card]);
      setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, front: card.front, back: card.back, saved: true } : item));
      setNotice('카드를 저장했어요. 오늘 복습에서 바로 시작하세요.');
    });
  }
  function source(card: Flashcard) {
    return card.material_id && card.source_page ? <footer className="flashcard-source" aria-label="카드 출처"><span>출처</span><SourceLink courseName={courseName(card.course_id)} materialId={card.material_id} page={card.source_page}>원문 p.{card.source_page} →</SourceLink></footer> : null;
  }
  return <div className="workflow-surface workflow-stack flashcards-workspace">
    <PageHeading title="암기 카드" description="짧게 떠올리고, 기억한 정도에 맞춰 다시 만나세요." />
    <nav className="ui-tabs" aria-label="암기 카드 보기">{([['review', `오늘 복습 ${queue.length}`], ['create', '카드 만들기'], ['library', `내 카드 ${cards.length}`]] as const).map(([value, label]) =>
      <Button type="button" key={value} disabled={busy || !!pendingRating} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); setNotice(''); }}>{label}</Button>)}</nav>
    {loadError && <InlineAlert  tone="error">{loadError} <Button type="button" disabled={busy} onClick={() => { if (discardDrafts()) setRetry(value => value + 1); }}>다시 불러오기</Button></InlineAlert>}
    {error && <InlineAlert  tone="error">{error}</InlineAlert>}
    {notice && <p role="status" className="learning-notice">{notice}</p>}
    {loading ? <p role="status">카드를 불러오는 중…</p> : loadError && !cardsLoaded ? null : mode === 'review' ? <>
      {!current ? <Card className="workflow-panel workflow-stack"><h2>{cards.length ? '지금 복습할 카드를 모두 확인했어요' : '첫 암기 카드를 만들어 보세요'}</h2><p>자료에서 카드를 만들거나 오답 문항에서 가져올 수 있어요.</p>
        <div className="flashcard-actions"><Button type="button" variant="primary" onClick={() => setMode('create')}>카드 만들기</Button><LearningLink to="/review?tab=wrong">오답에서 가져오기</LearningLink></div></Card>
        : <section className="flashcard-review workflow-stack" aria-label="복습 카드">
          <header className="flashcard-review-meta"><span>{courseName(current.course_id)}</span><span>남은 카드 {queue.length}개</span></header>
          <article className="flashcard-study-card" data-side={revealed ? 'answer' : 'question'} aria-label={revealed ? '답 카드' : '질문 카드'}>
            <div className="flashcard-face"><p className="flashcard-label">질문</p><Markdown text={current.front} /></div>
            {revealed ? <div className="flashcard-answer" ref={answerRef} tabIndex={-1} role="region" aria-label="답"><p className="flashcard-label">답</p><Markdown text={current.back} /></div>
              : <div className="flashcard-reveal"><p className="workflow-muted">답을 먼저 떠올려 보세요.</p><Button type="button" variant="primary" onClick={() => setRevealed(true)}>답 확인하기</Button></div>}
          </article>
          <p className="flashcard-announcement" role="status">{revealed ? '답을 공개했어요.' : ''}</p>
          {revealed && <>
            <section className="flashcard-assessment" aria-labelledby="flashcard-rating-heading"><h2 id="flashcard-rating-heading">답을 보기 전에 얼마나 떠올렸나요?</h2>
              <div className="flashcard-ratings">{ratings.map(([value, label]) => <Button type="button" key={value} disabled={busy || (!!pendingRating && pendingRating !== value)} onClick={() => rate(value)}>{pendingRating === value ? `${label} · 다시 저장` : label}</Button>)}</div>
              {pendingRating && !busy && <Button type="button" onClick={() => { if (discardDrafts()) { pending.current = null; setPendingRating(null); setRevealed(false); setRetry(value => value + 1); } }}>최신 복습 상태 확인</Button>}
              <p className="workflow-meta">자기평가에 따라 다음 복습을 정해요. 개념 이해도 평가와는 별도로 기록합니다.</p>
            </section>
            {source(current)}
          </>}
        </section>}
    </> : mode === 'create' ? <>
      {!courses.length ? <p><Link to="/">대시보드</Link>에서 과목을 먼저 추가해주세요.</p> : <>
        <Card className="workflow-panel workflow-stack"><label className="workflow-field">과목<CustomSelect value={courseId} disabled={busy} onChange={value => { if (discardDrafts()) setCourseId(value); }} options={courses.map(item => ({ value: item.id, label: item.name }))} aria-label="과목" /></label>
          <label className="workflow-field">학습자료<CustomSelect value={materialId} disabled={busy || materialLoading} onChange={value => { if (discardDrafts()) { setMaterialId(value); setDrafts([]); } }} options={[{ value: '', label: '직접 입력' }, ...materials.map(item => ({ value: item.id, label: item.name }))]} aria-label="학습자료" /></label>
          {materialLoading && <p role="status">자료를 불러오는 중…</p>}
          {material && <><Button type="button" variant="primary" disabled={busy || material.markdown.trim().length < 20} onClick={() => { if (discardDrafts()) void action(async () => { const result = await generateFlashcards(material.markdown); setDrafts(result.cards.map(item => ({ ...item, key: crypto.randomUUID(), saved: false }))); }); }}>{busy ? '처리 중…' : '자료에서 카드 초안 만들기'}</Button>
            {material.markdown.length > 60000 && <p className="workflow-muted">긴 자료는 앞부분 60,000자에서 카드를 만듭니다.</p>}</>}
          <Button type="button" disabled={busy} onClick={() => setDrafts(previous => [...previous, { key: crypto.randomUUID(), front: '', back: '', source_page: null, saved: false }])}>직접 카드 추가</Button></Card>
        {drafts.length > 0 && <p>질문과 답을 확인하고 내 말로 수정한 뒤 저장하세요.</p>}
        {drafts.map((draft, index) => <Card role="region" key={draft.key} className="workflow-panel workflow-stack flashcard-draft" aria-label={`카드 초안 ${index + 1}`}>
          <header className="flashcard-draft-heading"><h2>카드 {index + 1}</h2><span className="workflow-meta">{draft.saved ? '저장됨' : '초안'}</span></header>
          <label className="workflow-field flashcard-draft-question"><span className="flashcard-label">질문</span><textarea className="ui-input" maxLength={2000} rows={3} value={draft.front} disabled={busy || draft.saved || draft.submitted} onChange={e => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, front: e.target.value } : item))} /></label>
          <label className="workflow-field flashcard-draft-answer"><span className="flashcard-label">답</span><textarea className="ui-input" maxLength={8000} rows={4} value={draft.back} disabled={busy || draft.saved || draft.submitted} onChange={e => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, back: e.target.value } : item))} /></label>
          {draft.submitted && !draft.saved && !busy && <p className="workflow-muted">저장 여부를 확인하지 못했어요. 같은 내용으로 다시 확인하면 중복 없이 저장 결과를 확인할 수 있어요.</p>}
          <div className="flashcard-actions"><Button type="button" variant="primary" disabled={busy || draft.saved || !draft.front.trim() || !draft.back.trim()} onClick={() => save(draft)}>{draft.saved ? '저장됨' : draft.submitted ? '저장 다시 확인' : '카드 저장'}</Button>
            {!draft.saved && <Button type="button" variant="ghost" disabled={busy} onClick={() => setDrafts(previous => previous.filter(item => item.key !== draft.key))}>초안 제외</Button>}</div></Card>)}
      </>}
    </> : <>{!cards.length && <p>아직 저장한 카드가 없어요.</p>}
      {cards.map(card => <Card role="article" key={card.id} className="workflow-panel workflow-stack flashcard-library-card"><p className="workflow-meta">{courseName(card.course_id)} · 다음 복습 {new Date(card.due_at).toLocaleDateString('ko-KR')} · {card.reviews}회 복습</p>
        <div className="flashcard-library-question"><p className="flashcard-label">질문</p><Markdown text={card.front} /></div>
        <div className="flashcard-library-answer"><p className="flashcard-label">답</p><Markdown text={card.back} /></div>
        {removeId === card.id ? <div className="flashcard-delete-confirm" role="group" aria-label="카드 삭제 확인"><p>카드와 복습 기록을 삭제할까요? 삭제한 기록은 복구할 수 없어요.</p><div className="flashcard-actions"><Button type="button" disabled={busy} onClick={() => setRemoveId(null)}>취소</Button><Button type="button" variant="danger" disabled={busy} onClick={() => { void action(async () => { await deleteFlashcard(card.id); setCards(previous => previous.filter(item => item.id !== card.id)); setRemoveId(null); }); }}>삭제 확인</Button></div></div>
          : <Button type="button" variant="ghost" size="sm" disabled={busy} className="flashcard-delete" onClick={() => setRemoveId(card.id)}>카드 삭제</Button>}{source(card)}</Card>)}
      {cards.length === 1000 && <p>복습이 빠른 순서로 최대 1,000개를 표시합니다.</p>}</>}
  </div>;
}
export default function Flashcards() {
  const { user } = useAuth();
  return <LearningLayout active="암기 카드">{user ? <Workspace key={user.id} /> : <p>암기 카드를 저장하고 복습하려면 <Link to="/auth">로그인</Link>해주세요.</p>}</LearningLayout>;
}
