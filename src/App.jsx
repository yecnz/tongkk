import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CourseProvider } from "./CourseContext";
import Dashboard from "./pages/Dashboard";
import Summary from "./pages/Summary";
import Quiz from "./pages/Quiz";
import Community from "./pages/Community";
import MyPage from "./pages/MyPage";

function App() {
  return (
    <CourseProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/quiz" element={<Quiz />} />
          <Route path="/community" element={<Community />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </CourseProvider>
  );
}

export default App;