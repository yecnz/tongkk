import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SourceConnections from '../../src/features/integrations/SourceConnections';
import CalendarConnections from '../../src/features/integrations/CalendarConnections';
import ExternalEvents from '../../src/features/integrations/ExternalEvents';
import Mini from '../../src/pages/Mini';
import MiniTutor from '../../src/pages/MiniTutor';
import MenubarSettings from '../../src/pages/MenubarSettings';
import { integrationDemoDay, resetIntegrationDemo } from './integrations-data';

export { handleIntegrationRequest } from './integrations-data';

function IntegrationsScreen() {
  const [version, setVersion] = useState(0);
  const [eventsVersion, setEventsVersion] = useState(0);
  useEffect(() => { const refresh = () => setEventsVersion(value => value + 1); window.addEventListener('promo:integration-events-changed', refresh); return () => window.removeEventListener('promo:integration-events-changed', refresh); }, []);
  return <div className="workflow-stack">
    <div className="workflow-actions"><p className="workflow-muted">예시 계정으로 자료 검색·버전 비교·가져오기·연결 해제를 체험하세요. 실제 계정에 연결하거나 외부 원본을 수정하지 않습니다.</p><button type="button" onClick={() => { resetIntegrationDemo(); setVersion(value => value + 1); }}>연결 예시 초기화</button></div>
    <div key={version} className="workflow-stack"><SourceConnections /><CalendarConnections /><ExternalEvents key={eventsVersion} day={integrationDemoDay()} /></div>
  </div>;
}

function MenubarScreen() {
  return <DemoAccountNotice>
    <div className="workflow-actions"><Link to="/mini/settings">메뉴바 설정 보기</Link><Link to="/mini/tutor">메뉴바 튜터 열기</Link></div>
    <p className="workflow-muted">오늘 할 일의 완료 표시와 자료 선택을 직접 눌러보세요. 튜터는 준비된 정렬 알고리즘 답변으로 동작합니다.</p>
    <Mini />
  </DemoAccountNotice>;
}

function MenubarTutorScreen() {
  return <DemoAccountNotice><p className="workflow-muted">예시 질문: “퀵 정렬은 왜 최악 O(n²)인가요?” · 준비된 답변이며 새 AI 답변을 생성하지 않습니다.</p><MiniTutor /></DemoAccountNotice>;
}

function MenubarSettingsScreen() {
  return <DemoAccountNotice><p className="workflow-muted">테마·D-day 범위·알림 시간을 예시로 바꿔볼 수 있어요. Mac 자동 실행과 전역 단축키는 실제 Mac 앱에서 사용할 수 있으며, 여기서는 시스템 설정을 변경하지 않습니다.</p><MenubarSettings /></DemoAccountNotice>;
}

function DemoAccountNotice({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState(false);
  useEffect(() => { const show = () => setNotice(true); window.addEventListener('promo:integration-account-demo', show); return () => window.removeEventListener('promo:integration-account-demo', show); }, []);
  return <div>{notice && <p className="workflow-muted" role="status">체험용 계정입니다. 실제 로그인·로그아웃과 계정 변경은 통크크 앱에서 할 수 있어요.</p>}{children}</div>;
}

export const integrationScreens = { integrations: IntegrationsScreen, menubar: MenubarScreen };
export const miniTutorScreen = MenubarTutorScreen;
export const menubarSettingsScreen = MenubarSettingsScreen;
