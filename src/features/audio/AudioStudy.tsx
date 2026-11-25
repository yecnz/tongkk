import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { saveTranscriptMaterial } from '../../services/audio';
import LearningLayout from '../learningSession/LearningLayout';
import LearningLink from '../learningSession/LearningLink';
import { useLearningNavigation } from '../learningSession/navigation';
import AudioCapture from './AudioCapture';
import './AudioStudy.css';

export default function AudioStudy() {
  const { user } = useAuth();
  return <LearningLayout active="강의 녹음">{user ? <AudioWorkspace key={user.id} /> : <Card className="learning-card"><h1>강의 녹음</h1><p><LearningLink to="/auth">로그인</LearningLink> 후 녹음과 전사 기능을 이용해주세요.</p></Card>}</LearningLayout>;
}

function AudioWorkspace() {
  const [params] = useSearchParams();
  const { beforeLeaveRef } = useLearningNavigation();
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [course, setCourse] = useState(params.get('course') || '');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ course: string; id: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const materialId = useRef(crypto.randomUUID());
  const dirty = text.trim().length > 0 && !saved;
  const matches = search.trim() ? text.split(/\n+/).filter(line => line.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];

  useEffect(() => {
    let active = true;
    fetchCourses().then(values => {
      if (!active) return;
      setCourses(values); setCourse(current => values.some(value => value.name === current) ? current : values[0]?.name || '');
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '과목을 불러오지 못했어요.'); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);

  useEffect(() => {
    beforeLeaveRef.current = async () => {
      if (busy || saving) throw new Error('녹음·전사·저장을 마치거나 취소한 뒤 이동해주세요.');
      if (dirty && !window.confirm('아직 저장하지 않은 전사문이 있어요. 저장하지 않고 이동할까요?')) {
        throw new Error('전사문을 확인하고 자료로 저장해주세요.');
      }
    };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, busy, saving, dirty]);

  async function save() {
    if (saving || busy) return;
    setSaving(true); setError('');
    try {
      const material = await saveTranscriptMaterial(course, title, text, materialId.current);
      setSaved({ course, id: material.id });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '자료를 저장하지 못했어요. 전사문은 그대로 남아 있어요.'); }
    finally { setSaving(false); }
  }
  function changed() { setSaved(null); }
  return <>
    <div className="learning-page-title"><p className="learning-eyebrow">강의 녹음</p><h1>말한 내용을 학습 자료로</h1><p>녹음하거나 음성 파일을 올리고, 전사문을 확인해 과목에 저장하세요.</p></div>
    <div className="audio-study-grid">
      <Card className="learning-card"><h2>1. 음성 준비</h2>
        <AudioCapture disabled={saving} onBusyChange={setBusy} onTranscript={(result, name) => {
          setText(result.text); setTitle(name.replace(/\.[^.]+$/, '') + ' 전사'); setSaved(null); setSearch(''); materialId.current = crypto.randomUUID();
        }} />
        <p className="learning-caption">녹음할 권한이 있는 강의를 사용하세요. 긴 강의는 10분 이하로 나눠주세요.</p>
      </Card>
      <Card className="learning-card audio-transcript"><h2>2. 전사문 확인·저장</h2>
        <label className="learning-field">저장할 과목<select aria-label="저장할 과목" disabled={saving} value={course} onChange={event => { setCourse(event.target.value); changed(); }}>
          {!course && <option value="">과목 선택</option>}{courses.map(value => <option key={value.id} value={value.name}>{value.name}</option>)}
        </select></label>
        {loaded && !courses.length && <p>먼저 대시보드에서 과목을 추가해주세요. <LearningLink to="/">대시보드로</LearningLink></p>}
        <label className="learning-field">자료 이름<input aria-label="전사 자료 이름" maxLength={200} value={title} disabled={saving} onChange={event => { setTitle(event.target.value); changed(); }} /></label>
        <label className="learning-field">전사문 · 잘못 인식된 단어를 수정하세요<textarea aria-label="강의 전사문" maxLength={100000} rows={14} value={text} disabled={saving} onChange={event => { setText(event.target.value); changed(); }} placeholder="전사 결과가 여기에 표시돼요. 직접 텍스트를 붙여 넣어도 됩니다." /></label>
        <p className="learning-caption">{text.length.toLocaleString()} / 100,000자 · 원본 음성 없이 이 텍스트만 저장해요.</p>
        <button type="button" className="primary" disabled={saving || busy || !course || !title.trim() || !text.trim()} onClick={() => { void save(); }}>{saving ? '저장 중…' : '학습 자료로 저장'}</button>
        {error && <p role="alert" className="learning-notice learning-error">{error}</p>}
        {saved && <p role="status" className="learning-notice learning-positive">저장했어요. 요약·퀴즈·학습 세션에서 사용할 수 있어요. <LearningLink to={`/summary?${new URLSearchParams({ course: saved.course, material: saved.id, view: 'material' })}`}>저장한 자료 보기 →</LearningLink></p>}
      </Card>
    </div>
    {text && <Card className="learning-card"><h2>전사문 검색</h2><label className="learning-field">찾을 단어<input aria-label="전사문 검색" type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {search.trim() && <div aria-live="polite"><p>{matches.length}개 문단을 찾았어요.</p>{matches.slice(0, 20).map((line, index) => <p className="audio-search-result" key={index}>{line}</p>)}</div>}
    </Card>}
  </>;
}
