import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useAuthGate } from "./AuthGateContext";
import { hasSeenTutorial, markTutorialSeen } from "./services/tutorialStorage";
import { ROUTE_TO_TUTORIAL, TUTORIALS } from "./tutorialContent";
import type { TutorialKey } from "./tutorialContent";
import { TutorialSheet } from "./components/TutorialSheet";

// 화면별 맥락형 튜토리얼의 트리거·상태를 한 곳에서 관리한다.
// - 라우트 첫 진입을 useLocation으로 감지해 자동 노출(welcome은 비로그인 첫 방문 시 라우트 무관).
// - 리다이렉트 가드가 있는 화면(요약)은 페이지의 ready() 호출에만 반응(빈 화면 위 노출 방지).
// - '본 적 있음'은 사용자가 닫는 순간에만 기록(StrictMode 이중 마운트 안전).
type ActiveTutorial = { key: TutorialKey; mode: "auto" | "reopen" };

type TutorialApi = {
  /** 헤더 '?' 재열람 — 본 적 여부와 무관하게 다시 열고, 닫아도 기록을 바꾸지 않는다. */
  open: (key: TutorialKey) => void;
  /** 비-라우트 화면(모달·결과 뷰 등)에서 직접 트리거. 미열람·가드 통과 시에만 노출. */
  maybeShow: (key: TutorialKey) => void;
  /** 라우트 화면이 데이터 준비 완료를 알리는 신호(push). 무장된 후보면 그때 노출. */
  ready: (key: TutorialKey) => void;
  close: () => void;
};

const TutorialCtx = createContext<TutorialApi | null>(null);

export function useTutorial(): TutorialApi {
  const ctx = useContext(TutorialCtx);
  if (!ctx) throw new Error("useTutorial must be used within TutorialProvider");
  return ctx;
}

function pickAutoCandidate(pathname: string, isAuthed: boolean): { key: TutorialKey; waitForReady: boolean } | null {
  // 비로그인 첫 방문자에게는 전역 welcome을 1회 노출(라우트 무관, 기존 OnboardingGate 대체).
  if (!isAuthed && !hasSeenTutorial("welcome", TUTORIALS.welcome.version)) {
    return { key: "welcome", waitForReady: false };
  }
  const key = ROUTE_TO_TUTORIAL[pathname];
  if (!key) return null;
  const cfg = TUTORIALS[key];
  if (hasSeenTutorial(key, cfg.version)) return null;
  if (cfg.requiresAuth && !isAuthed) return null;
  return { key, waitForReady: Boolean(cfg.explicitReady) };
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { openLogin } = useAuthGate();
  const { pathname } = useLocation();

  const [active, setActive] = useState<ActiveTutorial | null>(null);
  const activeRef = useRef<ActiveTutorial | null>(null);
  const armedRef = useRef<TutorialKey | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastPathRef = useRef(pathname);

  const setActiveBoth = useCallback((value: ActiveTutorial | null) => {
    activeRef.current = value;
    setActive(value);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    const current = activeRef.current;
    if (current && current.mode === "auto") markTutorialSeen(current.key, TUTORIALS[current.key].version);
    setActiveBoth(null);
  }, [setActiveBoth]);

  const showAuto = useCallback((key: TutorialKey) => {
    armedRef.current = null;
    clearTimer();
    setActiveBoth({ key, mode: "auto" });
  }, [clearTimer, setActiveBoth]);

  const open = useCallback((key: TutorialKey) => {
    clearTimer();
    armedRef.current = null;
    setActiveBoth({ key, mode: "reopen" });
  }, [clearTimer, setActiveBoth]);

  const maybeShow = useCallback((key: TutorialKey) => {
    if (activeRef.current) return;
    const cfg = TUTORIALS[key];
    if (hasSeenTutorial(key, cfg.version)) return;
    if (cfg.requiresAuth && !user) return;
    showAuto(key);
  }, [showAuto, user]);

  const ready = useCallback((key: TutorialKey) => {
    if (armedRef.current !== key || activeRef.current) return;
    if (hasSeenTutorial(key, TUTORIALS[key].version)) {
      armedRef.current = null;
      return;
    }
    showAuto(key);
  }, [showAuto]);

  // 라우트 진입/인증 변화에 따라 자동 후보를 무장한다.
  useEffect(() => {
    if (loading) return;
    const pathChanged = lastPathRef.current !== pathname;
    lastPathRef.current = pathname;

    // 화면 이동 시 떠 있던 시트는 닫는다(화면별 안내이므로 이전 화면 것은 거둔다).
    if (pathChanged && activeRef.current) close();
    if (activeRef.current) return;

    clearTimer();
    const candidate = pickAutoCandidate(pathname, Boolean(user));
    armedRef.current = candidate?.key ?? null;
    if (!candidate || candidate.waitForReady) return;

    // 비강압 노출 — 스켈레톤/로딩 위에 붙지 않게 한 박자 늦춘다(ready 신호가 없는 화면의 폴백).
    const delay = candidate.key === "welcome" ? 350 : 900;
    timerRef.current = window.setTimeout(() => {
      if (armedRef.current === candidate.key && !activeRef.current) showAuto(candidate.key);
    }, delay);
    return clearTimer;
  }, [pathname, user, loading, close, clearTimer, showAuto]);

  const api = useMemo<TutorialApi>(() => ({ open, maybeShow, ready, close }), [open, maybeShow, ready, close]);

  const primaryAction = active?.key === "welcome"
    ? { label: "시작하기", onClick: () => { close(); openLogin("signIn"); } }
    : undefined;

  return (
    <TutorialCtx.Provider value={api}>
      {children}
      {active && createPortal(
        <TutorialSheet
          key={`${active.key}-${active.mode}`}
          config={TUTORIALS[active.key]}
          primaryAction={primaryAction}
          onClose={close}
        />,
        document.body,
      )}
    </TutorialCtx.Provider>
  );
}
