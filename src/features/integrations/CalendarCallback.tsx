import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { completeCalendarConnection, CALENDAR_CALLBACK_PATH } from '../../services/calendarIntegration';
import LearningLayout from '../learningSession/LearningLayout';
export default function CalendarCallback() {
  const { user } = useAuth();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [status, setStatus] = useState('캘린더 연결을 확인하는 중…');
  useEffect(() => {
    window.history.replaceState(window.history.state, '', CALENDAR_CALLBACK_PATH);
    if (!user) return;
    const state = params.get('state'), code = params.get('code');
    if (!state || !code || params.has('error')) { setStatus('연결을 취소했거나 권한을 받지 못했어요. 마이페이지에서 다시 연결해주세요.'); return; }
    let active = true;
    completeCalendarConnection(user.id, state, code).then(() => { if (active) setStatus('Google Calendar를 연결했어요. 마이페이지에서 일정을 가져올 수 있어요.'); })
      .catch(e => { if (active) setStatus(e instanceof Error ? e.message : '연결을 마치지 못했어요. 다시 연결해주세요.'); });
    return () => { active = false; };
  }, [user, params]);
  return <LearningLayout active="마이페이지"><h1>캘린더 연결</h1><p role="status">{user ? status : '로그인 세션이 끝났어요. 로그인 후 마이페이지에서 연결을 다시 시작해주세요.'}</p><Link to={user ? '/mypage' : '/auth'}>{user ? '마이페이지로' : '로그인'}</Link></LearningLayout>;
}
