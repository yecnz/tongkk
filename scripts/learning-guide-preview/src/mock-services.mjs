// Documentation-only transport. No fetch, SDK, OAuth, or model calls are made.
const user = { id: 'guide-user', email: 'guide@example.invalid' };
export const useAuth = () => ({ user, loading: false });
export class WorkflowError extends Error { status = 400; }
export class ReviewError extends Error { status = 400; }
export class AgentThreadExpiredError extends Error {}
export const issueLabels = { needs_confirmation: '확인 필요', in_progress: '보완 중', awaiting_reassessment: '재평가 대기', resolved: '해결', closed: '수동 종료' };
const copy = value => structuredClone(value);
const at = '2026-11-23T00:00:00Z';
const courses = [{ id: 'course-os', name: '운영체제' }, { id: 'course-system', name: '시스템 프로그래밍' }];
export const fetchCourses = async () => copy(courses);
export const listLearningSessions = async () => ({ sessions: [{ id: 'session-process', material_name: '프로세스와 스레드', status: 'in_progress' }] });
export const invalidateSummariesCache = () => {};
export const invalidateQuizSetsCache = () => {};
export const invalidateMaterialsCache = () => {};
const feedback = { criteria: [{ criterion_id: '스레드의 공유 자원과 독립 실행 정보', status: 'met', student_quote: '주소 공간은 공유하지만 스택과 레지스터는 별도로 유지합니다.', reason: '공유하는 자원과 스레드별 실행 정보를 구분했어요.', source_refs: [{ unit_id: 'p5', quote: '스레드는 코드·데이터를 공유하고 스택·레지스터를 각각 가진다.' }] }] };
const concept = (id, title, state = 'needs_review') => ({ id, title, state, source_changed: false, course_id: 'course-os', material_id: 'material-process', evidence_count: 4, independent_questions: 2, assisted_count: 1, delayed_practice: 1, last_evaluated_at: at, policy_version: 'v1' });
const concepts = [concept('concept-process', '프로세스와 스레드'), concept('concept-resource', '자원 할당', 'needs_confirmation'), concept('concept-deadlock', '교착 상태', 'recent_stable')];
const evidence = [{ id: 'ev-1', source_kind: 'review', outcome: 'met', assisted: false, independent: true, answer: '같은 프로세스의 스레드는 주소 공간을 공유하지만 스택은 각각 가집니다.', session_id: 'session-process', created_at: at }, { id: 'ev-2', source_kind: 'revision', outcome: 'met', assisted: true, independent: false, answer: '스레드의 스택과 프로그램 카운터는 별도입니다.', session_id: 'session-process', created_at: '2026-11-22T05:30:00Z' }];
const issues = [{ id: 'issue-process', title: '프로세스와 스레드', status: 'in_progress', revision: 1, concept_id: 'concept-process', course_id: 'course-os', material_id: 'material-process', updated_at: at }, { id: 'issue-resource', title: '자원 할당', status: 'needs_confirmation', revision: 1, concept_id: 'concept-resource', course_id: 'course-os', material_id: 'material-process', updated_at: at }];
const issueView = id => ({ issue: issues.find(i => i.id === id) || issues[0], concept: { ...concepts[0], source_refs: [{ unit_id: 'p5', quote: '스레드는 코드와 데이터를 공유하지만 스택과 레지스터는 독립적으로 유지한다.' }] }, evidence: evidence.slice(0, 1), events: [{ id: 'event-1', action: 'start', created_at: at }], review_card_id: 'review-process', source_changed: false });
const cards = [{ id: 'review-process', concept_id: 'concept-process', title: '프로세스와 스레드', due_at: at, paused: false, revision: 1, source_changed: false, interval_days: 1, successful_reviews: 1 }, { id: 'review-deadlock', concept_id: 'concept-deadlock', title: '교착 상태의 발생 조건', due_at: at, paused: false, revision: 1, source_changed: false, interval_days: 3, successful_reviews: 2 }];
let review = { id: 'review-process', title: '프로세스와 스레드', question: '웹 서버의 두 스레드가 같은 연결 목록을 읽고 서로 다른 요청을 처리합니다. 두 스레드가 공유하는 정보와 각각 유지해야 하는 정보를 설명해주세요.', next_question: null, question_id: 'question-webserver', question_status: 'ready', auto_questions: false, due_at: at, source_changed: false, paused: false, latest: null, check: null, baseline: { answer: '스레드는 하나의 프로세스 안에서 실행됩니다.', feedback: null }, previous: null };
export async function reviewRequest(path = '', method = 'GET', body = {}) {
  if (!path || path.startsWith('?')) return copy({ cards });
  if (method === 'POST' && path.endsWith('/answers')) {
    review = { ...review, latest: { id: 'attempt-guide', answer: body.answer, question: review.question, question_id: review.question_id, assisted: body.assisted, status: 'graded', feedback, check_result: null, eligible_for_schedule: true }, check: { question: '같은 프로세스의 두 스레드가 각각 독립적으로 유지하는 것은 무엇인가요?', options: ['코드 영역', '열린 파일 목록', '스택과 레지스터'] } };
  } else if (method === 'POST' && path.endsWith('/check')) {
    review.latest.check_result = { selected: body.selected, answer_index: 2, correct: body.selected === 2, explanation: '스택과 레지스터는 스레드별로 유지합니다. 공유 데이터에 접근할 때는 동기화가 필요해요.' };
    review.due_at = '2026-11-26T00:00:00Z';
  }
  return copy(review);
}
let preferences = { auto_review: true, timezone: 'Asia/Seoul' };
let revision = { title: '프로세스와 스레드', question: '프로세스와 스레드의 자원 공유 방식과 실행 정보의 차이를 설명해주세요.', baseline: '스레드는 프로세스 안에서 실행되며 모든 정보를 공유합니다.', baseline_feedback: null, source_changed: false, revision: { id: 'revision-process', session_id: 'session-process', item_id: 'item-process', answer: '스레드는 프로세스 안에서 코드와 데이터를 공유합니다. 다만 스택과 레지스터, 프로그램 카운터는 스레드마다 독립적으로 유지합니다.', revision: 1, status: 'draft' }, evaluation: null };
const graph = { groups: [{ id: 'group-process', title: '프로세스와 스레드', evidence_count: 7, members: [{ ...concepts[0], course_name: '운영체제', material_name: '프로세스와 스레드' }, { ...concept('concept-thread-system', '스레드', 'recent_stable'), course_name: '시스템 프로그래밍', material_name: 'POSIX 스레드' }] }, { id: 'group-resource', title: '자원 할당', evidence_count: 2, members: [{ ...concepts[1], course_name: '운영체제', material_name: '자원과 동기화' }] }, { id: 'group-deadlock', title: '교착 상태', evidence_count: 5, members: [{ ...concepts[2], course_name: '운영체제', material_name: '교착 상태' }] }], prerequisites: [{ source: 'group-resource', target: 'group-deadlock' }], links: [{ id: 'link-equivalent', source_id: 'concept-process', target_id: 'concept-thread-system', relation: 'equivalent' }, { id: 'link-prerequisite', source_id: 'concept-resource', target_id: 'concept-deadlock', relation: 'prerequisite' }], suggestions: [], recommendations: [{ concept_id: 'concept-resource', title: '자원 할당', reason: '교착 상태를 이해하기 전에 자원 보유와 대기 관계를 먼저 확인해주세요.' }] };
const preparations = [{ id: 'prep-process', pages: '4-7', source_changed: false, artifacts: [{ id: 'artifact-summary', kind: 'summary', status: 'ready', generation: 1, applied_id: null, preview: { content: '프로세스는 독립된 주소 공간을 가지는 실행 단위입니다.\n같은 프로세스의 스레드는 코드와 데이터를 공유하며, 스택과 레지스터는 각각 유지합니다.' } }, { id: 'artifact-pack', kind: 'pack', status: 'applied', generation: 1, applied_id: 'pack-process', preview: {} }] }];
export async function queuePreparation() { return copy(preparations[0]); }
let connection = { id: 'calendar-guide', status: 'connected', revision: 1, last_synced_at: at, last_error: null, sync_enabled: true, sync_interval_minutes: 30, next_sync_at: '2026-11-23T00:30:00Z', consecutive_failures: 0 };
const events = [{ id: 'event-os-class', title: '운영체제 중간 점검', all_day: false, start_at: '2026-11-23T05:00:00Z', start_value: '2026-11-23T14:00:00+09:00', end_value: '2026-11-23T15:00:00+09:00', course_id: 'course-os' }];
const drafts = provider => [{ id: `draft-${provider}`, course_id: 'course-os', external_id: `doc-${provider}`, title: provider === 'notion' ? '스레드 실습 정리' : '운영체제 3장 프로세스와 스레드', markdown: provider === 'notion' ? '# 스레드 실습 정리\n\n각 스레드는 독립된 스택을 사용합니다.\n공유 카운터를 변경할 때는 뮤텍스로 임계 구역을 보호합니다.' : '# 프로세스와 스레드\n\n프로세스는 독립된 주소 공간을 가집니다.\n스레드는 코드와 데이터를 공유하지만 스택과 레지스터는 별도로 유지합니다.', status: 'ready', material_id: null, source_modified: '2026-11-22T08:00:00Z', notices: provider === 'notion' ? ['하위 페이지는 별도로 선택해야 합니다.'] : [] }];
const sourceState = Object.fromEntries(['google-drive', 'notion'].map(p => [p, { configured: true, connection: { status: 'connected', revision: 1 }, drafts: drafts(p) }]));

