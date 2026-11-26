import { Button, InlineAlert } from '../../components/ui';
import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import CustomSelect from '../../components/CustomSelect';
import { fetchCourses, type CourseRecord } from '../../services/courses';
import { workflowRequest } from '../../services/workflow';
type Event = { id: string; title: string; all_day: boolean; start_value: string; end_value: string; start_at: string; course_id: string | null };
export default function ExternalEvents({ day }: { day: string }) {
  const { user } = useAuth(); const [data, setData] = useState<{ events: Event[]; timezone: string } | null>(null);
  const [courses, setCourses] = useState<CourseRecord[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return; let active = true; setData(null); setError('');
    Promise.all([workflowRequest<{ events: Event[]; timezone: string }>(`/integrations/events/${day}`), fetchCourses()]).then(([events, values]) => { if (active) { setData(events); setCourses(values); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user, day, retry]);
  async function link(event: string, course: string) {
    setBusy(true); setError('');
    try { await workflowRequest(`/integrations/events/${event}/course`, 'PUT', { course_id: course || null }); setRetry(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : '과목을 연결하지 못했어요.'); }
    finally { setBusy(false); }
  }
  if (!user) return null;
  return <Card className="workflow-surface workflow-panel workflow-stack"><h2 className="workflow-panel-title">가져온 캘린더 일정</h2>
    {error ? <InlineAlert tone="error">{error} <Button type="button" onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button></InlineAlert>
      : !data ? <p role="status">일정을 확인하는 중…</p> : !data.events.length ? <p>가져온 일정이 없습니다. 마이페이지에서 캘린더를 연결해 주세요.</p>
        : data.events.map(event => <section className="workflow-item" key={event.id}><h3>{event.title}</h3><p className="workflow-meta">{event.all_day ? `종일 · ${event.start_value}부터 ${event.end_value} 전날까지` : new Date(event.start_at).toLocaleTimeString('ko-KR', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' })} · 읽기 전용</p>
          <label className="workflow-setting-row">연결 과목 <CustomSelect value={event.course_id || ''} disabled={busy} onChange={value => { void link(event.id, value); }} options={[{ value: '', label: '연결하지 않음' }, ...courses.map(c => ({ value: c.id, label: c.name }))]} aria-label="연결 과목" /></label></section>)}
  </Card>;
}
