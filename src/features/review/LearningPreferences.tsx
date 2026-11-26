import { useEffect, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { Card } from '../../common';
import CustomSelect from '../../components/CustomSelect';
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
  return <Card className="workflow-surface workflow-panel workflow-stack"><h2 className="workflow-panel-title">복습 설정</h2>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(n => n + 1); }}>다시 불러오기</button></p>}
    {data && <><div className="workflow-subsection"><label className="workflow-toggle"><span>앞으로 완료한 설명 학습을 자동으로 복습에 추가</span><input type="checkbox" checked={data.auto_review} disabled={busy} onChange={e => { void save({ ...data, auto_review: e.target.checked }); }} /></label>
      <label className="workflow-setting-row">학습 시간대 <CustomSelect value={data.timezone} disabled={busy} aria-label="학습 시간대"
        onChange={timezone => { void save({ ...data, timezone }); }}
        options={Array.from(new Set([data.timezone, 'Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Europe/London'])).map(zone => ({ value: zone, label: zone }))} /></label></div>
      <details className="workflow-details"><summary>자동 복습 안내</summary>
        <p>이후 완료하는 학습이 복습 목록에 추가되며, 예정일에 새 사례 문제가 준비됩니다. 복습 확인·일시 정지·미루기는 복습 관리에서 설정해 주세요.</p>
      </details></>}
  </Card>;
}