export async function workflowRequest(path, method = 'GET', body = {}) {
  const url = new URL(path, 'http://local.invalid');
  const p = url.pathname;
  if (p.endsWith('/connect')) throw new Error('화면 안내용 미리보기에서는 외부 계정을 연결하지 않습니다.');
  if (p === '/learning-workflow/preferences') { if (method === 'PUT') preferences = body; return copy(preferences); }
  if (p === '/learning-concepts/recommendations') return copy({ issues: [issues[1]], prerequisites: graph.recommendations });
  if (p === '/learning-concepts') return copy({ concepts, total: concepts.length });
  if (p.startsWith('/learning-concepts/')) return copy({ concept: concepts.find(c => c.id === p.split('/')[2]) || concepts[0], evidence, revisions: [{ id: 'revision-process', session_id: 'session-process', status: 'graded', created_at: '2026-11-22T05:30:00Z' }], issue_id: 'issue-process' });
  if (p === '/learning-issues') return copy({ issues, total: issues.length });
  if (p.startsWith('/learning-issues/')) { const id = p.split('/')[2]; if (p.endsWith('/actions')) { const item = issues.find(i => i.id === id); item.status = { start: 'in_progress', reassess: 'awaiting_reassessment', close: 'closed', reopen: 'needs_confirmation' }[body.action]; item.revision++; } return copy(issueView(id)); }
  if (p.startsWith('/learning-workflow/reviews/')) {
    if (p.endsWith('/actions')) { const card = cards.find(c => c.id === p.split('/')[3]); card.paused = body.action === 'pause'; card.revision++; if (body.action === 'postpone') card.due_at = '2026-11-24T00:00:00Z'; }
    return copy({ cards });
  }
  if (p.startsWith('/explanation-revisions')) { if (p.endsWith('/draft')) revision.revision = { ...revision.revision, answer: body.answer, revision: revision.revision.revision + 1 }; if (p.endsWith('/submit')) { revision.revision.status = 'graded'; revision.evaluation = { id: body.command_key, status: 'graded', feedback, error_code: null }; } return copy(revision); }
  if (p.startsWith('/learning-graph/paths')) return guideStudyPath(p, method, body);
  if (p.startsWith('/learning-graph')) return copy(graph);
  if (p.startsWith('/preparation-requests/artifacts/')) { const a = preparations[0].artifacts.find(a => a.id === p.split('/')[3]); a.status = body.action === 'apply' ? 'applied' : 'discarded'; a.applied_id = 'summary-guide'; return { applied_id: a.applied_id }; }
  if (p === '/preparation-requests') return copy({ requests: preparations });
  if (p === '/learning-mate/context') return { courseId: 'course-os', materialId: 'material-process', sourceHash: 'guide-source-v1', title: '프로세스와 스레드' };
  if (p === '/integrations') return copy({ configured: true, worker_enabled: true, connection, job: null });
  if (p.endsWith('/schedule')) { connection = { ...connection, sync_enabled: body.enabled, sync_interval_minutes: body.minutes, revision: connection.revision + 1 }; return copy(connection); }
  if (p.endsWith('/sync')) return { job_id: 'job-guide' };
  if (p.startsWith('/integrations/events/')) { if (method === 'PUT') events[0].course_id = body.course_id; return copy({ timezone: 'Asia/Seoul', events }); }
  if (p.startsWith('/source-integrations/drafts/')) { for (const s of Object.values(sourceState)) for (const d of s.drafts) if (d.id === p.split('/')[3]) { d.status = body.action === 'apply' ? 'applied' : 'discarded'; d.material_id = 'material-process'; } return {}; }
  if (p.startsWith('/source-integrations/')) { const provider = p.split('/')[2]; if (p.endsWith('/documents')) return copy({ documents: [{ id: `doc-${provider}`, title: sourceState[provider].drafts[0].title, modified: '2026-11-22T08:00:00Z', kind: provider === 'notion' ? 'page' : 'document' }], cursor: null }); if (p.endsWith('/imports')) return copy(sourceState[provider].drafts[0]); return copy(sourceState[provider]); }
  throw new Error(`안내용 데이터가 없는 경로입니다: ${p}`);
}
const chatSession = { id: 'chat-guide', title: '프로세스와 스레드의 차이', createdAt: at, updatedAt: at };
const messages = [{ role: 'user', content: '같은 프로세스의 스레드는 모든 메모리를 공유하나요?' }, { role: 'assistant', content: '코드와 데이터 영역은 공유하지만 **스택과 레지스터, 프로그램 카운터는 각 스레드가 따로 유지**해요.\n\n공유 데이터에 동시에 접근하면 동기화가 필요합니다. 예를 들어 두 스레드가 같은 카운터를 수정한다면 임계 구역을 보호해야 해요.\n\n근거로 본 자료: 프로세스와 스레드 5쪽' }];
export const loadSummaryChatSessions = async () => [copy(chatSession)];
export const loadSummaryChatMessages = async () => copy(messages);
export const createSummaryChatSession = async () => copy(chatSession);
export const createSummaryChatTitle = text => text.slice(0, 20);
export const saveSummaryChatMessage = async () => {};
export const sendAgentMessage = async () => ({ result: messages[1].content, threadId: 'thread-guide' });

