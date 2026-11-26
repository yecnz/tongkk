import { Button, InlineAlert } from '../../components/ui';
import BrandLogo from '../../components/BrandLogo';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar, SidebarIcon, pageRoutes, type PageRouteLabel, useSidebarOpen } from '../../common';
import { LearningNavigationContext } from './navigation';
import LearningLink from './LearningLink';
import './LearningSession.css';

export default function LearningLayout({ children, active = '학습 세션' }: { children: ReactNode; active?: PageRouteLabel }) {
  const navigate = useNavigate();
  const [sidebar, setSidebar] = useSidebarOpen();
  const [error, setError] = useState('');
  const beforeLeaveRef = useRef<(() => Promise<void>) | null>(null);
  const leaving = useRef(false);
  const go = useCallback(async (to: string) => {
    if (leaving.current) return;
    leaving.current = true; setError('');
    try {
      await beforeLeaveRef.current?.();
      navigate(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : '답변 저장을 확인한 뒤 다시 이동해 주세요.');
    } finally { leaving.current = false; }
  }, [navigate]);
  const navigation = useMemo(() => ({ beforeLeaveRef, go }), [go]);
  return <LearningNavigationContext.Provider value={navigation}>
    <div className="learning-page">
      {sidebar && <Sidebar active={active} onNav={item => { void go(pageRoutes[item]); }} onClose={() => setSidebar(false)} />}
      <header className="learning-header">
        <Button type="button" className="learning-menu-button" aria-label={sidebar ? '메뉴 닫기' : '메뉴 열기'} onClick={() => setSidebar(!sidebar)}><SidebarIcon /></Button>
        <LearningLink to="/" className="brand-home"><BrandLogo /></LearningLink>
        <span className="learning-header-label">/ {active === '오답 노트' ? '복습 관리' : active}</span>
        <LearningLink to="/" className="learning-header-back">대시보드로</LearningLink>
      </header>
      <main className="app-container learning-main">
        {error && <InlineAlert  tone="error">{error}</InlineAlert>}
        {children}
      </main>
    </div>
  </LearningNavigationContext.Provider>;
}
