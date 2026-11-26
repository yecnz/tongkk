import { createDemoConceptSession, learningRequest, type LearningSession } from './learning-sessions';
const now = new Date().toISOString();
const concepts = [
  { id: 'complexity-demo', title: '시간 복잡도', state: 'recent_stable', evidence_count: 6, independent_questions: 3, assisted_count: 1, delayed_practice: 2 },
  { id: 'quick-demo', title: '퀵 정렬의 피벗과 최악의 경우', state: 'needs_review', evidence_count: 3, independent_questions: 1, assisted_count: 2, delayed_practice: 0 },
  { id: 'stable-demo', title: '병합 정렬과 안정성', state: 'needs_confirmation', evidence_count: 2, independent_questions: 1, assisted_count: 0, delayed_practice: 0 },
].map(concept => ({ ...concept, source_changed: false, course_id: 'course-demo', material_id: 'material-demo', last_evaluated_at: now, policy_version: 'demo' }));
const links = [{ id: 'link-demo', source_id: 'complexity-demo', target_id: 'quick-demo', relation: 'prerequisite' }];
const studyPlan = [
  { concept_id: 'quick-demo', title: '퀵 정렬의 평균과 최악 시간 복잡도', course_name: '알고리즘', reason: '관련 개념을 설명하고 이해를 확인해요.' },
  { concept_id: 'stable-demo', title: '정렬의 안정성', course_name: '알고리즘', reason: '같은 자료에서 함께 다루는 개념을 이어서 배워요.' },
];
type DemoPath = { id: string; target_id: string; status: string; position: number;
  steps: (typeof studyPlan[number] & { position: number; session_id: string; session_status: string; session_complete: boolean; source_changed: boolean })[] };
let studyPath: DemoPath | null = null;
function graph() {
  return {
    groups: concepts.map(c => ({ id: c.id, title: c.title, evidence_count: c.evidence_count, members: [{ id: c.id, title: c.title, course_name: '알고리즘', material_name: '알고리즘 3주차 강의자료.pdf', state: c.state, source_changed: false }] })),
    prerequisites: links.filter(l => l.relation === 'prerequisite').map(l => ({ source: l.source_id, target: l.target_id })),
    links: structuredClone(links), suggestions: [],
    connections: [{ source: 'quick-demo', target: 'stable-demo' }], study_plan: studyPlan, study_target_id: 'quick-demo',
    recommendations: [{ concept_id: 'quick-demo', title: '퀵 정렬의 피벗과 최악의 경우', reason: '피벗이 한쪽으로 치우칠 때 비교 횟수가 늘어나는 이유를 다시 설명해 보세요.' }],
  };
}
export async function handlePlanningRequest(path: string, method = 'GET', body?: Record<string, unknown>) {
  const url = new URL(path, 'https://demo.invalid');
  if (url.pathname.startsWith('/learning-graph/paths')) {
    if (url.pathname === '/learning-graph/paths' && method === 'POST'
      && (!studyPath || studyPath.status !== 'active' && studyPath.id !== body?.idempotency_key)) {
      const id = String(body?.idempotency_key);
      studyPath = { id, target_id: 'quick-demo', status: 'active', position: 0,
        steps: studyPlan.map((step, position) => ({ ...step, position, session_id: `${id}-${position}`, session_status: 'active', session_complete: false, source_changed: false })) };
      studyPath.steps.forEach(step => createDemoConceptSession(step.session_id, step.position));
    }
    if (!studyPath) throw new Error('개념 지도에서 예시 학습을 시작해 주세요.');
    for (const step of studyPath.steps) {
      const session = await learningRequest<LearningSession>(`/${step.session_id}`);
      step.session_status = session.status;
      step.session_complete = session.status === 'completed' && session.completed_count === session.concept_count;
    }
    if (url.pathname.endsWith('/next')) {
      const position = Number(body?.position);
      if (!studyPath.steps[position]?.session_complete) throw new Error('현재 개념 학습을 마쳐 주세요.');
      studyPath.position = Math.max(studyPath.position, position + 1);
      if (studyPath.position === studyPath.steps.length) studyPath.status = 'completed';
    }
    return structuredClone(studyPath);
  }
  if (url.pathname === '/learning-concepts') return { concepts: structuredClone(concepts), total: concepts.length };
  if (url.pathname.startsWith('/learning-concepts/')) {
    const concept = concepts.find(c => c.id === url.pathname.split('/').pop()) ?? concepts[0];
    return { concept: structuredClone(concept), issue_id: concept.id === 'quick-demo' ? 'issue-demo-0' : null,
      evidence: [
        { id: 'evidence-1', source_kind: 'recall', outcome: concept.state === 'needs_review' ? 'not_met' : 'met', assisted: false, independent: true, session_id: 'demo-session-completed', created_at: now },
        { id: 'evidence-2', source_kind: 'check', outcome: 'met', assisted: true, independent: false, session_id: 'demo-session-completed', created_at: now },
      ], revisions: [] };
  }
  if (url.pathname === '/learning-graph') return graph();
  if (url.pathname === '/learning-graph/links' && method === 'POST' && body) {
    const source = String(body.source_id), target = String(body.target_id);
    if (source !== target && !links.some(l => l.source_id === source && l.target_id === target && l.relation === body.relation)) links.push({ id: String(body.id), source_id: source, target_id: target, relation: String(body.relation) });
    return graph();
  }
  if (url.pathname.startsWith('/learning-graph/links/') && method === 'DELETE') {
    const index = links.findIndex(l => l.id === url.pathname.split('/').pop()); if (index >= 0) links.splice(index, 1); return graph();
  }
  return undefined;
}
export async function loadDemoUsage() {
  return { groups: [
    { feature: 'summary', model: '예시 기록', calls: 4, failures: 0, average_ms: 2400, input_tokens: 6400, output_tokens: 1800, estimated_usd: null, priced_calls: 0, token_known_calls: 4 },
    { feature: 'quiz', model: '예시 기록', calls: 6, failures: 0, average_ms: 3100, input_tokens: 8400, output_tokens: 3600, estimated_usd: null, priced_calls: 0, token_known_calls: 6 },
    { feature: 'tutor', model: '예시 기록', calls: 3, failures: 0, average_ms: 1800, input_tokens: 2400, output_tokens: 1200, estimated_usd: null, priced_calls: 0, token_known_calls: 3 },
  ] };
}
