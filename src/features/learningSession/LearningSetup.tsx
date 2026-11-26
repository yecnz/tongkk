import { Button, InlineAlert, PageHeading } from '../../components/ui';
import LearningHistory from './LearningHistory';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../../common';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { loadCourseMaterialsFromServer, type CourseMaterial } from '../../services/materials';
import { learningRequest, type LearningSession as Session, type Scopes } from '../../services/learningSessions';
import SelectField from '../../components/SelectField';
import LearningResume from './LearningResume';
import LearningLink from './LearningLink';
import { useLearningNavigation } from './navigation';

export default function LearningSetup() {
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
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [scopeLoading, setScopeLoading] = useState(false);
  const { beforeLeaveRef } = useLearningNavigation();
  const [error, setError] = useState('');
  const pending = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    let active = true;
    fetchCourses().then(rows => { if (active) setCourses(rows); })
      .catch(() => { if (active) setError('과목을 불러오지 못했어요. 잠시 후 다시 열어 주세요.'); })
      .finally(() => { if (active) setCoursesLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setMaterials([]);
    setScopes(null);
    if (!course) { setMaterialsLoading(false); return; }
    setMaterialsLoading(true);
    loadCourseMaterialsFromServer(course).then(rows => { if (active) setMaterials(rows); })
      .catch(() => { if (active) setError('자료를 불러오지 못했어요. 과목을 다시 선택해 주세요.'); })
      .finally(() => { if (active) setMaterialsLoading(false); });
    return () => { active = false; };
  }, [course]);
  const courseId = courses.find(c => c.name === course)?.id;
  useEffect(() => {
    setScopes(null);
    setSelected([]);
    if (!courseId || !material) { setScopeLoading(false); return; }
    const controller = new AbortController();
    setScopeLoading(true);
    setError('');
    learningRequest<Scopes>(`/scopes?${new URLSearchParams({ course_id: courseId, material_id: material })}`,
      'GET', undefined, controller.signal).then(value => {
      setScopes(value);
      if (value.total_chars <= value.max_chars) setSelected(value.units.map(u => u.id));
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '범위를 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setScopeLoading(false); });
    return () => controller.abort();
  }, [courseId, material]);

  const chars = scopes ? scopes.units.filter(u => selected.includes(u.id)).reduce((sum, u) => sum + u.chars, 0) + Math.max(0, selected.length - 1) * 2 : 0;
  const loading = coursesLoading || materialsLoading || scopeLoading;
  const settingsDisabled = busy || Boolean(pending.current);
  useEffect(() => {
    beforeLeaveRef.current = async () => {
      if (busy || pending.current) throw new Error('학습 시작 결과를 확인한 뒤 이동해 주세요.');
    };
    return () => { beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, busy]);
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
    <PageHeading title="학습 세션" description="자료를 고르고 학습을 시작해 주세요." actions={<LearningLink className="ui-button ui-button--secondary" to="/review?tab=today">복습 관리 →</LearningLink>} />
    <LearningResume variant="page" />
    <div className="learning-grid learning-setup" aria-label="학습 설정">
      <Card className="learning-card" role="region" aria-labelledby="learning-material-title">
        <div className="learning-section-heading"><div><h2 id="learning-material-title">학습 자료</h2>
          <p className="learning-caption">과목·자료와 범위를 선택해 주세요.</p></div><span className="learning-badge">자료 선택</span></div>
        <div className="learning-fields">
          <SelectField label="과목" value={course} placeholder="과목 선택" options={courses.map(c => ({ value: c.name, label: c.name }))}
            disabled={settingsDisabled || coursesLoading || !courses.length} onChange={value => { setCourse(value); setMaterial(''); setError(''); }} />
          <SelectField key={course} label="자료" value={material} placeholder="자료 선택" options={materials.map(m => ({ value: m.id, label: m.name }))}
            disabled={settingsDisabled || materialsLoading || !course || !materials.length} onChange={setMaterial} />
        </div>
        {loading && <p className="learning-caption" role="status">{coursesLoading ? '과목을 불러오는 중…' : materialsLoading ? '자료를 불러오는 중…' : '학습 범위를 불러오는 중…'}</p>}
        {!loading && !error && !courses.length && <div className="learning-empty"><strong>등록된 과목이 없습니다.</strong>
          <p>과목과 자료를 추가해 학습을 시작해 주세요.</p><LearningLink to="/" className="ui-button ui-button--secondary">과목 추가하러 가기 →</LearningLink></div>}
        {!loading && !error && course && !materials.length && <div className="learning-empty"><strong>등록된 자료가 없습니다.</strong>
          <p>자료를 올리고 학습 범위를 선택해 주세요.</p>
          <LearningLink to={`/summary?${new URLSearchParams({ course, view: 'upload' })}`} className="ui-button ui-button--secondary">자료 올리기 →</LearningLink></div>}
        {scopes && <>
          <div className="learning-scope-heading"><span>선택한 원문 {chars.toLocaleString()} / {scopes.max_chars.toLocaleString()}자</span>
            <Button type="button" variant="ghost" disabled={settingsDisabled} onClick={() => setSelected(selected.length === scopes.units.length ? [] : scopes.units.map(u => u.id))}>
              {selected.length === scopes.units.length ? '선택 해제' : '전체 선택'}</Button></div>
          <fieldset className="learning-scope" disabled={settingsDisabled}><legend>학습할 페이지 또는 원문 구간</legend>
            {scopes.units.map(unit => <label key={unit.id}><input type="checkbox" className="tongkk-checkbox" checked={selected.includes(unit.id)} onChange={e =>
              setSelected(previous => e.target.checked ? [...previous, unit.id] : previous.filter(id => id !== unit.id))} />
              <span>{unit.label}<small className="learning-muted">{unit.chars.toLocaleString()}자</small></span></label>)}
          </fieldset>
          {chars > scopes.max_chars && <InlineAlert  tone="error">한 번에 학습할 범위를 줄여 주세요.</InlineAlert>}
          {!selected.length && <p className="learning-caption">학습할 구간을 하나 이상 선택해 주세요.</p>}
        </>}
        {!scopes && !loading && courses.length > 0 && (!course || materials.length > 0) && <div className="learning-empty"><span className="learning-empty-symbol" aria-hidden="true">↗</span>
          <p>자료를 선택해 학습 범위를 확인해 주세요.</p></div>}
      </Card>
      <Card className="learning-card learning-settings" role="region" aria-labelledby="learning-settings-title">
        <h2 id="learning-settings-title">이번 학습 설정</h2>
        <fieldset className="learning-setting-group" disabled={settingsDisabled}>
          <legend>시작 방식</legend>
          <div className="learning-mode-options">
            {[{ value: 'attended', label: '수업 후 회상', description: '자료 없이 먼저 설명' },
              { value: 'new', label: '처음 배우기', description: '설명을 읽고 직접 설명' }].map(mode =>
              <label key={mode.value} className="learning-choice learning-mode-choice">
                <input type="radio" name="learning-mode" value={mode.value} aria-label={mode.label}
                  checked={familiarity === mode.value} onChange={() => setFamiliarity(mode.value)} />
                <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
              </label>)}
          </div>
        </fieldset>
        <fieldset className="learning-setting-group" disabled={settingsDisabled}>
          <legend>목표 시간</legend>
          <div className="learning-choice-options">{[10, 15, 20, 30].map(n => <label key={n} className="learning-choice">
            <input type="radio" name="learning-minutes" value={n} checked={minutes === n} onChange={() => setMinutes(n)} />{n}분</label>)}</div>
        </fieldset>
        <fieldset className="learning-setting-group" disabled={settingsDisabled}>
          <legend>개념 수</legend>
          <div className="learning-choice-options">{[1, 2, 3].map(n => <label key={n} className="learning-choice">
            <input type="radio" name="learning-count" value={n} checked={count === n} onChange={() => setCount(n)} />{n}개</label>)}</div>
        </fieldset>
        <details className="learning-note"><summary>학습 분량·시간 안내</summary>
          <p>학습 분량은 선택한 개념 수로 정합니다. 목표 시간이 지나도 학습을 계속할 수 있습니다.</p>
        </details>
        <div className="learning-flow" aria-label="학습 순서">{familiarity === 'new' ? '짧은 설명 → 직접 설명 → 보완 → 기초 확인' : '기억에서 설명 → 보완 → 기초 확인'}</div>
        <div className="learning-setup-summary"><span>{selected.length}개 구간 선택</span><strong>목표 {minutes}분 · 최대 {count}개 개념</strong></div>
        {error && <InlineAlert  tone="error">{error}</InlineAlert>}
        <Button type="button" variant="primary" className="learning-full-button" disabled={busy || loading || !scopes || !selected.length || chars > scopes.max_chars} onClick={() => { void start(); }}>
          {busy ? '학습을 여는 중…' : pending.current ? '이전 요청 결과 확인' : '학습 시작'}</Button>
      </Card>
    </div>
    <details className="learning-history-disclosure"><summary>완료한 학습 기록 보기</summary><LearningHistory /></details>
  </>;
}
