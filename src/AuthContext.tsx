import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { invalidateCoursesCache } from "./services/courses";
import { invalidateMaterialsCache } from "./services/materials";
import { invalidateQuizSetsCache } from "./services/quizSets";
import { invalidateSummariesCache } from "./services/summaries";
import { supabase } from "./services/supabase";
import { BACKEND_URL } from "./services/backend";
import { clearLearningDrafts } from "./services/learningSessions";
import { AuthActionError, authErrorMessage, authResponseError, cleanAuthCallbackUrl, readAuthCallback } from "./services/authFlow";
import { sendAuthEmail, startEmailCooldown } from "./services/authEmails";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: (options?: { scope: "local" }) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  verifySignupCode: (email: string, code: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  updateEmail: (newEmail: string) => Promise<void>;
  // 비밀번호 재설정 메일 링크로 진입한 상태(새 비밀번호 입력 단계). true면 자동 로그인 대신 재설정 폼을 띄운다.
  recoveryMode: boolean;
  authCallbackError: string | null;
  endRecovery: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function signOutLocally(): Promise<void> {
  let resolveSignedOut!: () => void;
  const signedOut = new Promise<void>(resolve => { resolveSignedOut = resolve; });
  const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") resolveSignedOut();
  });
  try {
    // 로컬 세션이 지워지면 서버 토큰 폐기를 기다리지 않고 다음 화면을 연다.
    const revocation = supabase.auth.signOut({ scope: "local" }).then(({ error }) => {
      if (error) throw error;
    });
    await Promise.race([signedOut, revocation]);
  } finally {
    subscription.unsubscribe();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // SDK가 URL을 소비하기 전에 읽는다. 복구 링크를 일반 로그인으로 오인하지 않는다.
  const [callback] = useState(() => readAuthCallback(window.location.href));
  const [recoveryMode, setRecoveryMode] = useState(callback.isRecovery);
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(callback.error);
  // 직전 user id. 사용자가 바뀌면(로그아웃 → null 포함) 서비스 메모리 캐시를 전부 비워,
  // stale TTL(30분) 동안 같은 브라우저의 다음 사용자에게 이전 사용자의 과목/자료/요약/퀴즈
  // 목록이 노출되는 것을 막는다. undefined는 '아직 모름'(앱 시작) — 첫 확인은 무효화하지 않는다.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let initializing = true;

    const syncCachesWithUser = (nextSession: Session | null) => {
      const nextUserId = nextSession?.user?.id ?? null;
      if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== nextUserId) {
        if (lastUserIdRef.current) clearLearningDrafts(lastUserIdRef.current);
        invalidateCoursesCache();
        invalidateMaterialsCache();
        invalidateSummariesCache();
        invalidateQuizSetsCache();
      }
      lastUserIdRef.current = nextUserId;
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        setAuthCallbackError(null);
      }
      if (event === "SIGNED_OUT") setRecoveryMode(false);
      syncCachesWithUser(nextSession);
      setSession(nextSession);
      if (!initializing) setLoading(false);
    });

    void (async () => {
      try {
        const { error: callbackError } = await supabase.auth.initialize();
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        syncCachesWithUser(data.session);
        setSession(data.session);
        if (callback.error || callbackError) {
          setAuthCallbackError(callback.error || authErrorMessage(callbackError, '인증 링크를 확인할 수 없습니다. 새 메일을 요청해 주세요.'));
          setRecoveryMode(false);
        } else if (error) {
          setAuthCallbackError(authErrorMessage(error, '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.'));
          setRecoveryMode(false);
        } else if (callback.isRecovery && !data.session) {
          setAuthCallbackError('재설정 세션이 만료되었습니다. 새 메일을 요청해 주세요.');
          setRecoveryMode(false);
        }
        if (callback.hasCallback) window.history.replaceState(window.history.state, '',
          cleanAuthCallbackUrl(window.location.href, Boolean(callback.error || callbackError || callback.isRecovery && !data.session)));
      } catch {
        if (mounted) {
          setAuthCallbackError('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
          setRecoveryMode(false);
        }
      } finally {
        initializing = false;
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [callback]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user || null,
    session,
    loading,
    signIn: async (email, password) => {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw await authResponseError(response);
      const tokens = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string } | null;
      if (!tokens?.access_token || !tokens?.refresh_token) {
        throw new AuthActionError('', 'invalid_auth_response');
      }
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (error) throw error;
      setAuthCallbackError(null);
      setRecoveryMode(false);
    },
    signUp: async (email, password) => {
      const { data, error } = await supabase.auth.signUp({ email, password,
        options: { emailRedirectTo: `${window.location.origin}/auth` } });
      if (error) throw error;
      setAuthCallbackError(null);
      if (!data.session) startEmailCooldown('signup', email);
      return { needsEmailConfirmation: !data.session };
    },
    signOut: async (options) => {
      if (options?.scope === "local") return signOutLocally();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    resetPassword: email => sendAuthEmail('reset', email),
    resendConfirmation: email => sendAuthEmail('signup', email),
    // 가입 확인 메일의 인증번호로 이메일을 확인한다. 성공하면 세션이 생겨 바로 로그인된다.
    verifySignupCode: async (email, code) => {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
      if (error) throw error;
      setAuthCallbackError(null);
    },
    // recovery 링크로 진입한 사용자가 새 비밀번호를 설정한다. (현재 세션은 recovery 토큰으로 인증됨)
    updatePassword: async (newPassword) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    // 이메일(=로그인 ID)만 교체한다. user_id(UUID)는 그대로라 과목/자료/요약/퀴즈가 모두 유지된다.
    updateEmail: async (newEmail) => {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
    },
    recoveryMode,
    authCallbackError,
    endRecovery: () => {
      window.history.replaceState(window.history.state, '', cleanAuthCallbackUrl(window.location.href));
      setRecoveryMode(false); setAuthCallbackError(null);
    },
  }), [loading, session, recoveryMode, authCallbackError]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};
