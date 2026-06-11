import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import { CourseProvider } from "./CourseContext";
import { ToastProvider } from "./ToastContext";
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

function ProtectedApp() {
  const { user, loading } = useAuth();

  useEffect(() => {
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
  }, [user]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#999" }}>
        불러오는 중...
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

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
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/*" element={<ProtectedApp />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      <UpdatePrompt />
    </ToastProvider>
  );
}

export default App;
