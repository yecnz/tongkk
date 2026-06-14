import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useAuthGate } from "./AuthGateContext";
import { pageRoutes } from "./common";
import { SampleDemo } from "./components/SampleDemo";

// '예시로 둘러보기' 데모의 열림 상태를 한 곳에서 관리한다.
// welcome 모달·대시보드 빈 상태·요약 업로드 등 여러 진입점이 openSampleDemo()로 같은 데모를 연다.
type SampleDemoApi = { openSampleDemo: () => void };

const SampleDemoCtx = createContext<SampleDemoApi | null>(null);

export function useSampleDemo(): SampleDemoApi {
  const ctx = useContext(SampleDemoCtx);
  if (!ctx) throw new Error("useSampleDemo must be used within SampleDemoProvider");
  return ctx;
}

export function SampleDemoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openLogin } = useAuthGate();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const openSampleDemo = useCallback(() => setOpen(true), []);

  // '내 자료로 시작하기' — 게스트는 가입을 유도한다. 자료 요약 화면에서 연 데모면 그 화면(자료 목록)에
  // 그대로 머물고, 그 외(welcome·대시보드 빈 상태)에서는 강의를 추가할 대시보드로 보낸다.
  const start = useCallback(() => {
    setOpen(false);
    if (!user) { openLogin("signUp"); return; }
    if (location.pathname === pageRoutes["자료 요약"]) return;
    navigate(pageRoutes["대시보드"]);
  }, [user, openLogin, navigate, location.pathname]);

  const api = useMemo<SampleDemoApi>(() => ({ openSampleDemo }), [openSampleDemo]);

  return (
    <SampleDemoCtx.Provider value={api}>
      {children}
      {open && createPortal(<SampleDemo onClose={close} onStart={start} />, document.body)}
    </SampleDemoCtx.Provider>
  );
}
