import type { CalendarConnection, CalendarIntegration } from '../../src/services/calendarIntegration';

type Provider = 'google-drive' | 'notion';
type Draft = { id: string; course_id: string; external_id: string; title: string; markdown: string; status: 'ready' | 'applied' | 'discarded'; material_id: string | null; source_modified: string; notices: string[] };
type SourceState = { configured: boolean; connection: CalendarConnection; drafts: Draft[] };
type ExternalEvent = { id: string; title: string; all_day: boolean; start_value: string; end_value: string; start_at: string; end_at: string; course_id: string | null };

const copy = <T,>(value: T): T => structuredClone(value);
const day = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const connection = (id: string): CalendarConnection => ({ id, status: 'connected', revision: 1, last_synced_at: new Date().toISOString(), last_error: null, sync_enabled: true, sync_interval_minutes: 30, next_sync_at: new Date(Date.now() + 1_800_000).toISOString() });
const documents = {
  'google-drive': [{ id: 'drive-algorithm', title: '알고리즘 3주차 강의자료', modified: new Date().toISOString(), kind: 'document' }, { id: 'drive-sort', title: '정렬 알고리즘 비교 노트', modified: new Date().toISOString(), kind: 'document' }],
  notion: [{ id: 'notion-algorithm', title: '알고리즘 스터디 · 정렬 정리', modified: new Date().toISOString(), kind: 'page' }, { id: 'notion-quiz', title: '퀵 정렬 오답 노트', modified: new Date().toISOString(), kind: 'page' }],
};
const previousText = '# 정렬 알고리즘\n\n- 퀵 정렬: 평균 O(n log n)\n- 병합 정렬: 평균 O(n log n)\n\n평균 성능을 비교해 정렬을 선택합니다.';
const currentText = '# 정렬 알고리즘\n\n- 퀵 정렬: 평균 O(n log n), 최악 O(n²)\n- 병합 정렬: 평균·최악 O(n log n), 안정 정렬\n\n## 새로 보완한 내용\n피벗이 계속 최솟값이나 최댓값이면 퀵 정렬의 분할이 한쪽으로 치우칩니다. 평균 성능뿐 아니라 최악 시간·안정성·추가 공간을 함께 비교하세요.';
const sourceInitial = (provider: Provider): SourceState => ({ configured: true, connection: connection(`demo-${provider}`), drafts: [{ id: `${provider}-v1`, course_id: 'course-demo', external_id: documents[provider][0].id, title: documents[provider][0].title, markdown: previousText, status: 'applied', material_id: 'material-demo', source_modified: new Date(Date.now() - 86_400_000).toISOString(), notices: ['앞서 저장한 예시 자료입니다. 외부 원본은 변경되지 않습니다.'] }] });
let sources: Record<Provider, SourceState> = { 'google-drive': sourceInitial('google-drive'), notion: sourceInitial('notion') };
let calendar: CalendarIntegration = { configured: true, worker_enabled: true, connection: connection('demo-google-calendar'), job: { status: 'completed', error_code: null } };
const initialEvents = (): ExternalEvent[] => [
  { id: 'external-study', title: '알고리즘 스터디', all_day: false, start_value: day(), end_value: day(), start_at: `${day()}T18:00:00+09:00`, end_at: `${day()}T19:00:00+09:00`, course_id: 'course-demo' },
  { id: 'external-exam', title: '알고리즘 중간고사', all_day: true, start_value: day(7), end_value: day(8), start_at: `${day(7)}T00:00:00+09:00`, end_at: `${day(8)}T00:00:00+09:00`, course_id: 'course-demo' },
];
let events = initialEvents();
let sequence = 1;
const eventsChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('promo:integration-events-changed')); };
export const integrationDemoDay = () => day();
export function resetIntegrationDemo() {
  sources = { 'google-drive': sourceInitial('google-drive'), notion: sourceInitial('notion') };
  calendar = { configured: true, worker_enabled: true, connection: connection('demo-google-calendar'), job: { status: 'completed', error_code: null } };
  events = initialEvents(); sequence = 1;
}

