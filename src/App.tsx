import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { CourseProvider } from "./CourseContext";
import Dashboard from "./pages/Dashboard";
import Summary from "./pages/Summary";
import Quiz from "./pages/Quiz";
import Community from "./pages/Community";
import MyPage from "./pages/MyPage";
import Auth from "./pages/Auth";

function ProtectedApp() {
  const { user, loading } = useAuth();

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
        <Route path="/summary" element={<Summary />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/community" element={<Community />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </CourseProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/*" element={<ProtectedApp />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
