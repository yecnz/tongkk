import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { invalidateCoursesCache } from "./services/courses";
import { invalidateMaterialsCache } from "./services/materials";
import { invalidateQuizSetsCache } from "./services/quizSets";
import { invalidateSummariesCache } from "./services/summaries";
import { supabase } from "./services/supabase";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateEmail: (newEmail: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // 직전 user id. 사용자가 바뀌면(로그아웃 → null 포함) 서비스 메모리 캐시를 전부 비워,
  // stale TTL(30분) 동안 같은 브라우저의 다음 사용자에게 이전 사용자의 과목/자료/요약/퀴즈
  // 목록이 노출되는 것을 막는다. undefined는 '아직 모름'(앱 시작) — 첫 확인은 무효화하지 않는다.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    const syncCachesWithUser = (nextSession: Session | null) => {
      const nextUserId = nextSession?.user?.id ?? null;
      if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== nextUserId) {
        invalidateCoursesCache();
        invalidateMaterialsCache();
        invalidateSummariesCache();
        invalidateQuizSetsCache();
      }
      lastUserIdRef.current = nextUserId;
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      syncCachesWithUser(data.session);
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      syncCachesWithUser(nextSession);
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user || null,
    session,
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
    },
    // 이메일(=로그인 ID)만 교체한다. user_id(UUID)는 그대로라 과목/자료/요약/퀴즈가 모두 유지된다.
    updateEmail: async (newEmail) => {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
    },
  }), [loading, session]);

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
