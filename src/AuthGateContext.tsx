import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import LoginModal, { type AuthMode } from "./components/LoginModal";

type AuthGateValue = {
  // true면 로그인된 상태(그대로 진행), false면 로그인 모달을 띄웠으니 호출부는 중단.
  requireAuth: (subtitle?: string) => boolean;
  openLogin: (mode?: AuthMode) => void;
};

const AuthGateContext = createContext<AuthGateValue | null>(null);

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [gateState, setGateState] = useState<{ mode: AuthMode; subtitle?: string } | null>(null);

  // 모달 안에서 로그인/가입이 성공하면 onAuthStateChange로 user가 갱신되므로 자동으로 닫는다.
  useEffect(() => {
    if (user) setGateState(null);
  }, [user]);

  const requireAuth = useCallback((subtitle?: string) => {
    if (user) return true;
    setGateState({ mode: "signIn", subtitle });
    return false;
  }, [user]);

  const openLogin = useCallback((mode: AuthMode = "signIn") => {
    setGateState({ mode });
  }, []);

  return (
    <AuthGateContext.Provider value={{ requireAuth, openLogin }}>
      {children}
      {gateState && (
        <LoginModal
          onClose={() => setGateState(null)}
          initialMode={gateState.mode}
          subtitle={gateState.subtitle}
        />
      )}
    </AuthGateContext.Provider>
  );
}

export const useAuthGate = () => {
  const context = useContext(AuthGateContext);
  if (!context) {
    throw new Error("useAuthGate must be used inside AuthGateProvider");
  }
  return context;
};
