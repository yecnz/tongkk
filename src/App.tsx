import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import { AuthGateProvider } from "./AuthGateContext";
import { CourseProvider } from "./CourseContext";
import { ToastProvider } from "./ToastContext";
import { OnboardingGate } from "./components/OnboardingModal";
import Dashboard from "./pages/Dashboard";
import Calendar from "./pages/Calendar";
import Summary from "./pages/Summary";
import Quiz from "./pages/Quiz";
import ReviewNotes from "./pages/ReviewNotes";
import Stats from "./pages/Stats";
import MyPage from "./pages/MyPage";
import Auth from "./pages/Auth";
import { loadUserProfile } from "./services/profile";
import { applyTheme } from "./services/theme";
import UpdatePrompt from "./UpdatePrompt";

function AppShell() {
  const { user, loading } = useAuth();

  useEffect(() => {
    // 인증 확인이 끝나기 전에는 테마를 건드리지 않는다 — user가 아직 null이라
    // applyTheme(false)가 실행되면 index.html이 선적용한 다크 테마(캐시)를 매번 덮어쓴다.
    if (loading) return;
    if (!user) {
      applyTheme(false);
      return;
    }

    let ignore = false;
    loadUserProfile()
      .then(profile => {
        if (!ignore) applyTheme(profile.darkMode);
      })
      .catch(() => {
        if (!ignore) applyTheme(false);
      });

    return () => {
      ignore = true;
    };
  }, [user, loading]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--color-muted)" }}>
        불러오는 중...
      </div>
    );
  }

  return (
    <CourseProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/summary" element={<Summary />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/review" element={<ReviewNotes />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </CourseProvider>
  );
}

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <AuthGateProvider>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/*" element={<AppShell />} />
            </Routes>
            <OnboardingGate />
          </AuthGateProvider>
        </BrowserRouter>
      </AuthProvider>
      <UpdatePrompt />
    </ToastProvider>
  );
}

export default App;
