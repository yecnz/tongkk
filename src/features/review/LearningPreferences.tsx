import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import { workflowRequest } from '../../services/workflow';
type Preferences = { auto_review: boolean; timezone: string };
export default function LearningPreferences() {
  const { user } = useAuth(); const [data, setData] = useState<Preferences | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    workflowRequest<Preferences>('/learning-workflow/preferences').then(v => { if (active) setData(v); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user, retry]);
  async function save(value: Preferences) {
    setBusy(true); setError('');
    try { setData(await workflowRequest<Preferences>('/learning-workflow/preferences', 'PUT', value)); }
    catch (e) { setError(e instanceof Error ? e.message : '설정을 저장하지 못했어요.'); }
    finally { setBusy(false); }
  }
  if (!user) return null;
  return <Card className="learning-card workflow-stack"><h2>복습 설정</h2>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(n => n + 1); }}>다시 불러오기</button></p>}
    {data && <><label><input type="checkbox" checked={data.auto_review} disabled={busy} onChange={e => { void save({ ...data, auto_review: e.target.checked }); }} />앞으로 완료한 설명 학습을 자동으로 복습에 추가</label>
      <label>학습 시간대 <select value={data.timezone} disabled={busy} onChange={e => { void save({ ...data, timezone: e.target.value }); }}>{Array.from(new Set([data.timezone, 'Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Europe/London'])).map(zone => <option key={zone}>{zone}</option>)}</select></label>
      <p className="workflow-muted">복습은 앱 안에서 확인해요. 일시 정지·미루기는 복습 관리에서 변경할 수 있어요.</p></>}
  </Card>;
}
