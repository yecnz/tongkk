import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useToast } from '../../ToastContext';
import { Card } from '../../common';
import BrandLogo from '../../components/BrandLogo';
import ModalDialog from '../../components/ModalDialog';
import SelectField from '../../components/SelectField';
import {
  TEACHER_COURSES, calculateTeacherStats, createTeacherSampleMaterials,
  buildAssignmentDraft, buildCurriculumDraft,
  type TeacherMaterial, type TeacherAssignment, type CurriculumWeek, type TeacherStudent,
} from './teacherModel';
import { readTeacherFile, downloadTeacherText } from './teacherFiles';
import '../../pages/Dashboard.css';
import './Teachers.css';

const tabs = [
  { id: 'overview', label: '학습 대시보드' },
  { id: 'materials', label: '강의 자료' },
  { id: 'assignments', label: '과제 / 퀴즈' },
  { id: 'curriculum', label: '커리큘럼' },
] as const;
type Tab = typeof tabs[number]['id'];
type Workspace = { materials: TeacherMaterial[]; assignments: TeacherAssignment[]; curriculum: Record<string, CurriculumWeek[]> };
const percentage = (value: number, total: number) => total ? Math.round(value / total * 100) : 0;
const needsHelp = (student: TeacherStudent) => percentage(student.completed, student.total) < 50 || (student.quizTotal > 0 && percentage(student.quizCorrect, student.quizTotal) < 60);

function readWorkspace(key: string): Workspace {
  const initial = { materials: TEACHER_COURSES.flatMap(course => createTeacherSampleMaterials(course.id)), assignments: [], curriculum: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as Workspace | null;
    if (!saved || !Array.isArray(saved.materials) || !Array.isArray(saved.assignments) || !saved.curriculum || typeof saved.curriculum !== 'object') return initial;
    const validMaterials = saved.materials.every(item => item && typeof item.id === 'string' && typeof item.courseId === 'string' && typeof item.name === 'string' && typeof item.text === 'string');
    const validAssignments = saved.assignments.every(item => item && typeof item.id === 'string' && typeof item.courseId === 'string' && typeof item.title === 'string' && typeof item.content === 'string' && Array.isArray(item.sourceNames));
    const validWeeks = Object.values(saved.curriculum).every(weeks => Array.isArray(weeks) && weeks.every(week => week && typeof week.id === 'string' && typeof week.title === 'string' && typeof week.goal === 'string' && typeof week.activity === 'string' && typeof week.week === 'number'));
    return validMaterials && validAssignments && validWeeks ? saved : initial;
  } catch { return initial; }
}

function Progress({ value, label, pink = false }: { value: number; label: string; pink?: boolean }) {
  return <div className="teacher-progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${value}%`, background: pink ? 'var(--color-pink)' : 'var(--color-cyan)' }} />
  </div>;
}

export default function Teachers() {
  const { user, loading } = useAuth();
  if (loading) return <p className="teacher-loading" role="status">교수자 공간 불러오는 중…</p>;
  return <TeacherWorkspace key={user?.id || 'guest'} storageKey={`tongkk-teachers-v1:${user?.id || 'guest'}`} />;
}

