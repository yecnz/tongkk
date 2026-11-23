/* eslint-disable react-refresh/only-export-components -- Standalone documentation preview entry point. */
import { createRoot } from 'react-dom/client';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
import '../../../src/index.css';
import '../../../src/features/learningSession/LearningResume.css';
import './preview.css';
import LearningLayout from '../../../src/features/learningSession/LearningLayout';
import LearningBriefing from '../../../src/features/review/LearningBriefing';
import ReviewHome from '../../../src/features/review/ReviewHome';
import ReviewPractice from '../../../src/features/learningSession/ReviewPractice';
import LearningPreferences from '../../../src/features/review/LearningPreferences';
import ExplanationRevision from '../../../src/features/review/ExplanationRevision';
import ConceptHistory from '../../../src/features/learningHistory/ConceptHistory';
import ConceptGraph from '../../../src/features/learningHistory/ConceptGraph';
import PreparationPanel from '../../../src/features/preparation/PreparationPanel';
import CalendarConnections from '../../../src/features/integrations/CalendarConnections';
import ExternalEvents from '../../../src/features/integrations/ExternalEvents';
import { SourceProvider } from '../../../src/features/integrations/SourceConnections';
import ReviewQueue from '../../../src/features/review/ReviewQueue';
import LearningContextProvider from '../../../src/features/learningMate/LearningContextProvider';
import LearningMateHost from '../../../src/features/learningMate/LearningMateHost';
import { useLearningScope } from '../../../src/features/learningMate/context';
import { Sidebar, SidebarIcon, pageRoutes, type PageRouteLabel } from '../../../src/common';

function HostLayout({ active, narrow = false, children }: { active: PageRouteLabel; narrow?: boolean; children: ReactNode }) {
  const navigate = useNavigate();
  const [sidebar, setSidebar] = useState(false);
  return <div className="guide-host-page">
    {sidebar && <Sidebar active={active} onClose={() => setSidebar(false)} onNav={item => navigate(pageRoutes[item])} />}
    <header className="guide-host-header"><button type="button" aria-label="메뉴 열기" onClick={() => setSidebar(true)}><SidebarIcon /></button><Link to="/">Tongkk</Link><span>/ {active}</span></header>
    <main className={`app-container${narrow ? ' narrow' : ''}`}>{children}</main>
  </div>;
}
function PreviewBanner() {
  const [theme, setTheme] = useState('light');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <div className="guide-banner"><span>화면 설명용 예시 학습 데이터 · 외부 계정에 연결하지 않는 로컬 미리보기</span><label>화면 테마 <select value={theme} onChange={event => setTheme(event.target.value)}><option value="light">라이트</option><option value="dark">다크</option></select></label></div>;
}

function Material() {
  useLearningScope({ courseId: 'course-os', materialId: 'material-process', title: '프로세스와 스레드' });
  const [params] = useSearchParams();
  return <HostLayout active="자료 요약"><div className="learning-page-title"><p className="learning-eyebrow">운영체제</p><h1 className="guide-host-title">프로세스와 스레드</h1></div>
    {params.get('panel') === 'preparation' ? <PreparationPanel course="운영체제" materialId="material-process" /> : <article className="guide-material"><h2>프로세스의 자원과 스레드의 실행 흐름</h2><p>프로세스는 실행 중인 프로그램이며 독립된 주소 공간을 가진다. 같은 프로세스의 스레드들은 코드와 데이터, 열린 파일 등의 자원을 공유한다.</p><h3>각 스레드가 독립적으로 가지는 정보</h3><p>프로그램 카운터와 레지스터, 스택은 스레드마다 별도로 관리한다. 따라서 같은 프로세스 안에서도 서로 다른 실행 위치를 유지할 수 있다.</p><h3>예시</h3><p>문서 편집기의 저장 작업과 화면 갱신 작업은 서로 다른 스레드에서 수행할 수 있다. 공유 데이터에 동시에 접근할 때는 동기화가 필요하다.</p><p className="workflow-muted">운영체제 강의자료 3장 4~7쪽</p></article>}
  </HostLayout>;
}
function Stats() {
  const [params, setParams] = useSearchParams();
  const graph = params.get('view') === 'graph';
  return <HostLayout active="학습 통계"><nav className="workflow-tabs" aria-label="통계 보기"><button type="button" aria-pressed={!graph} onClick={() => setParams({view:'concepts'})}>개념별 학습 기록</button><button type="button" aria-pressed={graph} onClick={() => setParams({view:'graph'})}>개념 지도</button></nav>{graph ? <ConceptGraph /> : <ConceptHistory />}</HostLayout>;
}
function Settings() {
  const [params] = useSearchParams();
  const panel = params.get('panel');
  return <HostLayout active="마이페이지" narrow><h1 className="guide-host-title">마이페이지</h1>{panel === 'review' ? <LearningPreferences /> : panel === 'all' ? <div className="workflow-settings"><LearningPreferences /><CalendarConnections /><SourceProvider provider="google-drive" /><SourceProvider provider="notion" /></div> : panel === 'drive' || panel === 'notion' ? <SourceProvider provider={panel === 'drive' ? 'google-drive' : 'notion'} /> : <CalendarConnections />}</HostLayout>;
}
function App() {
  return <BrowserRouter><LearningContextProvider><PreviewBanner /><Routes>
    <Route path="/" element={<HostLayout active="대시보드"><h1 className="guide-host-title">오늘의 학습</h1><LearningBriefing /></HostLayout>} />
    <Route path="/review" element={<ReviewHome />} />
    <Route path="/learn/review/:cardId" element={<ReviewPractice />} />
    <Route path="/learn/:sessionId/revisions/:revisionId" element={<ExplanationRevision />} />
    <Route path="/summary" element={<Material />} />
    <Route path="/stats" element={<Stats />} />
    <Route path="/mypage" element={<Settings />} />
    <Route path="/calendar" element={<HostLayout active="학습 캘린더"><h1 className="guide-host-title">2026년 11월 23일</h1><div className="workflow-stack"><ExternalEvents day="2026-11-23" /><ReviewQueue day="2026-11-23" /></div></HostLayout>} />
    <Route path="*" element={<LearningLayout><h1>화면 설명용 미리보기</h1><p>안내에 포함된 기능 주소로 이동해주세요.</p></LearningLayout>} />
  </Routes><LearningMateHost /></LearningContextProvider></BrowserRouter>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
import.meta.hot?.dispose(() => root.unmount());