// Reuse the production storage helpers. The guide replaces the network transport only.
export { LearningApiError, shouldAcceptSession, draftKey, readLocalDraft, writeLocalDraft, removeLocalDraft } from '../../../src/services/learningSessions.ts?guide-pure-helpers';
graph.study_target_id = 'concept-deadlock';
graph.study_plan = [
  { concept_id: 'concept-resource', title: '자원 할당', course_name: '운영체제', reason: '다음 개념에 필요한 기초부터 확인해요.' },
  { concept_id: 'concept-deadlock', title: '교착 상태', course_name: '운영체제', reason: '관련 개념을 설명하고 이해를 확인해요.' },
];
graph.connections = [];
const studySessions = new Map();
let guidePath = null;
const guideLessonContent = {
  '자원 할당': {
    introduction: '자원 할당은 프로세스가 실행에 필요한 자원을 받아 사용하는 과정입니다. 자원을 기다리면서 다른 자원을 가진 상태가 이어지면 교착 상태를 살펴볼 필요가 있습니다.',
    hint1: '프로세스가 실행할 때 필요한 자원이 무엇인지 먼저 떠올려 보세요.',
    hint2: '프로세스가 자원을 요청하고, 사용한 뒤 반납하는 흐름과 자원이 부족할 때의 대기를 연결해 보세요.',
    reference: '자원 할당은 운영체제가 프로세스에 실행에 필요한 자원을 배정하는 과정입니다. 프로세스는 필요한 자원을 요청하고 사용한 뒤 반납합니다. 자원이 부족하면 대기할 수 있으며, 다른 자원을 보유한 채 기다리는 관계는 교착 상태를 이해하는 기초가 됩니다.',
    source: '프로세스는 실행에 필요한 자원을 요청하고 할당받아 사용한 뒤 반납한다. 자원이 부족하면 대기하며, 자원 보유와 대기 관계가 순환하면 교착 상태가 발생할 수 있다.',
  },
  '교착 상태': {
    introduction: '교착 상태는 여러 프로세스가 서로 가진 자원을 기다리면서 진행하지 못하는 상태입니다. 자원 보유와 대기 관계를 함께 확인해야 합니다.',
    hint1: '각 프로세스가 가진 자원과 기다리는 자원을 따로 적어 보세요.',
    hint2: '프로세스 A가 B의 자원을 기다리고, B도 A의 자원을 기다릴 때 누가 먼저 진행할 수 있는지 생각해 보세요.',
    reference: '교착 상태는 여러 프로세스가 서로가 보유한 자원을 기다리며 진행하지 못하는 상태입니다. 예를 들어 A가 자원 1을 보유한 채 자원 2를 기다리고, B는 자원 2를 보유한 채 자원 1을 기다리면 둘 다 진행하지 못할 수 있습니다.',
    source: '교착 상태에서는 프로세스가 다른 프로세스가 가진 자원을 기다리며 진행하지 못한다. 자원의 보유 관계와 대기 관계를 함께 확인해야 한다.',
  },
};
function prepareGuideSession(step) {
  const title = step.title;
  const introduction = guideLessonContent[title].introduction;
  return { id: step.session_id, course_id: 'course-os', material_id: 'material-process', material_name: title, status: 'active', revision: 0, target_minutes: 5, concept_count: 1, completed_count: 0, source_changed: false, operation: null, result: [], allowed_actions: ['submit','unknown','help','pause','finish','abandon'], current: { id: 'item-'+step.session_id, title, position: 0, phase: 'recall_answering', revision: 0, question: title+'의 핵심을 자기 말로 설명해주세요.', introduction, draft: '', help: {}, feedback: null, evaluation_error: false, self_check: null, reported: false, check: null, check_result: null } };
}
function guideStudyPath(p, method, body) {
  if (method === 'POST' && p === '/learning-graph/paths' && guidePath?.id !== body.idempotency_key
    && (!guidePath || guidePath.status !== 'active' || guidePath.target_id !== body.concept_id)) {
    const steps = body.concept_id === 'concept-resource' ? graph.study_plan.slice(0,1) : graph.study_plan;
    guidePath = { id: body.idempotency_key, target_id: body.concept_id, status: 'active', position: 0,
      steps: steps.map((s, position) => ({ ...s, position, session_id: body.idempotency_key+'-'+position, session_status: 'active', session_complete: false, source_changed: false })) };
  }
  if (!guidePath) throw new Error('로컬 미리보기를 새로 열었어요. 개념 지도에서 학습을 시작해주세요.');
  if (p.endsWith('/next')) {
    const current = guidePath.steps[body.position];
    if (!current.session_complete) throw new Error('현재 개념을 먼저 마쳐주세요.');
    guidePath.position = Math.max(guidePath.position, body.position+1);
    if (guidePath.position >= guidePath.steps.length) guidePath.status = 'completed';
  }
  for (const step of guidePath.steps) if (!studySessions.has(step.session_id)) studySessions.set(step.session_id, prepareGuideSession(step));
  return copy(guidePath);
}
export async function learningRequest(path, method='GET', body={}) {
  const id = path.split('/')[1];
  if (path.endsWith('/history')) return { items: [] };
  const session = studySessions.get(id);
  if (!session) throw new Error('안내용 학습을 찾을 수 없어요. 개념 지도에서 시작해주세요.');
  const item = session.current;
  if (method === 'PATCH' && path.endsWith('/draft') && item) { item.draft=body.text;item.revision++; }
  if (method === 'POST') {
    if (path.endsWith('/help')) {
      const content = item && guideLessonContent[item.title];
      if (session.status !== 'active' || !content || !['hint1','hint2','reference','source'].includes(body.help_type)) throw new Error('현재 단계에서 요청할 수 없는 도움입니다.');
      item.help[body.help_type] = content[body.help_type];
      if (body.help_type === 'hint2') item.help.hint1 = content.hint1;
      item.revision++;session.revision++;
      return copy(session);
    }
    session.revision++;
    if (path.endsWith('/answers') && body.kind==='recall') {
      item.draft=body.answer;item.phase='recall_feedback';item.feedback={criteria:[{criterion_id:'핵심 설명',status:'met',student_quote:body.answer,reason:'원문의 핵심을 설명했어요.',source_refs:[]}]};session.allowed_actions=['advance','help','finish','pause','abandon'];
    } else if (path.endsWith('/answers') && body.kind==='check') {
      session.allowed_actions=['advance','help','finish','pause','abandon'];item.phase='check_feedback';item.check_result={selected:body.answer,answer_index:0,correct:body.answer===0,explanation:'자원을 기다리는 관계를 확인하면 진행이 멈춘 이유를 설명할 수 있어요.'};
    } else if (body.action==='unknown' && item) {
      item.phase='repair';session.allowed_actions=['advance','help','finish','pause','abandon'];
    } else if (body.action==='advance' && ['recall_feedback','repair'].includes(item?.phase)) {
      item.phase='check_answering';item.check={question:'진행이 멈춘 원인을 확인할 때 먼저 볼 것은 무엇인가요?',options:['프로세스의 자원 보유와 대기 관계','화면의 색상']};session.allowed_actions=['submit','help','finish','pause','abandon'];
    } else if (body.action==='advance' && item.phase==='check_feedback') {
      session.completed_count=1;session.status='completed';session.current=null;session.allowed_actions=[];session.result=[{title:item.title,recall:item.feedback?'sufficient':'ungraded',check:item.check_result.correct?'correct':'incorrect',assisted:Object.keys(item.help).length>0,prior_instruction:true,repeated:false,reported:false}];
      const step=guidePath.steps.find(s=>s.session_id===id);step.session_complete=true;step.session_status='completed';
    }
  }
  return copy(session);
}