function TeacherWorkspace({ storageKey }: { storageKey: string }) {
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const activeTab: Tab = tabs.find(tab => tab.id === params.get('tab'))?.id || 'overview';
  const course = TEACHER_COURSES.find(item => item.id === params.get('course')) || TEACHER_COURSES[0];
  const [workspace, setWorkspace] = useState(() => readWorkspace(storageKey));
  const workspaceRef = useRef(workspace);
  const materials = workspace.materials.filter(item => item.courseId === course.id);
  const assignments = workspace.assignments.filter(item => item.courseId === course.id);
  const curriculum = workspace.curriculum[course.id] || [];
  const stats = useMemo(() => calculateTeacherStats(course), [course]);
  const [studentFilter, setStudentFilter] = useState('all');
  const [student, setStudent] = useState<TeacherStudent | null>(null);
  const [materialPreview, setMaterialPreview] = useState<TeacherMaterial | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadBusy = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [kind, setKind] = useState<'quiz' | 'assignment'>('quiz');
  const [count, setCount] = useState('5');
  const [difficulty, setDifficulty] = useState('보통');
  const [focus, setFocus] = useState('');
  const [topic, setTopic] = useState(course.name);
  const [draft, setDraft] = useState<TeacherAssignment | null>(null);
  const [weeks, setWeeks] = useState('4');
  const [curriculumDraft, setCurriculumDraft] = useState<CurriculumWeek[] | null>(null);
  const [curriculumTopics, setCurriculumTopics] = useState(course.concepts.map(item => item.name).join('\n'));
  const [useMaterials, setUseMaterials] = useState(false);
  const selectedMaterials = materials.filter(item => selectedIds.includes(item.id));

  useEffect(() => {
    document.title = '교수자 공간 · Tongkk';
    return () => { document.title = 'Tongkk'; };
  }, []);

  useEffect(() => {
    setSelectedIds([]); setDraft(null); setCurriculumDraft(null); setFocus(''); setStudentFilter('all');
    setStudent(null); setMaterialPreview(null);
    setTopic(course.name); setCurriculumTopics(course.concepts.map(item => item.name).join('\n')); setUseMaterials(false);
  }, [course]);

  const navigateTab = (tab: Tab) => setParams({ course: course.id, tab });
  const changeCourse = (id: string) => {
    setParams({ course: id, tab: activeTab });
    setSelectedIds([]); setDraft(null); setCurriculumDraft(null); setFocus(''); setUploadError(''); setStudentFilter('all');
  };
  const commit = (next: Workspace) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { showToast('브라우저 저장 공간이 부족합니다. 자료를 줄인 뒤 다시 시도해 주세요.', 'error'); return false; }
    setWorkspace(next);
    workspaceRef.current = next;
    return true;
  };

  const upload = async (files: FileList | File[] | null) => {
    if (!files?.length || uploadBusy.current) return;
    uploadBusy.current = true; setUploading(true); setUploadError('');
    const added: TeacherMaterial[] = [];
    const errors: string[] = [];
    const selected = Array.from(files);
    if (selected.length > 10) errors.push('한 번에 10개까지 추가할 수 있습니다. 나머지 파일은 다시 선택해 주세요.');
    for (const file of selected.slice(0, 10)) {
      try {
        if (materials.some(item => item.name === file.name) || added.some(item => item.name === file.name)) throw new Error('같은 이름의 자료가 이미 있습니다.');
        const text = await readTeacherFile(file);
        added.push({ id: crypto.randomUUID(), courseId: course.id, name: file.name, text, addedAt: Date.now() });
      } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : '자료를 읽지 못했습니다.'}`); }
    }
    if (added.length && commit({ ...workspaceRef.current, materials: [...workspaceRef.current.materials, ...added] })) showToast(`자료 ${added.length}개 추가 완료`, 'success');
    setUploadError(errors.join('\n')); setUploading(false); uploadBusy.current = false;
    if (uploadInput.current) uploadInput.current.value = '';
  };

  const openGenerator = (concept = '') => {
    setSelectedIds(materials.map(item => item.id)); setFocus(concept); setKind('quiz'); setDraft(null); navigateTab('assignments');
  };
  const generate = () => {
    const subjects = [focus.trim(), topic.trim()].filter(Boolean).join('\n');
    const sources = [...(subjects ? [{ id: 'entered-topic', courseId: course.id, name: '직접 입력한 주제', text: subjects.split('\n').map(line => `# ${line}`).join('\n'), addedAt: 0 }] : []), ...selectedMaterials];
    const content = buildAssignmentDraft(sources, kind, Number(count), difficulty);
    if (!content) return;
    setDraft({ id: crypto.randomUUID(), courseId: course.id, title: `${course.name} ${kind === 'quiz' ? '확인 퀴즈' : '학습 과제'}`, kind, sourceNames: sources.map(item => item.name), content, createdAt: Date.now() });
  };
  const saveDraft = () => {
    if (!draft?.title.trim() || !draft.content.trim()) return;
    if (commit({ ...workspace, assignments: [draft, ...workspace.assignments.filter(item => item.id !== draft.id)] })) showToast('초안 저장 완료 · 이 브라우저', 'success');
  };
  const shownWeeks = curriculumDraft || curriculum;
  const updateWeek = (id: string, field: 'title' | 'goal' | 'activity', value: string) => setCurriculumDraft(shownWeeks.map(week => week.id === id ? { ...week, [field]: value } : week));

  return <div className="teacher-page">
    <header className="dashboard-header teacher-header">
      <Link to="/" className="brand-home tongkk-hover-fade" aria-label="Tongkk 학생용 홈"><BrandLogo /></Link>
      <span className="teacher-header-label">/ 교수자 공간</span>
      <Link to="/" className="workflow-button teacher-student-link">학생용으로 이동 ↗</Link>
    </header>
    <main className="teacher-shell workflow-surface">
      <div className="workflow-heading teacher-heading">
        <div><h1>교수자 공간</h1><p className="workflow-muted">학습 관리와 수업 준비</p></div>
        <span className="teacher-badge">교수자 미리보기</span>
      </div>
      <div className="teacher-course-bar">
        <SelectField label="강의 선택" value={course.id} options={TEACHER_COURSES.map(item => ({ value: item.id, label: item.name }))} onChange={changeCourse} disabled={uploading} layout="row" />
        <span className="workflow-muted">{course.description}</span>
      </div>
      <nav className="workflow-tabs" aria-label="교수자 메뉴">
        {tabs.map(tab => <button key={tab.id} type="button" aria-pressed={activeTab === tab.id} onClick={() => navigateTab(tab.id)}>{tab.label}{tab.id === 'materials' && <span className="teacher-count">{materials.length}</span>}</button>)}
      </nav>
      <p className="teacher-demo-note">예시 학생·통계 · 자료와 초안은 이 브라우저에만 저장</p>

      {activeTab === 'overview' && <div className="workflow-stack">
        <div className="teacher-metrics">
          {[
            { label: '수강 학생', value: `${stats.studentCount}명`, note: '현재 강의 기준', pink: false },
            { label: '전체 학습 진도', value: `${stats.averageProgress}%`, note: '전체 학습 항목 중 완료 비율', pink: false },
            { label: '퀴즈 정답률', value: `${stats.quizAccuracy}%`, note: '전체 응답 문항 기준', pink: false },
            { label: '학습 지원 필요', value: `${stats.studentsNeedingHelp}명`, note: '진도 50% 또는 정답률 60% 미만', pink: true },
          ].map(metric => <Card key={metric.label} className="teacher-metric"><span>{metric.label}<i style={{ background: metric.pink ? 'var(--color-pink)' : 'var(--color-cyan)' }} /></span><strong>{metric.value}</strong><small>{metric.note}</small></Card>)}
        </div>
        <div className="teacher-overview-grid">
          <Card className="workflow-panel">
            <div className="workflow-card-heading"><h2>학생별 학습 현황</h2><SelectField label="학생 보기" value={studentFilter} options={[{ value: 'all', label: '전체 학생' }, { value: 'help', label: '지원 필요 학생' }]} onChange={setStudentFilter} layout="row" /></div>
            <div className="teacher-table-wrap"><table className="teacher-table">
              <caption className="teacher-sr-only">{course.name} 학생별 학습 진도와 퀴즈 정답률 (예시)</caption>
              <thead><tr><th scope="col">학생</th><th scope="col">학습 진도</th><th scope="col">정답률</th><th scope="col">학습 상태</th></tr></thead>
              <tbody>{course.students.filter(item => studentFilter === 'all' || needsHelp(item)).map(item => <tr key={item.id}>
                <td><button type="button" className="teacher-name" onClick={() => setStudent(item)}>{item.name} <span aria-hidden="true">›</span></button></td>
                <td><div className="teacher-progress-label"><span>{percentage(item.completed, item.total)}%</span><small>{item.completed}/{item.total}</small></div><Progress value={percentage(item.completed, item.total)} label={`${item.name} 학습 진도`} /></td>
                <td>{item.quizTotal ? `${percentage(item.quizCorrect, item.quizTotal)}%` : '기록 없음'}</td>
                <td><span className={`teacher-badge ${needsHelp(item) ? 'teacher-badge--pink' : item.total > 0 && item.completed >= item.total ? 'teacher-badge--cyan' : ''}`}>{needsHelp(item) ? '지원 필요' : item.total > 0 && item.completed >= item.total ? '학습 완료' : '학습 중'}</span></td>
              </tr>)}</tbody>
            </table></div>
            <p className="workflow-meta">학생 이름 선택 시 상세 현황 확인</p>
          </Card>
          <Card className="workflow-panel workflow-stack">
            <div className="workflow-card-heading"><h2>개념별 오답 현황</h2><span className="workflow-meta">오답률 높은 순</span></div>
            {stats.concepts.map(concept => <div className="teacher-concept" key={concept.id}>
              <div className="teacher-concept-heading"><h3>{concept.name}</h3><span className="teacher-error-rate">오답률 <strong>{concept.incorrectRate}%</strong></span></div>
              <Progress value={concept.incorrectRate} label={`${concept.name} 오답률`} pink />
              <div className="teacher-concept-details"><span>응답 {concept.attempts}회 · 오답 {concept.incorrect}회 · 도움 요청 {concept.helpCount}회</span><button type="button" aria-label={`${concept.name} 보충 퀴즈 만들기`} onClick={() => openGenerator(concept.name)}>보충 퀴즈 만들기 <span aria-hidden="true">›</span></button></div>
            </div>)}
          </Card>
        </div>
      </div>}

      {activeTab === 'materials' && <div className="workflow-stack">
        <Card className="workflow-panel workflow-stack">
          <div><h2>강의 자료 업로드</h2><p className="workflow-muted">강의 자료 보관 및 내용 확인</p></div>
          <div className={`teacher-dropzone${dragging ? ' is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
            <strong>{uploading ? '자료 읽는 중…' : '파일을 끌어 놓거나 선택'}</strong>
            <span className="workflow-muted">PDF · TXT · Markdown / 파일당 15MB, 한 번에 10개</span>
            <button type="button" className="workflow-primary" disabled={uploading} onClick={() => uploadInput.current?.click()}>{uploading ? '자료 읽는 중…' : '자료 선택'}</button>
            <input ref={uploadInput} type="file" accept=".pdf,.txt,.md" multiple hidden onChange={event => void upload(event.target.files)} aria-label="강의 자료 파일" />
          </div>
          {uploadError && <p className="teacher-error" role="alert">{uploadError}</p>}
          {uploading && <p role="status" className="workflow-muted">처리 후 자료 목록에 추가</p>}
        </Card>
        <Card className="workflow-panel workflow-stack">
          <div className="workflow-card-heading"><h2>강의 자료 <span className="workflow-muted">{materials.length}개</span></h2></div>
          {!materials.length && <p className="teacher-empty">등록된 자료 없음</p>}
          {materials.map(material => <div className="teacher-material" key={material.id}>
            <span className="teacher-file-type" aria-hidden="true">{material.name.split('.').pop()?.toUpperCase() || 'TXT'}</span>
            <div className="teacher-material-info"><strong>{material.name}</strong><small className="workflow-meta">{material.text.length.toLocaleString()}자 · {material.name.startsWith('[예시]') ? '체험용 자료' : '내용 읽기 완료'}</small></div>
            <div className="workflow-actions"><button type="button" aria-label={`${material.name} 내용 보기`} onClick={() => setMaterialPreview(material)}>내용 보기</button><button type="button" disabled={uploading} aria-label={`${material.name} 삭제`} onClick={() => { if (commit({ ...workspace, materials: workspace.materials.filter(item => item.id !== material.id) })) setSelectedIds(ids => ids.filter(id => id !== material.id)); }}>삭제</button></div>
          </div>)}
        </Card>
      </div>}

      {activeTab === 'assignments' && <div className="teacher-editor-grid">
        <Card className="workflow-panel workflow-stack">
          <div><h2>과제 / 퀴즈 만들기</h2><p className="workflow-muted">주제와 문항 설정으로 초안 생성</p></div>
          <label className="workflow-field">다룰 주제<input value={topic} maxLength={300} onChange={event => setTopic(event.target.value)} placeholder="예: 스택과 큐의 차이" /></label>
          {materials.length > 0 && <fieldset className="teacher-sources"><legend>참고할 강의 자료 (선택)</legend>{materials.map(material => <label className="workflow-check" key={material.id}><input type="checkbox" checked={selectedIds.includes(material.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, material.id] : ids.filter(id => id !== material.id))} /><span>{material.name}</span></label>)}</fieldset>}
          <div className="workflow-form-grid">
            <SelectField label="유형" value={kind} options={[{ value: 'quiz', label: '개념 확인 퀴즈' }, { value: 'assignment', label: '서술형 과제' }]} onChange={value => setKind(value as 'quiz' | 'assignment')} />
            <SelectField label="문항 수" value={count} options={['3', '5', '10'].map(value => ({ value, label: `${value}문항` }))} onChange={setCount} />
            <SelectField label="난이도" value={difficulty} options={['쉬움', '보통', '어려움'].map(value => ({ value, label: value }))} onChange={setDifficulty} />
            <label className="workflow-field">집중할 개념 (선택)<input value={focus} onChange={event => setFocus(event.target.value)} placeholder="예: 시간 복잡도" maxLength={100} /></label>
          </div>
          <button type="button" className="workflow-primary" disabled={!selectedMaterials.length && !topic.trim() && !focus.trim()} onClick={generate}>초안 만들기</button>
          <p className="workflow-meta">체험용 템플릿 · 사용 전 문항과 정답 검토 필요</p>
        </Card>
        <Card className="workflow-panel workflow-stack">
          <h2>{draft ? '초안 검토' : '생성된 초안'}</h2>
          {draft ? <>
            <label className="workflow-field">제목<input value={draft.title} maxLength={150} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="workflow-field">문항과 안내<textarea className="teacher-draft" value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></label>
            <p className="workflow-meta">참고 자료: {draft.sourceNames.join(', ')}</p>
            <div className="workflow-actions"><button type="button" className="workflow-primary" disabled={!draft.title.trim() || !draft.content.trim()} onClick={saveDraft}>초안 저장</button><button type="button" disabled={!draft.content.trim()} onClick={() => downloadTeacherText(`${draft.title || '학습 초안'}.txt`, draft.content)}>내려받기</button></div>
          </> : <div className="teacher-empty"><p>주제와 문항 설정 후 초안 만들기</p></div>}
          {assignments.length > 0 && <div className="workflow-stack teacher-saved"><h3>저장한 초안</h3>{assignments.map(item => <div className="teacher-saved-row" key={item.id}><button type="button" className="teacher-text-action" onClick={() => setDraft(item)}>{item.title}</button><button type="button" aria-label={`${item.title} 초안 삭제`} onClick={() => { if (commit({ ...workspace, assignments: workspace.assignments.filter(saved => saved.id !== item.id) }) && draft?.id === item.id) setDraft(null); }}>삭제</button></div>)}</div>}
        </Card>
      </div>}

      {activeTab === 'curriculum' && <div className="workflow-stack">
        <Card className="workflow-panel workflow-stack">
          <div><h2>커리큘럼 구성</h2><p className="workflow-muted">주제·기간에 맞춘 주차별 학습 계획</p></div>
          <label className="workflow-field">다룰 주제 (한 줄에 하나씩)<textarea className="teacher-topic-input" value={curriculumTopics} maxLength={2000} onChange={event => setCurriculumTopics(event.target.value)} placeholder={'스택과 큐\n시간 복잡도\n재귀\n트리 순회'} /></label>
          {materials.length > 0 && <label className="workflow-check"><input type="checkbox" checked={useMaterials} onChange={event => setUseMaterials(event.target.checked)} />등록한 강의 자료 {materials.length}개도 참고하기</label>}
          <div className="teacher-curriculum-actions"><SelectField label="수업 기간" layout="row" value={weeks} options={['4', '8', '12', '16'].map(value => ({ value, label: `${value}주` }))} onChange={setWeeks} /><button type="button" className="workflow-primary" disabled={!curriculumTopics.trim() && !(useMaterials && materials.length)} onClick={() => {
            const sources = [...(curriculumTopics.trim() ? [{ id: 'curriculum-topics', courseId: course.id, name: '수업 주제', text: curriculumTopics.split('\n').map(line => line.trim()).filter(Boolean).map(line => `# ${line}`).join('\n'), addedAt: 0 }] : []), ...(useMaterials ? materials : [])];
            setCurriculumDraft(buildCurriculumDraft(sources, Number(weeks)));
          }}>커리큘럼 초안 만들기</button></div>
          {shownWeeks.length > 0 ? <>
            <div className="teacher-weeks">{shownWeeks.map(week => <div className="teacher-week" key={week.id}>
              <span className="teacher-week-number">{week.week}주차</span>
              <div className="workflow-stack"><label className="workflow-field">학습 주제<input aria-label={`${week.week}주차 학습 주제`} value={week.title} onChange={event => updateWeek(week.id, 'title', event.target.value)} /></label><div className="workflow-form-grid"><label className="workflow-field">학습 목표<input aria-label={`${week.week}주차 학습 목표`} value={week.goal} onChange={event => updateWeek(week.id, 'goal', event.target.value)} /></label><label className="workflow-field">학습 활동<input aria-label={`${week.week}주차 활동`} value={week.activity} onChange={event => updateWeek(week.id, 'activity', event.target.value)} /></label></div></div>
            </div>)}</div>
            <div className="workflow-actions"><button type="button" className="workflow-primary" disabled={!shownWeeks.every(week => week.title.trim() && week.goal.trim() && week.activity.trim())} onClick={() => { if (commit({ ...workspace, curriculum: { ...workspace.curriculum, [course.id]: shownWeeks } })) { setCurriculumDraft(null); showToast('커리큘럼 저장 완료 · 이 브라우저', 'success'); } }}>커리큘럼 저장</button><button type="button" onClick={() => downloadTeacherText(`${course.name} 커리큘럼.txt`, shownWeeks.map(week => `${week.week}주차 · ${week.title}\n목표: ${week.goal}\n활동: ${week.activity}`).join('\n\n'))}>내려받기</button>{curriculumDraft && <span className="workflow-meta">저장 전 초안</span>}</div>
          </> : <p className="teacher-empty">주제와 기간 입력 후 초안 만들기</p>}
        </Card>
      </div>}
      <footer className="teacher-footer">Tongkk · 교수자 공간</footer>
    </main>

    {student && <ModalDialog labelledBy="teacher-student-title" onClose={() => setStudent(null)} width={480}><div className="workflow-surface workflow-panel workflow-stack">
      <div className="workflow-card-heading"><h2 id="teacher-student-title">{student.name}님의 학습 현황</h2><button type="button" onClick={() => setStudent(null)}>닫기</button></div><span className="workflow-meta">예시 학생 · {course.name}</span>
      <div><div className="workflow-heading"><span>학습 진도</span><strong>{percentage(student.completed, student.total)}%</strong></div><Progress value={percentage(student.completed, student.total)} label="학습 진도" /></div>
      <p>퀴즈 {student.quizTotal}문항 중 {student.quizCorrect}문항 정답</p><h3>보충 학습 개념</h3><div className="workflow-actions">{student.weakConcepts.length ? student.weakConcepts.map(concept => <span className="teacher-badge teacher-badge--pink" key={concept}>{concept}</span>) : <span className="workflow-muted">해당 개념 없음</span>}</div>
      <button type="button" className="workflow-primary" onClick={() => { openGenerator(student.weakConcepts.join(', ')); setStudent(null); }}>보충 퀴즈 초안 만들기</button>
    </div></ModalDialog>}
    {materialPreview && <ModalDialog labelledBy="teacher-material-title" onClose={() => setMaterialPreview(null)} width={700}><div className="workflow-surface workflow-panel workflow-stack"><div className="workflow-card-heading"><h2 id="teacher-material-title">{materialPreview.name}</h2><button type="button" onClick={() => setMaterialPreview(null)}>닫기</button></div><pre className="teacher-material-preview">{materialPreview.text}</pre></div></ModalDialog>}
  </div>;
}
