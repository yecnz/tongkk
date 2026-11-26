const now = new Date().toISOString();
const concepts = [
  { id: 'complexity-demo', title: '시간 복잡도', state: 'recent_stable', evidence_count: 6, independent_questions: 3, assisted_count: 1, delayed_practice: 2 },
  { id: 'quick-demo', title: '퀵 정렬의 피벗과 최악의 경우', state: 'needs_review', evidence_count: 3, independent_questions: 1, assisted_count: 2, delayed_practice: 0 },
  { id: 'stable-demo', title: '병합 정렬과 안정성', state: 'needs_confirmation', evidence_count: 2, independent_questions: 1, assisted_count: 0, delayed_practice: 0 },
].map(concept => ({ ...concept, source_changed: false, course_id: 'course-demo', material_id: 'material-demo', last_evaluated_at: now, policy_version: 'demo' }));
const links = [{ id: 'link-demo', source_id: 'complexity-demo', target_id: 'quick-demo', relation: 'prerequisite' }];
function graph() {
  return {
    groups: concepts.map(c => ({ id: c.id, title: c.title, evidence_count: c.evidence_count, members: [{ id: c.id, title: c.title, course_name: '알고리즘', material_name: '알고리즘 3주차 강의자료.pdf', state: c.state, source_changed: false }] })),
    prerequisites: links.filter(l => l.relation === 'prerequisite').map(l => ({ source: l.source_id, target: l.target_id })),
    links: structuredClone(links), suggestions: [],
    recommendations: [{ concept_id: 'quick-demo', title: '퀵 정렬의 피벗과 최악의 경우', reason: '피벗이 한쪽으로 치우칠 때 비교 횟수가 늘어나는 이유를 다시 설명해 보세요.' }],
  };
}
export function handlePlanningRequest(path: string, method = 'GET', body?: Record<string, unknown>) {
  const url = new URL(path, 'https://demo.invalid');
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
