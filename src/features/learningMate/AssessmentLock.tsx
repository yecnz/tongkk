import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { workflowRequest } from '../../services/workflow';
export default function AssessmentLock() {
  const { user } = useAuth(); const token = useRef(crypto.randomUUID()); const sequence = useRef(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    let active = true;
    const send = (enabled: boolean) => workflowRequest('/learning-mate/assessment-lock', 'POST', { token: token.current, active: enabled, sequence: ++sequence.current });
    const lock = () => { void send(true).then(() => { if (active) setError(''); }).catch(() => { if (active) setError('시험 중 학습 도움 제한을 등록하지 못했어요. 연결을 확인해 주세요.'); }); };
    lock(); const timer = setInterval(lock, 30000);
    return () => { active = false; clearInterval(timer); void send(false).catch(() => {}); };
  }, [user]);
  return error ? <p role="alert">{error}</p> : null;
}
