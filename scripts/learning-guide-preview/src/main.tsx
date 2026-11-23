/* eslint-disable react-refresh/only-export-components -- Standalone documentation preview entry point. */
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useSearchParams } from 'react-router-dom';
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

function Material() {
  useLearningScope({ courseId: 'course-os', materialId: 'material-process', title: '프로세스와 스레드' });
  const [params] = useSearchParams();
  return <LearningLayout active="자료 요약"><div className="learning-page-title"><p className="learning-eyebrow">운영체제</p><h1>프로세스와 스레드</h1></div>
    {params.get('panel') === 'preparation' ? <PreparationPanel course="운영체제" materialId="material-process" /> : <article className="guide-material"><h2>프로세스의 자원과 스레드의 실행 흐름</h2><p>프로세스는 실행 중인 프로그램이며 독립된 주소 공간을 가진다. 같은 프로세스의 스레드들은 코드와 데이터, 열린 파일 등의 자원을 공유한다.</p><h3>각 스레드가 독립적으로 가지는 정보</h3><p>프로그램 카운터와 레지스터, 스택은 스레드마다 별도로 관리한다. 따라서 같은 프로세스 안에서도 서로 다른 실행 위치를 유지할 수 있다.</p><h3>예시</h3><p>문서 편집기의 저장 작업과 화면 갱신 작업은 서로 다른 스레드에서 수행할 수 있다. 공유 데이터에 동시에 접근할 때는 동기화가 필요하다.</p><p className="workflow-muted">운영체제 강의자료 3장 4~7쪽</p></article>}
  </LearningLayout>;
}
function Stats() {
  const [params] = useSearchParams();
  return <LearningLayout active="학습 통계"><h1>학습 통계</h1>{params.get('view') === 'graph' ? <ConceptGraph /> : <ConceptHistory />}</LearningLayout>;
}
function Settings() {
  const [params] = useSearchParams();
  const panel = params.get('panel');
  return <LearningLayout active="마이페이지"><h1>마이페이지</h1>{panel === 'review' ? <LearningPreferences /> : panel === 'drive' || panel === 'notion' ? <SourceProvider provider={panel === 'drive' ? 'google-drive' : 'notion'} /> : <CalendarConnections />}</LearningLayout>;
}
function App() {
  return <BrowserRouter><LearningContextProvider><div className="guide-banner">화면 설명용 예시 학습 데이터 · 외부 계정에 연결하지 않는 로컬 미리보기</div><Routes>
    <Route path="/" element={<LearningLayout active="대시보드"><h1>오늘의 학습</h1><LearningBriefing /></LearningLayout>} />
    <Route path="/review" element={<ReviewHome />} />
    <Route path="/learn/review/:cardId" element={<ReviewPractice />} />
    <Route path="/learn/:sessionId/revisions/:revisionId" element={<ExplanationRevision />} />
    <Route path="/summary" element={<Material />} />
    <Route path="/stats" element={<Stats />} />
    <Route path="/mypage" element={<Settings />} />
    <Route path="/calendar" element={<LearningLayout active="학습 캘린더"><h1>2026년 11월 23일</h1><ExternalEvents day="2026-11-23" /><ReviewQueue day="2026-11-23" /></LearningLayout>} />
    <Route path="*" element={<LearningLayout><h1>화면 설명용 미리보기</h1><p>안내에 포함된 기능 주소로 이동해주세요.</p></LearningLayout>} />
  </Routes><LearningMateHost /></LearningContextProvider></BrowserRouter>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
import.meta.hot?.dispose(() => root.unmount());
