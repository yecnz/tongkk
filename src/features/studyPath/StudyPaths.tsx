import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { loadCourseMaterialsFromServer, type CourseMaterial } from '../../services/materials';
import { createStudyPath, listStudyPaths, moveChapter, pathProgress, readStudyPath, saveStudyPath,
  startStudyChapter, type StudyPath } from '../../services/studyPaths';
import LearningLayout from '../learningSession/LearningLayout';
import { useLearningNavigation } from '../learningSession/navigation';
import '../../styles/learning-workflow.css';

const message = (error: unknown) => error instanceof Error ? error.message : '처리하지 못했어요. 다시 시도해주세요.';

function PathEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const { beforeLeaveRef } = useLearningNavigation();
  const [path, setPath] = useState<StudyPath | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  const dirty = Boolean(path && JSON.stringify(path) !== saved);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    readStudyPath(id, controller.signal).then(value => {
      setPath(value); setSaved(JSON.stringify(value));
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [id, retry]);
  useEffect(() => {
    beforeLeaveRef.current = async () => {
      if (busy || dirty) throw new Error('편집한 코스를 저장하거나 되돌린 뒤 이동해주세요.');
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { beforeLeaveRef.current = null; window.removeEventListener('beforeunload', beforeUnload); };
  }, [beforeLeaveRef, busy, dirty]);
  async function save() {
    if (!path || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await saveStudyPath(path); setPath(value); setSaved(JSON.stringify(value)); setNotice('코스를 저장했어요.');
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function start(chapterId: string) {
    if (!path || busy || dirty) return;
    setBusy(true); setError('');
    try { const result = await startStudyChapter(path.id, chapterId); navigate(`/learn/${result.session_id}?studyPath=${path.id}`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const progress = path ? pathProgress(path) : null;
  return <div className="workflow-surface workflow-stack">
    <div className="workflow-actions"><button type="button" className="workflow-button" disabled={busy || dirty} onClick={() => navigate('/study-paths')}>← 코스 목록</button>
      <button type="button" className="workflow-button" disabled={busy || dirty} onClick={() => setRetry(n => n + 1)}>학습 진도 새로고침</button></div>
    {error && <p role="alert">{error} {!path && <button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button>}</p>}
    {!path ? !error && <p role="status">코스를 불러오는 중…</p> : <>
      <Card className="workflow-panel workflow-stack">
        <label className="workflow-field">코스 이름<input maxLength={100} value={path.title} disabled={busy} onChange={e => setPath({ ...path, title: e.target.value })} /></label>
        <p className="workflow-meta">활동 완료 {progress!.completed} / {progress!.total}챕터</p>
        <progress aria-label="학습 코스 진도" value={progress!.completed} max={Math.max(1, progress!.total)} />
        <p className="workflow-muted">각 챕터에서 핵심 개념 2개를 설명하고 확인 문제를 풉니다. 모든 확인 활동을 마친 세션만 진도에 반영하며, 장기 이해를 뜻하지는 않습니다.</p>
        <div className="workflow-actions"><button type="button" className="workflow-primary" disabled={busy || !dirty || !path.title.trim() || !path.chapters.some(c => c.included) || path.chapters.some(c => !c.title.trim())} onClick={() => { void save(); }}>{busy ? '처리 중…' : '변경 저장'}</button>
          <button type="button" className="workflow-button" disabled={busy || !dirty} onClick={() => { setPath(JSON.parse(saved)); setError(''); }}>편집 되돌리기</button>
          {progress!.next && <button type="button" className="workflow-primary" disabled={busy || dirty} onClick={() => { void start(progress!.next!.id); }}>다음 챕터 학습 →</button>}</div>
        {dirty && <p className="workflow-muted">저장하지 않은 변경이 있어요. 학습 전에 저장해주세요.</p>}
        {notice && <p role="status">{notice}</p>}
      </Card>
      <ol className="workflow-stack" aria-label="챕터 순서" style={{ paddingLeft: 24 }}>{path.chapters.map((chapter, index) => <li key={chapter.id}>
        <Card className="workflow-panel workflow-stack">
          <label className="workflow-field">챕터 {index + 1}<input maxLength={100} value={chapter.title} disabled={busy} onChange={e => setPath({ ...path, chapters: path.chapters.map(c => c.id === chapter.id ? { ...c, title: e.target.value } : c) })} /></label>
          <p>{chapter.objective}</p><p className="workflow-meta">{chapter.material_name} · {chapter.source_labels.join(', ')}</p>
          <label className="workflow-toggle"><span>코스에 포함</span><input type="checkbox" checked={chapter.included} disabled={busy} onChange={e => setPath({ ...path, chapters: path.chapters.map(c => c.id === chapter.id ? { ...c, included: e.target.checked } : c) })} /></label>
          <div className="workflow-actions">
            <button type="button" className="workflow-button" aria-label={`${chapter.title} 위로 이동`} disabled={busy || index === 0} onClick={() => setPath({ ...path, chapters: moveChapter(path.chapters, index, -1) })}>↑ 위로</button>
            <button type="button" className="workflow-button" aria-label={`${chapter.title} 아래로 이동`} disabled={busy || index === path.chapters.length - 1} onClick={() => setPath({ ...path, chapters: moveChapter(path.chapters, index, 1) })}>↓ 아래로</button>
            <button type="button" className="workflow-primary" disabled={busy || dirty || !chapter.included || chapter.source_changed} onClick={() => { void start(chapter.id); }}>
              {chapter.completed ? '완료한 학습 보기' : ['completed', 'abandoned'].includes(chapter.session_status ?? '') ? '부분 학습 다시 시작' : chapter.session_id ? '학습 이어가기' : '학습 시작'}</button>
          </div>
          {chapter.completed && <p className="workflow-meta">설명·확인 활동 완료</p>}
          {chapter.source_changed && <p role="status">원문이 변경되거나 삭제되어 새 코스가 필요해요. {chapter.session_id && <Link to={`/learn/${chapter.session_id}`}>이전 학습 기록 보기</Link>}</p>}
        </Card>
      </li>)}</ol>
    </>}
  </div>;
}

function PathList() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [courseId, setCourseId] = useState('');
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [paths, setPaths] = useState<StudyPath[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const pending = useRef<Parameters<typeof createStudyPath>[0] | null>(null);
  const { beforeLeaveRef } = useLearningNavigation();
  useEffect(() => {
    beforeLeaveRef.current = async () => { if (busy) throw new Error('코스 생성 결과를 확인한 뒤 이동해주세요.'); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (busy) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { beforeLeaveRef.current = null; window.removeEventListener('beforeunload', beforeUnload); };
  }, [beforeLeaveRef, busy]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([fetchCourses(), listStudyPaths()]).then(([list, result]) => {
      if (active) { setCourses(list); setPaths(result.paths); }
    }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  const courseName = courses.find(c => c.id === courseId)?.name;
  useEffect(() => {
    let active = true;
    setMaterials([]); setSelected([]);
    if (!courseName) { setMaterialLoading(false); return; }
    setMaterialLoading(true);
    loadCourseMaterialsFromServer(courseName, { includeMarkdown: true }).then(rows => { if (active) setMaterials(rows); })
      .catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setMaterialLoading(false); });
    return () => { active = false; };
  }, [courseName, retry]);
  async function create() {
    if (busy) return;
    setBusy(true); setError('');
    const next = { title: title.trim() || `${courseName} 학습 코스`, course_id: courseId, material_ids: selected };
    const previous = pending.current;
    const request = previous && JSON.stringify({ title: previous.title, course_id: previous.course_id, material_ids: previous.material_ids }) === JSON.stringify(next)
      ? previous : { id: crypto.randomUUID(), ...next };
    pending.current = request;
    try { const result = await createStudyPath(request); pending.current = null; navigate(`/study-paths?path=${result.id}`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const chars = materials.filter(m => selected.includes(m.id)).reduce((sum, m) => sum + m.markdown.length, 0);
  return <div className="workflow-surface workflow-stack">
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></p>}
    {loading ? <p role="status">코스를 불러오는 중…</p> : <>
      <Card className="workflow-panel workflow-stack"><h2>강의자료로 코스 만들기</h2>
        <p className="workflow-muted">최대 6개 자료를 챕터로 나눕니다. AI 초안을 만든 뒤 제목·순서·포함 여부를 편집할 수 있어요.</p>
        {!courses.length && <p>먼저 <Link to="/summary">과목과 강의자료를 추가</Link>해주세요.</p>}
        <label className="workflow-field">과목<select value={courseId} disabled={busy} onChange={e => setCourseId(e.target.value)}><option value="">과목 선택</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="workflow-field">코스 이름<input value={title} maxLength={100} placeholder={courseName ? `${courseName} 학습 코스` : '예: 중간고사 1~4주차'} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
        {materialLoading ? <p role="status">자료를 불러오는 중…</p> : courseId && !materials.length ? <p>이 과목에 자료가 없습니다. <Link to="/summary">자료 추가하기</Link></p> : <fieldset disabled={busy} className="workflow-stack"><legend>코스에 넣을 자료</legend>{materials.map(m => <label key={m.id} className="workflow-toggle"><span>{m.name}{!m.markdown.trim() && ' · 추출된 본문 없음'}</span><input type="checkbox" checked={selected.includes(m.id)} disabled={!m.markdown.trim() || (!selected.includes(m.id) && selected.length >= 6)} onChange={e => setSelected(e.target.checked ? [...selected, m.id] : selected.filter(id => id !== m.id))} /></label>)}</fieldset>}
        <p className="workflow-meta">선택 {selected.length}/6개 · 원문 {chars.toLocaleString()} / 60,000자</p>
        <button type="button" className="workflow-primary" disabled={busy || materialLoading || !selected.length || chars > 60000} onClick={() => { void create(); }}>{busy ? '원문으로 코스 구성 중…' : 'AI 코스 초안 만들기'}</button>
        {busy && <p role="status">자료를 읽고 챕터를 구성하고 있어요. 이 화면을 열어두세요.</p>}
      </Card>
      <h2>내 학습 코스</h2>{!paths.length && <p className="workflow-muted">아직 저장한 코스가 없습니다. 위에서 강의자료를 선택해 시작하세요.</p>}
      {paths.map(path => { const progress = pathProgress(path); return <Card key={path.id} className="workflow-panel workflow-stack"><h3>{path.title}</h3><p className="workflow-meta">{courses.find(c => c.id === path.course_id)?.name} · 활동 완료 {progress.completed}/{progress.total}챕터</p><Link to={`/study-paths?path=${path.id}`} className="workflow-button">코스 열기 →</Link></Card>; })}
    </>}
  </div>;
}

export default function StudyPaths() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const id = params.get('path');
  return <LearningLayout active="학습 코스"><div className="workflow-page-heading"><h1>학습 코스</h1><p className="workflow-muted">여러 강의자료를 순서대로 학습하고 이어가세요.</p></div>
    {!user ? <p><Link to="/auth">로그인</Link>하면 내 자료로 학습 코스를 만들 수 있어요.</p> : id ? <PathEditor key={`${user.id}:${id}`} id={id} /> : <PathList key={user.id} />}
  </LearningLayout>;
}
