import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { workflowRequest } from '../../services/workflow';
import type { CalendarIntegration } from '../../services/calendarIntegration';
export default function CalendarConnections() {
  const { user } = useAuth(); const [data, setData] = useState<CalendarIntegration | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [deleteEvents, setDeleteEvents] = useState(true); const [retry, setRetry] = useState(0);
  const polling = data?.job?.status === 'queued' || data?.job?.status === 'running';
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = () => { void workflowRequest<CalendarIntegration>('/integrations').then(v => { if (active) setData(v); }).catch(e => { if (active) setError(e.message); }); };
    load(); const timer = polling ? setInterval(load, 3000) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [user, retry, polling]);
  async function action(name: 'connect' | 'sync' | 'disconnect') {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      if (name === 'connect') {
        const value = await workflowRequest<{ url: string }>('/integrations/google-calendar/connect', 'POST');
        const url = new URL(value.url);
        if (url.origin !== 'https://accounts.google.com') throw new Error('연결 주소를 확인하지 못했어요.');
        window.location.assign(value.url);
      } else if (name === 'sync') {
        await workflowRequest('/integrations/google-calendar/sync', 'POST');
        setNotice('일정 가져오기를 예약했어요.'); setRetry(n => n + 1);
      } else {
        const value = await workflowRequest<{ provider_revoked: boolean }>('/integrations/google-calendar/disconnect', 'POST', { revision: data?.connection?.revision, delete_events: deleteEvents });
        setNotice(value.provider_revoked ? '연결과 캘린더 접근 권한을 해제했어요.' : '앱 연결을 해제했어요. Google의 접근 권한도 확인하려면 계정 권한 관리에서 해제해주세요.');
        setRetry(n => n + 1);
      }
    } catch (e) { setError(e instanceof Error ? e.message : '연결 상태를 변경하지 못했어요.'); }
    finally { setBusy(false); }
  }
  async function scheduling(enabled:boolean,minutes:number) { if(busy||!data?.connection)return;setBusy(true);setError('');try {await workflowRequest('/integrations/google-calendar/schedule','PUT',{revision:data.connection.revision,enabled,minutes});setRetry(n=>n+1);}catch(e){setError(e instanceof Error?e.message:'자동 동기화를 설정하지 못했어요.');}finally{setBusy(false);}}
  if (!user) return null;
  const connected = data?.connection?.status === 'connected';
  return <Card className="learning-card workflow-stack"><h2>연결된 서비스</h2><h3>Google Calendar</h3>
    <p>읽기 전용으로 기본 캘린더의 지난 30일~앞으로 180일 일정을 가져와요. 원본 일정은 수정하지 않아요.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(n => n + 1); }}>다시 확인</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <p role="status">연결을 확인하는 중…</p> : !data.configured ? <p>서버에 Google OAuth 앱과 암호화 키를 설정하면 연결할 수 있어요.</p> : <>
      <p>{connected ? '연결됨' : data.connection?.status === 'reconnect' ? '다시 연결이 필요해요.' : '연결되지 않았어요.'}</p>
      {connected && <div className="workflow-stack"><label><input type="checkbox" checked={data.connection?.sync_enabled||false} disabled={busy||!data.worker_enabled} onChange={e=>{void scheduling(e.target.checked,data.connection?.sync_interval_minutes||30);}}/>일정을 자동으로 동기화</label><label>가져오기 간격<select disabled={busy} value={data.connection?.sync_interval_minutes||30} onChange={e=>{void scheduling(Boolean(data.connection?.sync_enabled),Number(e.target.value));}}>{[15,30,60,360,1440].map(n=><option key={n} value={n}>{n<60?`${n}분`:`${n/60}시간`}</option>)}</select></label>{data.connection?.next_sync_at&&<p>다음 확인: {new Date(data.connection.next_sync_at).toLocaleString('ko-KR')}</p>}<p>실패하면 간격을 늘려 다시 시도해요. 연결을 해제하면 자동 동기화도 중지돼요.</p></div>}
      {data.connection?.last_synced_at && <p>최근 가져오기: {new Date(data.connection.last_synced_at).toLocaleString('ko-KR')}</p>}
      {(data.job?.status === 'failed' || data.connection?.last_error) && <p role="alert">일정을 가져오지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.</p>}
      {polling && <p role="status">일정을 가져오는 중…</p>}
      <div className="workflow-tabs"><button type="button" disabled={busy} onClick={() => { void action('connect'); }}>{connected ? '다른 계정으로 다시 연결' : 'Google Calendar 연결'}</button>
        {connected && <button type="button" disabled={busy || polling || !data.worker_enabled} onClick={() => { void action('sync'); }}>일정 가져오기</button>}</div>
      {!data.worker_enabled && <p>일정을 가져오려면 서버의 학습 워커를 켜야 해요.</p>}
      {data.connection && data.connection.status !== 'disconnected' && <><label><input type="checkbox" checked={deleteEvents} onChange={e => setDeleteEvents(e.target.checked)} />연결 해제 시 가져온 일정도 삭제</label>
        <button type="button" className="workflow-button" disabled={busy} onClick={() => { void action('disconnect'); }}>연결 해제</button></>}
    </>}
  </Card>;
}
