import { Component, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CourseProvider } from '../src/CourseContext';
import { ToastProvider } from '../src/ToastContext';
import LearningContextProvider from '../src/features/learningMate/LearningContextProvider';
import SourcePage from '../src/features/sources/SourcePage';
import ConnectedLearning from '../src/features/learningHistory/ConnectedLearning';
import Calendar from '../src/pages/Calendar';
import { learningScreens, learningRouteScreens } from './feature-demo/learning';
import { planningScreens } from './feature-demo/planning';
import { integrationScreens, miniTutorScreen, menubarSettingsScreen } from './feature-demo/integrations';
import '@fontsource-variable/noto-sans-kr';
import '../src/index.css';
import 'katex/dist/katex.min.css';
import './features-source.css';

const screens = { ...learningScreens, ...planningScreens, ...integrationScreens };
const paths = { explain: '/learn/demo-session', cards: '/flashcards', issues: '/review?tab=issues&issueId=issue-demo-0', courses: '/study-paths?path=67d5bc70-687e-4a96-a0e8-a7f637480251', resume: '/', plan: '/plan', stats: '/stats', integrations: '/mypage', menubar: '/mini' };
const requested = new URLSearchParams(location.search).get('feature') || 'explain';
const feature = requested in paths ? requested as keyof typeof paths : 'explain';
const initialPath = paths[feature];
const parentOrigin = location.origin;
function send(data: Record<string, unknown>) { if (parent !== window) parent.postMessage({ type: 'tongkk-feature', feature, ...data }, parentOrigin === 'null' ? '*' : parentOrigin); }

class ExampleBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p role="alert">예시를 불러오지 못했어요. ‘예시 초기화’를 눌러 다시 확인해 주세요.</p> : this.props.children; }
}
function ExistingDemo({ step }: { step: number }) {
  const navigate = useNavigate();
  useEffect(() => { send({ action: 'learning-step', step }); navigate(initialPath, { replace: true }); }, [navigate, step]);
  return null;
}
function Shell() {
  const navigate = useNavigate();
  const route = useLocation();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]');
      if (!link || event.defaultPrevented) return;
      const href = link.getAttribute('href')!;
      if (href.startsWith('/')) { event.preventDefault(); navigate(href); }
      else if (/^https?:/.test(href)) { event.preventDefault(); send({ action: 'notice', text: '외부 서비스 연결은 실제 통크크 앱에서 이용할 수 있어요.' }); }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
  useEffect(() => {
    let frame = 0;
    const root = document.getElementById('root')!;
    const report = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => send({ action: 'resize', height: Math.ceil(root.getBoundingClientRect().height) + 2 })); };
    const observer = new ResizeObserver(report); observer.observe(root); report();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => { send({ action: 'route', path: route.pathname }); }, [route.pathname]);
  const Explain = screens.explain, Cards = screens.cards, Issues = screens.issues, Courses = screens.courses;
  const Resume = screens.resume, Plan = screens.plan, Stats = screens.stats, Integrations = screens.integrations, Menubar = screens.menubar;
  const Revision = learningRouteScreens.revision, Review = learningRouteScreens.review, MiniTutor = miniTutorScreen, MiniSettings = menubarSettingsScreen;
  return <Routes>
    <Route path="/" element={<Resume />} /><Route path="/learn" element={<Explain />} /><Route path="/learn/:sessionId" element={<Explain />} />
    <Route path="/learn/connected/:conceptId" element={<ConnectedLearning />} />
    <Route path="/learn/:sessionId/revisions/:revisionId" element={<Revision />} /><Route path="/learn/review/:cardId" element={<Review />} />
    <Route path="/flashcards" element={<Cards />} /><Route path="/review" element={<Issues />} /><Route path="/study-paths" element={<Courses />} />
    <Route path="/plan" element={<Plan />} /><Route path="/calendar" element={<Calendar />} /><Route path="/stats" element={<Stats />} /><Route path="/mypage" element={<Integrations />} />
    <Route path="/mini" element={<Menubar />} /><Route path="/mini/tutor" element={<MiniTutor />} /><Route path="/mini/settings" element={<MiniSettings />} />
    <Route path="/source" element={<SourcePage />} /><Route path="/summary" element={<ExistingDemo step={1} />} /><Route path="/quiz" element={<ExistingDemo step={2} />} />
    <Route path="*" element={<Resume />} />
  </Routes>;
}
document.documentElement.dataset.feature = feature;
createRoot(document.getElementById('root')!).render(<ExampleBoundary><MemoryRouter initialEntries={[initialPath]}><ToastProvider><CourseProvider><LearningContextProvider><Shell /></LearningContextProvider></CourseProvider></ToastProvider></MemoryRouter></ExampleBoundary>);
