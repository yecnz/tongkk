import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { loadCourseMaterialsFromServer, type CourseMaterial } from '../../services/materials';
import { deleteFlashcard, dueFlashcards, generateFlashcards, loadFlashcards, rateFlashcard, saveFlashcard, type Flashcard, type FlashcardRating } from '../../services/flashcards';
import LearningLayout from '../learningSession/LearningLayout';
import Markdown from '../learningSession/LearningMarkdown';
import { SourceLink } from '../sources/SourceLink';
import '../../styles/learning-workflow.css';
import './Flashcards.css';

const ratings: [FlashcardRating, string][] = [['again', '다시'], ['hard', '어려움'], ['good', '알겠음'], ['easy', '쉬움']];
type Draft = { key: string; front: string; back: string; source_page: number | null; saved: boolean };
function Workspace() {
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [courseId, setCourseId] = useState('');
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [materialId, setMaterialId] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<'review' | 'create' | 'library'>('review');
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const pending = useRef<{ card: Flashcard; rating: FlashcardRating; key: string } | null>(null);
  const [pendingRating, setPendingRating] = useState<FlashcardRating | null>(null);
  const course = courses.find(item => item.id === courseId);
  const queue = dueFlashcards(cards);
  const current = queue[0];
  const material = materials.find(item => item.id === materialId);
  const courseName = (id: string) => courses.find(item => item.id === id)?.name || '과목';

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([fetchCourses(), loadFlashcards()]).then(([available, saved]) => {
      if (!cancelled) { setCourses(available); setCards(saved); setCourseId(previous => previous || available[0]?.id || ''); }
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);
  useEffect(() => {
    let cancelled = false;
    setMaterials([]); setMaterialId(''); setDrafts([]);
    if (!course) return;
    setMaterialLoading(true);
    loadCourseMaterialsFromServer(course.name, { includeMarkdown: true }).then(rows => {
      if (!cancelled) setMaterials(rows);
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setMaterialLoading(false); });
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
    void action(async () => {
      const card = await saveFlashcard({ course_id: courseId, material_id: materialId || null, front: draft.front,
        back: draft.back, source_page: draft.source_page, origin_key: draft.key });
      setCards(previous => previous.some(item => item.id === card.id) ? previous : [...previous, card]);
      setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, saved: true } : item));
      setNotice('카드를 저장했어요. 오늘 복습에서 바로 시작하세요.');
    });
  }
  function source(card: Flashcard) {
    return card.material_id && card.source_page ? <SourceLink courseName={courseName(card.course_id)} materialId={card.material_id} page={card.source_page}>원문 p.{card.source_page} →</SourceLink> : null;
  }
  return <div className="workflow-surface workflow-stack flashcards-workspace">
    <div className="workflow-page-heading"><h1>암기 카드</h1><p className="workflow-muted">짧게 떠올리고, 기억한 정도에 맞춰 다시 만나세요.</p></div>
    <nav className="workflow-tabs" aria-label="암기 카드 보기">{([['review', `오늘 복습 ${queue.length}`], ['create', '카드 만들기'], ['library', `내 카드 ${cards.length}`]] as const).map(([value, label]) =>
      <button type="button" key={value} disabled={busy || !!pendingRating} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); setNotice(''); }}>{label}</button>)}</nav>
    {error && <div className="learning-notice learning-error" role="alert">{error} {!pendingRating && <button type="button" disabled={busy} onClick={() => setRetry(value => value + 1)}>다시 불러오기</button>}</div>}
    {notice && <p role="status" className="learning-notice">{notice}</p>}
    {loading ? <p role="status">카드를 불러오는 중…</p> : mode === 'review' ? <>
      {!current ? <div className="workflow-panel workflow-stack"><h2>{cards.length ? '지금 복습할 카드를 모두 확인했어요' : '첫 암기 카드를 만들어 보세요'}</h2><p>자료에서 카드를 만들거나 오답 문항에서 가져올 수 있어요.</p>
        <div className="flashcard-actions"><button type="button" className="workflow-primary" onClick={() => setMode('create')}>카드 만들기</button><Link to="/review?tab=wrong">오답에서 가져오기</Link></div></div>
        : <section className="workflow-panel workflow-stack" aria-label="복습 카드"><p className="workflow-meta">{courseName(current.course_id)} · 남은 카드 {queue.length}개</p>
          <div className="flashcard-face"><Markdown text={current.front} /></div>
          {!revealed ? <button type="button" className="workflow-primary" onClick={() => setRevealed(true)}>답 확인하기</button> : <>
            <div className="flashcard-answer"><Markdown text={current.back} />{source(current)}</div><p>답을 보기 전에 얼마나 떠올렸나요?</p>
            <div className="flashcard-ratings">{ratings.map(([value, label]) => <button type="button" key={value} disabled={busy || (!!pendingRating && pendingRating !== value)} onClick={() => rate(value)}>{pendingRating === value ? `${label} · 다시 저장` : label}</button>)}</div>
            {pendingRating && !busy && <button type="button" onClick={() => { pending.current = null; setPendingRating(null); setRevealed(false); setRetry(value => value + 1); }}>최신 복습 상태 확인</button>}
          </>}<p className="workflow-meta">자기평가에 따른 복습 일정입니다. 개념 이해도 평가와는 별도로 기록해요.</p></section>}
    </> : mode === 'create' ? <>
      {!courses.length ? <p><Link to="/">대시보드</Link>에서 과목을 먼저 추가해주세요.</p> : <>
        <div className="workflow-panel workflow-stack"><label className="workflow-field">과목<select value={courseId} disabled={busy} onChange={e => setCourseId(e.target.value)}>{courses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="workflow-field">학습자료<select value={materialId} disabled={busy || materialLoading} onChange={e => { setMaterialId(e.target.value); setDrafts([]); }}><option value="">직접 입력</option>{materials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {materialLoading && <p role="status">자료를 불러오는 중…</p>}
          {material && <><button type="button" className="workflow-primary" disabled={busy || material.markdown.trim().length < 20} onClick={() => { void action(async () => { const result = await generateFlashcards(material.markdown); setDrafts(result.cards.map(item => ({ ...item, key: crypto.randomUUID(), saved: false }))); }); }}>{busy ? '처리 중…' : '자료에서 카드 초안 만들기'}</button>
            {material.markdown.length > 60000 && <p className="workflow-muted">긴 자료는 앞부분 60,000자에서 카드를 만듭니다.</p>}</>}
          <button type="button" disabled={busy} onClick={() => setDrafts(previous => [...previous, { key: crypto.randomUUID(), front: '', back: '', source_page: null, saved: false }])}>직접 카드 추가</button></div>
        {drafts.length > 0 && <p>질문과 답을 확인하고 내 말로 수정한 뒤 저장하세요.</p>}
        {drafts.map((draft, index) => <section key={draft.key} className="workflow-panel workflow-stack" aria-label={`카드 초안 ${index + 1}`}>
          <label className="workflow-field">질문<textarea maxLength={2000} rows={3} value={draft.front} disabled={busy || draft.saved} onChange={e => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, front: e.target.value } : item))} /></label>
          <label className="workflow-field">답<textarea maxLength={8000} rows={4} value={draft.back} disabled={busy || draft.saved} onChange={e => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, back: e.target.value } : item))} /></label>
          <div className="flashcard-actions"><button type="button" className="workflow-primary" disabled={busy || draft.saved || !draft.front.trim() || !draft.back.trim()} onClick={() => save(draft)}>{draft.saved ? '저장됨' : '카드 저장'}</button>
            {!draft.saved && <button type="button" disabled={busy} onClick={() => setDrafts(previous => previous.filter(item => item.key !== draft.key))}>초안 제외</button>}</div></section>)}
      </>}
    </> : <>{!cards.length && <p>아직 저장한 카드가 없어요.</p>}
      {cards.map(card => <article key={card.id} className="workflow-panel workflow-stack"><p className="workflow-meta">{courseName(card.course_id)} · 다음 복습 {new Date(card.due_at).toLocaleDateString('ko-KR')} · {card.reviews}회 복습</p>
        <Markdown text={card.front} /><details><summary>답 보기</summary><Markdown text={card.back} />{source(card)}</details>
        {removeId === card.id ? <div className="flashcard-actions"><span>카드와 복습 기록을 삭제할까요?</span><button type="button" disabled={busy} onClick={() => { void action(async () => { await deleteFlashcard(card.id); setCards(previous => previous.filter(item => item.id !== card.id)); setRemoveId(null); }); }}>삭제 확인</button><button type="button" disabled={busy} onClick={() => setRemoveId(null)}>취소</button></div>
          : <button type="button" disabled={busy} className="flashcard-delete" onClick={() => setRemoveId(card.id)}>카드 삭제</button>}</article>)}
      {cards.length === 1000 && <p>복습이 빠른 순서로 최대 1,000개를 표시합니다.</p>}</>}
  </div>;
}
export default function Flashcards() {
  const { user } = useAuth();
  return <LearningLayout active="암기 카드">{user ? <Workspace key={user.id} /> : <p>암기 카드를 저장하고 복습하려면 <Link to="/auth">로그인</Link>해주세요.</p>}</LearningLayout>;
}
