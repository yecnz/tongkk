import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { runSummary } from "../api/summaryApi";

const FileIcon = () => (
  <span style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 40, height: 28, borderRadius: 6, fontSize: 11, fontWeight: 700,
    color: "#fff", background: "#E74C3C"
  }}>PDF</span>
);

const SummaryMarkdownView = ({ content }) => (
  <div style={{
    background: "#fafafa",
    borderRadius: 12,
    padding: 24,
    fontSize: 14,
    color: "#444",
    lineHeight: 1.8,
    whiteSpace: "pre-wrap"
  }}>
    {content}
  </div>
);

const ProcessingView = ({ fileName, course }) => (
  <Card style={{ padding: 40, textAlign: "center" }}>
    <div style={{ width: 48, height: 48, border: "3px solid #f0f0f0", borderTop: `3px solid ${PINK}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }} />
    <p style={{ fontSize: 18, fontWeight: 700, color: "#333", margin: "0 0 8px" }}>요약 생성 중입니다...</p>
    <p style={{ fontSize: 14, color: "#999", margin: "0 0 4px" }}>{fileName}</p>
    {course ? <p style={{ fontSize: 13, color: CYAN, margin: 0 }}>{course}</p> : null}
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </Card>
);

const ResultView = ({ result, onReset }) => {
  const stats = useMemo(() => {
    const items = [];
    if (result?.model_provider) items.push(`provider: ${result.model_provider}`);
    if (result?.model_name) items.push(`model: ${result.model_name}`);
    if (typeof result?.num_sections === "number") items.push(`sections: ${result.num_sections}`);
    if (typeof result?.num_chunks === "number") items.push(`chunks: ${result.num_chunks}`);
    if (typeof result?.elapsed_seconds === "number") items.push(`${result.elapsed_seconds}s`);
    return items.join(" · ");
  }, [result]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#222" }}>요약 결과</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#888" }}>{result.filename}{result.course ? ` · ${result.course}` : ""}</p>
          {stats ? <p style={{ margin: "8px 0 0", fontSize: 12, color: "#aaa" }}>{stats}</p> : null}
        </div>
        <button onClick={onReset} style={{
          padding: "10px 18px", borderRadius: 10, border: "1px solid #e0e0e0",
          background: "#fff", color: "#555", fontSize: 14, cursor: "pointer"
        }}>새 요약하기</button>
      </div>

      <Card style={{ padding: 28 }}>
        <SummaryMarkdownView content={result.summary_markdown || "요약 결과가 없습니다."} />
      </Card>
    </div>
  );
};

export default function Summary() {
  const navigate = useNavigate();
  const location = useLocation();
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(location.state?.course || "");
  const [selectedFile, setSelectedFile] = useState(null);
  const [view, setView] = useState("upload"); // upload | processing | result | error
  const [summaryResult, setSummaryResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const fileRef = useRef(null);

  const handleFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    const pdf = arr.find((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
    if (!pdf) {
      setErrorMessage("현재 MVP에서는 PDF 파일만 지원합니다.");
      setView("error");
      return;
    }
    setSelectedFile(pdf);
    setErrorMessage("");
    if (view === "error") setView("upload");
  };

  const handleRunSummary = async () => {
    if (!selectedFile) {
      setErrorMessage("요약할 PDF 파일을 먼저 선택하세요.");
      setView("error");
      return;
    }

    try {
      setView("processing");
      setErrorMessage("");
      const data = await runSummary({ file: selectedFile, course: selectedCourse });
      setSummaryResult(data);
      setView("result");
    } catch (error) {
      setErrorMessage(error.message || "요약 생성에 실패했습니다.");
      setView("error");
    }
  };

  const resetAll = () => {
    setSelectedFile(null);
    setSummaryResult(null);
    setErrorMessage("");
    setView("upload");
  };

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="자료 요약" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 자료 요약</span>
      </div>

      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        {view === "processing" ? (
          <ProcessingView fileName={selectedFile?.name} course={selectedCourse} />
        ) : view === "result" && summaryResult ? (
          <ResultView result={summaryResult} onReset={resetAll} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 800, color: "#222" }}>PDF 요약 프로토타입</h2>
              <p style={{ margin: 0, fontSize: 14, color: "#888" }}>PDF를 업로드하면 서버에서 실제 요약을 생성합니다. 현재 MVP는 PDF 1개 업로드와 전체 요약만 지원합니다.</p>
            </div>

            {courses.length > 0 && (
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#555", marginRight: 12 }}>과목 선택</span>
                <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
                  {courses.map((course, index) => (
                    <button key={index} onClick={() => setSelectedCourse(selectedCourse === course ? "" : course)} style={{
                      padding: "7px 16px", borderRadius: 20,
                      border: selectedCourse === course ? "none" : "1px solid #e0e0e0",
                      background: selectedCourse === course ? PINK : "#fafafa",
                      color: selectedCourse === course ? "#fff" : "#555",
                      fontSize: 13, fontWeight: selectedCourse === course ? 600 : 400, cursor: "pointer"
                    }}>{course}</button>
                  ))}
                </span>
              </div>
            )}

            <Card style={{ padding: 24 }}>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFiles(e.dataTransfer.files);
                }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${CYAN}`,
                  borderRadius: 14,
                  padding: "40px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "#fafafa",
                  marginBottom: 20,
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => handleFiles(e.target.files)}
                  style={{ display: "none" }}
                />
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📄</div>
                <p style={{ margin: 0, fontSize: 14, color: "#888" }}>PDF 파일을 드래그하거나</p>
                <button style={{
                  marginTop: 12,
                  padding: "8px 20px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#555",
                }}>파일 선택</button>
              </div>

              {selectedFile ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fafafa", borderRadius: 10, marginBottom: 16 }}>
                  <FileIcon />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>{selectedFile.name}</div>
                    <div style={{ fontSize: 12, color: "#999" }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 16 }}>✕</button>
                </div>
              ) : (
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "#bbb" }}>선택된 PDF가 없습니다.</p>
              )}

              <button onClick={handleRunSummary} style={{
                width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
                background: PINK, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer"
              }}>요약 생성</button>
            </Card>

            {view === "error" && errorMessage && (
              <Card style={{ padding: 20, border: "1px solid #ffe0e0", background: "#fff8f8" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#d9534f", marginBottom: 8 }}>오류가 발생했습니다</div>
                <div style={{ fontSize: 13, color: "#666" }}>{errorMessage}</div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
