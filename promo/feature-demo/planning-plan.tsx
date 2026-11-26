/* eslint-disable @typescript-eslint/no-unused-vars -- The build inserts Dashboard.tsx JSX that consumes these bindings. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CYAN, Card, pageRoutes } from '../../src/common';
import { AddPlanModal } from '../../src/components/PlannerModals';
import { ddayTypeColors, createClientId, type Plan } from '../../src/services/studyPlanner';
import type { StudyPlanGoal, StudyPlanFamiliarity, StudyPlanMode } from '../../src/services/studyPlan';
import { demoDay, demoDdays, demoPlans, loadDashboardState, saveDashboardState } from './planning-dashboard';

// This function's return markup is inserted directly from Dashboard.tsx at build time.
// Only state and responses differ: all demo changes stay in memory and no AI is called.
export default function PlanningPlan() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>(demoPlans);
  const [loaded, setLoaded] = useState(false);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [studyPlanMessage, setStudyPlanMessage] = useState('예시 계획입니다. 목표와 시간을 골라 준비된 계획을 직접 적용해 보세요.');
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);
  const [studyPlanError, setStudyPlanError] = useState('');
  const [showStudyPlanOptions, setShowStudyPlanOptions] = useState(false);
  const [showPlanSourcePicker, setShowPlanSourcePicker] = useState(false);
  const [studyPlanGoal, setStudyPlanGoal] = useState<StudyPlanGoal>('exam');
  const [studyPlanFamiliarity, setStudyPlanFamiliarity] = useState<StudyPlanFamiliarity>('attended');
  const [studyPlanDailyMinutes, setStudyPlanDailyMinutes] = useState(60);
  const [includeCarryover, setIncludeCarryover] = useState(true);
  const [pendingStudyPlanMode, setPendingStudyPlanMode] = useState<StudyPlanMode>('balanced');
  const [selectedPlanSourceKeys, setSelectedPlanSourceKeys] = useState<string[]>(['exam-demo', 'review-demo']);
  const [planUndoSnapshot, setPlanUndoSnapshot] = useState<{ plans: Plan[]; message: string } | null>(null);
  const [editingPlanKey, setEditingPlanKey] = useState<string | null>(null);
  const [editingPlanText, setEditingPlanText] = useState('');
  useEffect(() => { let active = true; loadDashboardState('plans', demoPlans).then(value => { if (active) { setPlans(value); setLoaded(true); } }); return () => { active = false; }; }, []);
  useEffect(() => { if (loaded) void saveDashboardState('plans', plans); }, [loaded, plans]);
  const ddayPlanSources = demoDdays.map(d => ({ key: d.id!, kind: d.type!, label: d.subj, meta: d.date }));
  const reviewPlanSources = [{ key: 'review-demo', kind: 'review' as const, label: '알고리즘', meta: '퀵 정렬 복습' }];
  const incompletePlans = plans.filter(p => !p.done);
  const todayPlanEntries = plans.map((plan, index) => ({ plan, index })).filter(({ plan }) => !plan.date || plan.date === demoDay());
  const canGenerateStudyPlan = true;
  const canSubmitPlan = selectedPlanSourceKeys.length > 0 || (includeCarryover && incompletePlans.length > 0);
  const diagnosticCourse = '알고리즘';
  const planSourceMessage = '선택한 D-day와 복습 내용을 기준으로 예시 계획을 구성해요.';
  const requireAuth = () => true;
  const togglePlanSource = (key: string) => setSelectedPlanSourceKeys(previous => previous.includes(key) ? previous.filter(k => k !== key) : [...previous, key]);
  function openPlanSourcePicker(mode: StudyPlanMode) { setPendingStudyPlanMode(mode); setShowPlanSourcePicker(true); setStudyPlanError(''); }
  async function requestStudyPlan() {
    if (!canSubmitPlan) return;
    setStudyPlanLoading(true);
    setPlanUndoSnapshot({ plans, message: studyPlanMessage });
    const minutes = Math.round(studyPlanDailyMinutes * (pendingStudyPlanMode === 'lighter' ? .5 : pendingStudyPlanMode === 'harder' ? 1.5 : 1));
    const focus = studyPlanGoal === 'assignment' ? '정렬 알고리즘 비교 과제의 핵심 개념 정리' : studyPlanFamiliarity === 'new' ? '시간 복잡도의 뜻과 예시 읽기' : '정렬별 시간 복잡도와 안정성 연결하기';
    const budget = [Math.round(minutes / 3), Math.round(minutes / 3)];
    const items: Plan[] = [
      { text: `${focus} ${budget[0]}분`, action: 'review_summary', minutes: budget[0] },
      { text: `퀵 정렬 최악의 경우 확인 퀴즈 ${budget[1]}분`, action: 'retry_quiz', minutes: budget[1] },
      { text: `헷갈린 문제 복습 ${minutes - budget[0] - budget[1]}분`, action: 'review_wrong', minutes: minutes - budget[0] - budget[1] },
    ].map(item => ({ ...item, id: createClientId(), done: false, origin: 'ai', course: '알고리즘', date: demoDay() })) as Plan[];
    setPlans(previous => [...previous.filter(p => p.done || (!includeCarryover && p.origin !== 'ai')), ...items]);
    setStudyPlanMessage(`선택한 목표에 맞춰 하루 ${minutes}분 예시 계획을 적용했어요. 새 AI 답변은 생성하지 않습니다.`);
    setShowPlanSourcePicker(false); setStudyPlanLoading(false);
  }
  function undoStudyPlan() { if (planUndoSnapshot) { setPlans(planUndoSnapshot.plans); setStudyPlanMessage(planUndoSnapshot.message); setPlanUndoSnapshot(null); } }
  function startEditPlan(p: Plan, index: number) { setEditingPlanKey(p.id || `index-${index}`); setEditingPlanText(p.text); }
  function finishEditPlan(_p: Plan, index: number) { if (editingPlanText.trim()) setPlans(previous => previous.map((p, i) => i === index ? { ...p, text: editingPlanText.trim() } : p)); setEditingPlanKey(null); }
  function deletePlan(_p: Plan, index: number) { setPlans(previous => previous.filter((_, i) => i !== index)); }
  const planActionLabels = { retry_quiz: '퀴즈 다시 풀기', review_wrong: '오답 확인하기', review_summary: '요약 복습하기', read_material: '자료 보기', make_quiz: '퀴즈 만들기' };
  const resolvePlanCourse = (name?: string) => name === '알고리즘' ? name : undefined;
  const openPlanAction = (p: Plan) => navigate(p.action === 'review_wrong' ? '/review?tab=issues' : p.action?.includes('quiz') ? '/quiz' : '/summary');
  return <Card style={{ padding: 24 }} aria-label="오늘 할 일과 AI 학습 계획">
    <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>오늘 할 일</h2>
    {/* ACTUAL_DASHBOARD_PLAN_MARKUP */}
    {showAddPlan && <AddPlanModal onClose={() => setShowAddPlan(false)} onAdd={text => setPlans(previous => [...previous, { id: createClientId(), text, done: false, date: demoDay() }])} />}
  </Card>;
}