// This handler never reads credentials, starts OAuth, or sends a network request.
export function handleIntegrationRequest(path: string, method = 'GET', body: unknown = {}): unknown | undefined {
  const request = new URL(path, 'https://demo.invalid');
  const data = (body ?? {}) as Record<string, unknown>;
  const sourceMatch = request.pathname.match(/^\/source-integrations\/(google-drive|notion)(?:\/(.*))?$/);
  if (sourceMatch) {
    const provider = sourceMatch[1] as Provider;
    const state = sources[provider]; const action = sourceMatch[2] ?? '';
    if (!action && method === 'GET') return copy(state);
    if (action === 'connect' && method === 'POST') { state.connection = connection(`demo-${provider}`); return { connected: true }; }
    if (action === 'disconnect' && method === 'POST') { state.connection.status = 'disconnected'; state.connection.revision++; return { provider_revoked: true }; }
    if (action === 'documents') {
      if (state.connection.status !== 'connected') throw new Error('예시 연결을 먼저 연결해 주세요.');
      const query = (request.searchParams.get('q') ?? '').trim().toLowerCase();
      return { documents: copy(documents[provider].filter(document => document.title.toLowerCase().includes(query))), cursor: null };
    }
    if (action === 'imports' && method === 'POST') {
      if (state.connection.status !== 'connected') throw new Error('예시 연결을 먼저 연결해 주세요.');
      const document = documents[provider].find(item => item.id === data.external_id);
      if (!document) throw new Error('자료 찾기에서 예시 자료를 선택해 주세요.');
      const existing = state.drafts.find(draft => draft.external_id === document.id && draft.course_id === data.course_id && draft.markdown === currentText && draft.status !== 'discarded');
      if (existing) return copy(existing);
      const draft: Draft = { id: `${provider}-import-${sequence++}`, course_id: String(data.course_id || 'course-demo'), external_id: document.id, title: document.title, markdown: currentText, status: 'ready', material_id: null, source_modified: document.modified, notices: ['체험용 최신 본문입니다. 저장 전 앞서 저장한 본문과 비교할 수 있습니다.'] };
      state.drafts.unshift(draft); return copy(draft);
    }
  }
  const draftMatch = request.pathname.match(/^\/source-integrations\/drafts\/([^/]+)\/actions$/);
  if (draftMatch && method === 'POST') {
    const draft = Object.values(sources).flatMap(source => source.drafts).find(item => item.id === draftMatch[1]);
    if (!draft) throw new Error('체험 자료를 찾지 못했어요.');
    draft.status = data.action === 'apply' ? 'applied' : 'discarded';
    if (data.action === 'apply') draft.material_id = 'material-demo';
    return copy(draft);
  }
  if (request.pathname === '/integrations' && method === 'GET') return copy(calendar);
  if (request.pathname.startsWith('/integrations/google-calendar/')) {
    const action = request.pathname.split('/').at(-1);
    if (action === 'connect') { calendar.connection = connection('demo-google-calendar'); return { connected: true }; }
    if (action === 'disconnect') { calendar.connection!.status = 'disconnected'; calendar.connection!.sync_enabled = false; calendar.connection!.revision++; if (data.delete_events) events = []; eventsChanged(); return { provider_revoked: true }; }
    if (action === 'sync') { calendar.connection!.last_synced_at = new Date().toISOString(); calendar.job = { status: 'completed', error_code: null }; events = initialEvents(); eventsChanged(); return { status: 'completed', imported: events.length }; }
    if (action === 'schedule') { calendar.connection!.sync_enabled = Boolean(data.enabled); calendar.connection!.sync_interval_minutes = Number(data.minutes) || 30; calendar.connection!.revision++; calendar.connection!.next_sync_at = data.enabled ? new Date(Date.now() + Number(data.minutes) * 60_000).toISOString() : null; return copy(calendar.connection); }
  }
  const eventMatch = request.pathname.match(/^\/integrations\/events(?:\/([^/]+))?(?:\/(course))?$/);
  if (eventMatch) {
    if (eventMatch[2] === 'course' && method === 'PUT') { const event = events.find(item => item.id === eventMatch[1]); if (event) event.course_id = data.course_id ? String(data.course_id) : null; return { updated: true }; }
    return { timezone: 'Asia/Seoul', events: copy(events.filter(event => !eventMatch[1] || event.start_value === eventMatch[1])) };
  }
  return undefined;
}
