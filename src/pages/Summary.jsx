import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { summarizeWithGemini } from "../services/gemini";
import { summarizeWithGPT } from "../services/gpt";
import { extractMarkdownFromPDF } from "../services/pdfToMarkdown";

const FileIcon = ({ type }) => {
  const colors = { pdf: "#E74C3C", ppt: "#E67E22", img: "#27AE60" };
  const labels = { pdf: "PDF", ppt: "PPT", img: "IMG" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 40, height: 28, borderRadius: 6, fontSize: 11, fontWeight: 700,
      color: "#fff", background: colors[type] || "#999"
    }}>{labels[type] || "FILE"}</span>
  );
};

const getFileType = (name) => {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "img";
  return "file";
};

/* ── 모델별 요약 샘플 데이터 ── */
const summaryData = {
  Gemini: {
    title: "Gemini 요약",
    content: "동적 프로그래밍(Dynamic Programming)은 복잡한 문제를 더 간단한 하위 문제의 모음으로 분해하여 각 하위 문제를 한 번만 풀고 그 결과를 저장하는 최적화 기법입니다.\n\n핵심 원리:\n• 최적 부분 구조: 문제의 최적 해가 하위 문제의 최적 해로 구성\n• 중복 부분 문제: 동일한 하위 문제가 반복적으로 등장\n\n구현 방식:\n1. Top-down (메모이제이션): 재귀 + 캐싱\n2. Bottom-up (타뷸레이션): 반복문으로 테이블 채우기\n\n대표 문제: 피보나치, 0/1 배낭, LCS, 편집 거리, 행렬 체인 곱셈",
  },
  GPT: {
    title: "GPT 요약",
    content: "이번 강의에서는 동적 프로그래밍(DP)의 핵심 개념을 다루었습니다. DP는 큰 문제를 작은 하위 문제로 나누어 해결하는 알고리즘 설계 기법입니다. 메모이제이션과 타뷸레이션 두 가지 접근 방식이 있으며, 최적 부분 구조와 중복 부분 문제라는 두 가지 조건이 필요합니다. 피보나치 수열, 배낭 문제, 최장 공통 부분 수열(LCS) 등의 대표적인 예제를 통해 DP의 적용 방법을 학습했습니다.",
  },
  Claude: {
    title: "Claude 요약",
    content: "이번 강의의 핵심은 동적 프로그래밍(DP)입니다.\n\nDP가 적용 가능한 두 가지 조건을 먼저 이해해야 합니다. 첫째, 최적 부분 구조 — 전체 문제의 최적 해답이 부분 문제의 최적 해답으로부터 구성될 수 있어야 합니다. 둘째, 중복 부분 문제 — 같은 부분 문제가 여러 번 반복되어야 합니다.\n\n접근법은 크게 두 가지입니다. 메모이제이션(Top-down)은 재귀적으로 풀되 이미 계산한 값을 저장합니다. 타뷸레이션(Bottom-up)은 작은 문제부터 차례로 테이블을 채워나갑니다.\n\n시험에서 자주 출제되는 문제 유형: 피보나치 수열, 0/1 배낭 문제, LCS, 최단 경로(플로이드-워셜)",
  },
  Gemma4: {
    title: "(예정)Gemma4 요약",
    content: "동적 프로그래밍(DP)은 하위 문제의 결과를 재사용하여 전체 문제를 효율적으로 해결하는 알고리즘 패러다임입니다.\n\n주요 특징:\n• 하위 문제 중복(Overlapping Subproblems)과 최적 부분 구조(Optimal Substructure)를 활용\n• 시간 복잡도를 지수에서 다항식으로 줄이는 것이 핵심\n\n접근 전략:\n→ 메모이제이션: 재귀 호출 결과를 캐시에 저장\n→ 타뷸레이션: 반복적으로 테이블을 하향식으로 채움\n\n주요 응용: 최단 경로, 문자열 편집 거리, 최장 증가 부분 수열(LIS), 행렬 연쇄 곱셈",
  },
};

/* ── 모델 선택 카드 뷰 ── */
const ModelSelectView = ({ tokens, onSelect, onBack }) => {
  const models = [
    { key: "Gemini", name: "Gemini", cost: 0,   desc: "기본\n요약 제공", free: true,  coming: false },
    { key: "GPT",    name: "GPT",    cost: 100,  desc: "열기\n(토큰 -100)", free: false, coming: false },
    { key: "Claude", name: "Claude", cost: 100,  desc: "열기\n(토큰 -100)", free: false, coming: false },
    { key: "Gemma4", name: "(예정)Gemma4", cost: 0, desc: "출시 예정",  free: false, coming: true  },
  ];

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#222" }}>요약 모델 선택</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, color: "#999" }}>보유 토큰</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: PINK }}>{tokens}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {models.map(m => {
          const canAfford = !m.coming && (m.free || tokens >= m.cost);
          return (
            <Card key={m.key} style={{ padding: 0, overflow: "hidden", opacity: m.coming ? 0.45 : canAfford ? 1 : 0.5 }}>
              <div style={{ padding: "28px 20px", textAlign: "center" }}>
                <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: m.coming ? "#aaa" : "#222" }}>{m.name}</h3>
                <div style={{
                  background: "#fafafa", borderRadius: 14, padding: "32px 16px", marginBottom: 0,
                  minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: m.coming ? "#bbb" : "#555", whiteSpace: "pre-line", textAlign: "center", lineHeight: 1.6 }}>
                    {m.desc}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", borderTop: "1px solid #f0f0f0" }}>
                <button onClick={() => canAfford && onSelect(m.key, m.cost)} style={{
                  flex: 1, padding: "14px 0", border: "none", borderRight: "1px solid #f0f0f0",
                  background: "#fff", fontSize: 14, fontWeight: 600,
                  color: canAfford ? PINK : "#ccc", cursor: canAfford ? "pointer" : "default"
                }}>선택</button>
                <button style={{
                  flex: 1, padding: "14px 0", border: "none",
                  background: "#fff", fontSize: 14, fontWeight: 600, color: "#888", cursor: "pointer"
                }}>공유</button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

/* ── 요약 결과 뷰 ── */
const SummaryResultView = ({ modelKey, onBack, realContent, isLoading, error, loadingStep, elapsedTime }) => {
  const data = summaryData[modelKey] || summaryData["GPT"];
  const displayContent = realContent || data.content;

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 모델 선택으로</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{
            padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: modelKey === "GPT" ? "#E8FAFE" : modelKey === "Gemini" ? "#FFF0F6" : "#F0F0FF",
            color: modelKey === "GPT" ? CYAN : modelKey === "Gemini" ? PINK : "#7C3AED"
          }}>{modelKey}</span>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#222" }}>
            {modelKey} 요약
          </h2>
          {isLoading && (
            <span style={{ fontSize: 13, color: "#aaa", marginLeft: 8 }}>AI가 요약 중...</span>
          )}
          {!isLoading && elapsedTime && (
            <span style={{ fontSize: 12, color: "#bbb", marginLeft: 8 }}>⏱ {elapsedTime}초</span>
          )}
        </div>

        {isLoading ? (
          <div style={{
            background: "#fafafa", borderRadius: 12, padding: 48,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16
          }}>
            <div style={{
              width: 36, height: 36,
              border: `3px solid ${PINK}`, borderTop: "3px solid transparent",
              borderRadius: "50%", animation: "spin 0.8s linear infinite"
            }}/>
            <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
            <p style={{ margin: 0, fontSize: 14, color: "#888" }}>
              {loadingStep || "처리 중..."}
            </p>
          </div>
        ) : error ? (
          <div style={{
            background: "#FFF5F5", borderRadius: 12, padding: 24,
            fontSize: 14, color: "#E53E3E", lineHeight: 1.6
          }}>
            <strong>요약 실패:</strong> {error}
          </div>
        ) : (
          <div style={{
            background: "#fafafa", borderRadius: 12, padding: 24,
            fontSize: 14, color: "#444", lineHeight: 1.8, whiteSpace: "pre-wrap"
          }}>
            {displayContent}
          </div>
        )}

        {!isLoading && (
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button style={{
              padding: "10px 24px", borderRadius: 10, border: "none",
              background: CYAN, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer"
            }}>공유하기</button>
            <button style={{
              padding: "10px 24px", borderRadius: 10, border: "1px solid #e0e0e0",
              background: "#fff", color: "#555", fontSize: 14, cursor: "pointer"
            }}>다운로드</button>
          </div>
        )}
      </Card>
    </div>
  );
};

/* ── 퀴즈 생성 뷰 ── */
const QuizCreateView = ({ fileName, onBack }) => {
  const [difficulty, setDifficulty] = useState("보통");
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState(["객관식"]);

  const toggleType = (t) => {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 20, padding: 0
      }}>← 돌아가기</button>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, fontWeight: 700, color: "#222" }}>퀴즈 생성</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* 왼쪽: 요약된 파일 미리보기 */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0f0" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#888" }}>요약된 파일 미리보기</span>
          </div>
          <div style={{
            padding: 24, minHeight: 360, background: "#fafafa",
            fontSize: 13, color: "#555", lineHeight: 1.8
          }}>
            <p style={{ fontWeight: 600, color: "#333", marginTop: 0 }}>{fileName || "업로드된 파일"} - 요약본</p>
            <p>이번 강의에서는 동적 프로그래밍(DP)의 핵심 개념을 다루었습니다. DP는 큰 문제를 작은 하위 문제로 나누어 해결하는 알고리즘 설계 기법입니다.</p>
            <p>메모이제이션과 타뷸레이션 두 가지 접근 방식이 있으며, 최적 부분 구조와 중복 부분 문제라는 두 가지 조건이 필요합니다.</p>
            <p>피보나치 수열, 배낭 문제, 최장 공통 부분 수열(LCS) 등의 대표적인 예제를 통해 DP의 적용 방법을 학습했습니다.</p>
          </div>
        </Card>

        {/* 오른쪽: 퀴즈 설정 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* 난이도 */}
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#222" }}>난이도</h3>
            <div style={{ display: "flex", gap: 10 }}>
              {["낮음", "보통", "높음"].map(d => (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  padding: "10px 24px", borderRadius: 10,
                  border: difficulty === d ? "none" : "1px solid #e0e0e0",
                  background: difficulty === d ? PINK : "#fff",
                  color: difficulty === d ? "#fff" : "#555",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{d}</button>
              ))}
            </div>
          </div>

          {/* 문항수 */}
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#222" }}>문항수</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="number" value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: 80, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
                  fontSize: 14, textAlign: "center", outline: "none"
                }}
              />
              <span style={{ fontSize: 14, color: "#888" }}>개</span>
            </div>
          </div>

          {/* 문제 유형 */}
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#222" }}>문제 유형</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["O/X", "객관식", "단답형", "주관식"].map(t => (
                <button key={t} onClick={() => toggleType(t)} style={{
                  padding: "10px 20px", borderRadius: 10,
                  border: types.includes(t) ? "none" : "1px solid #e0e0e0",
                  background: types.includes(t) ? CYAN : "#fff",
                  color: types.includes(t) ? "#fff" : "#555",
                  fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>{t}</button>
              ))}
            </div>
          </div>

          {/* 생성 버튼 */}
          <button style={{
            padding: "16px 0", borderRadius: 14, border: "none",
            background: PINK, color: "#fff", fontSize: 16, fontWeight: 700,
            cursor: "pointer", marginTop: 8
          }}>퀴즈 생성하기</button>
        </div>
      </div>
    </div>
  );
};

/* ── 메인 컴포넌트 ── */
export default function Summary() {
  const navigate = useNavigate();
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [tokens, setTokens] = useState(500);
  const [selectedCourse, setSelectedCourse] = useState("");
  const fileRef = useRef(null);

  // 뷰 상태: "upload" | "models" | "summaryResult" | "quizCreate"
  const [view, setView] = useState("upload");
  const [selectedModel, setSelectedModel] = useState(null);
  const [summaryText, setSummaryText] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [elapsedTime, setElapsedTime] = useState(null);
  const [extractedMarkdown, setExtractedMarkdown] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");

  const handleRemoveFile = (index) => {
    setFiles(files.filter((_, j) => j !== index));
    setExtractedMarkdown("");
    setExtractError("");
    setSummaryText("");
    setSummaryError("");
  };

  const handleFiles = async (fileList) => {
    const supported = Array.from(fileList).filter((f) => {
      const lowerName = f.name.toLowerCase();
      return (
        f.type === "application/pdf" ||
        f.type.startsWith("image/") ||
        lowerName.endsWith(".ppt") ||
        lowerName.endsWith(".pptx")
      );
    });
    if (supported.length === 0) return;

    const [targetFile] = supported;
    setUploading(true);

    await new Promise(res => setTimeout(res, 1200));

    const lowerName = targetFile.name.toLowerCase();
    const nextFile = {
      name: targetFile.name,
      size: targetFile.size,
      type: getFileType(targetFile.name),
      pages: targetFile.type === "application/pdf" ? Math.floor(Math.random() * 30) + 5 : null,
      slides: lowerName.endsWith(".pptx") || lowerName.endsWith(".ppt") ? Math.floor(Math.random() * 40) + 10 : null,
      rawFile: targetFile,
    };
    setFiles([nextFile]);
    setUploading(false);
    setSearched(true);
    setExtractedMarkdown("");
    setSummaryText("");
    setSummaryError("");
    setExtractError(
      supported.length > 1
        ? "한 번에 파일 1개만 처리합니다. 첫 번째 파일만 반영되었습니다."
        : ""
    );

    // PDF만 서버 변환 후 실제 요약 가능
    if (targetFile.type === "application/pdf") {
      setIsExtracting(true);
      try {
        const markdown = await extractMarkdownFromPDF(targetFile);
        setExtractedMarkdown(markdown);
      } catch (err) {
        setExtractError(err.message);
      } finally {
        setIsExtracting(false);
      }
      return;
    }

    setExtractError((prev) =>
      prev
        ? `${prev} 실제 요약은 현재 PDF만 지원합니다.`
        : "실제 요약은 현재 PDF만 지원합니다."
    );
  };

  const communityResults = [
    { title: "알고리즘 7주차 정리", type: "요약" },
    { title: "DP 문제풀이 퀴즈", type: "퀴즈" },
    { title: "중간고사 예상문제 모음", type: "요약" },
  ];

  const handleModelSelect = async (key, cost) => {
    setSelectedModel(key);
    setSummaryError("");
    setSummaryText("");
    setElapsedTime(null);

    const needsMarkdown = key === "Gemini" || key === "GPT";
    if (needsMarkdown && !extractedMarkdown) {
      setView("summaryResult");
      setSummaryError("실제 요약을 위해서는 PDF 업로드 후 분석 완료가 필요합니다.");
      return;
    }

    if (needsMarkdown) {
      setIsSummarizing(true);
      setView("summaryResult");
      setSummaryError("");
      const startTime = Date.now();
      try {
        // 마크다운은 업로드 시 이미 변환 완료 → 요약만 실행
        setLoadingStep("🤖 AI가 요약 중...");
        const result = key === "Gemini"
          ? await summarizeWithGemini(extractedMarkdown)
          : await summarizeWithGPT(extractedMarkdown);
        setSummaryText(result);
        if (cost > 0) {
          setTokens(prev => Math.max(0, prev - cost));
        }
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(1));
      } catch (err) {
        setSummaryError(err.message);
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(1));
      } finally {
        setIsSummarizing(false);
        setLoadingStep("");
      }
      return;
    }

    setView("summaryResult");
  };

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="자료 요약" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 자료 요약</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#aaa" }}>토큰</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: PINK }}>{tokens}</span>
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        {/* 과목 선택 */}
        {courses.length > 0 && view === "upload" && (
          <div style={{ marginBottom: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#555", marginRight: 12 }}>과목 선택</span>
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
              {courses.map((c, i) => (
                <button key={i} onClick={() => setSelectedCourse(selectedCourse === c ? "" : c)} style={{
                  padding: "7px 16px", borderRadius: 20,
                  border: selectedCourse === c ? "none" : "1px solid #e0e0e0",
                  background: selectedCourse === c ? PINK : "#fafafa",
                  color: selectedCourse === c ? "#fff" : "#555",
                  fontSize: 13, fontWeight: selectedCourse === c ? 600 : 400, cursor: "pointer"
                }}>{c}</button>
              ))}
            </span>
          </div>
        )}

        {/* 모델 선택 뷰 */}
        {view === "models" && (
          <ModelSelectView tokens={tokens} onSelect={handleModelSelect} onBack={() => setView("upload")} />
        )}

        {/* 요약 결과 뷰 */}
        {view === "summaryResult" && selectedModel && (
          <SummaryResultView
            modelKey={selectedModel}
            onBack={() => setView("models")}
            realContent={summaryText}
            isLoading={isSummarizing}
            error={summaryError}
            loadingStep={loadingStep}
            elapsedTime={elapsedTime}
          />
        )}

        {/* 퀴즈 생성 뷰 */}
        {view === "quizCreate" && (
          <QuizCreateView fileName={files[0]?.name} onBack={() => setView("upload")} />
        )}

        {/* 업로드 & 검색결과 뷰 */}
        {view === "upload" && (
          <div style={{ display: "grid", gridTemplateColumns: files.length > 0 && searched ? "380px 1fr" : "1fr", gap: 28 }}>
            <div>
              <Card style={{ padding: 24 }}>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? CYAN : "#ddd"}`,
                    borderRadius: 14, padding: "40px 20px", textAlign: "center",
                    cursor: "pointer", background: dragOver ? "#F0FDFF" : "#fafafa",
                    transition: "all 0.2s", marginBottom: 20
                  }}
                >
                  <input ref={fileRef} type="file" accept=".pdf,.ppt,.pptx,image/*"
                    onChange={e => handleFiles(e.target.files)} style={{ display: "none" }} />
                  <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📄</div>
                  <p style={{ margin: 0, fontSize: 14, color: "#888" }}>PDF, PPT, 이미지 파일 1개를 드래그하거나</p>
                  <button style={{
                    marginTop: 12, padding: "8px 20px", borderRadius: 10, border: "1px solid #ddd",
                    background: "#fff", fontSize: 13, cursor: "pointer", color: "#555"
                  }}>파일 선택</button>
                </div>

                <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
                {uploading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
                    <div style={{
                      width: 18, height: 18, border: `2px solid ${CYAN}`, borderTop: "2px solid transparent",
                      borderRadius: "50%", animation: "spin 0.8s linear infinite"
                    }}/>
                    <span style={{ fontSize: 13, color: CYAN, fontWeight: 500 }}>업로드 중...</span>
                  </div>
                )}
                {isExtracting && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
                    <div style={{
                      width: 18, height: 18, border: `2px solid ${PINK}`, borderTop: "2px solid transparent",
                      borderRadius: "50%", animation: "spin 0.8s linear infinite"
                    }}/>
                    <span style={{ fontSize: 13, color: PINK, fontWeight: 500 }}>📄 PDF 분석 중...</span>
                  </div>
                )}
                {!isExtracting && extractedMarkdown && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <span style={{ fontSize: 13 }}>✅</span>
                    <span style={{ fontSize: 13, color: "#4CAF50", fontWeight: 500 }}>PDF 분석 완료 — 요약 준비됨</span>
                  </div>
                )}
                {extractError && (
                  <div style={{ padding: "8px 0", fontSize: 12, color: "#E53E3E" }}>
                    ⚠️ 분석 실패: {extractError}
                  </div>
                )}

                {files.length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#555" }}>업로드된 파일</h4>
                    {files.map((f, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                        background: "#fafafa", borderRadius: 10, marginBottom: 8
                      }}>
                        <FileIcon type={f.type} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#333" }}>{f.name}</span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>
                          {f.pages ? `${f.pages}p` : f.slides ? `${f.slides}s` : ""}
                        </span>
                        <button onClick={() => handleRemoveFile(i)} style={{
                          background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* 커뮤니티 검색 결과 (제주대만) */}
            {files.length > 0 && searched && (
              <div>
                <Card style={{ padding: 24 }}>
                  <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700, color: "#222", textAlign: "center" }}>
                    커뮤니티 검색 결과
                  </h3>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#222" }}>제주대</h4>
                      {communityResults.map((item, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                          borderBottom: "1px solid #f5f5f5"
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: item.type === "요약" ? PINK : CYAN, flexShrink: 0
                          }}/>
                          <span style={{ flex: 1, fontSize: 14, color: "#444" }}>{item.title}</span>
                          <span style={{
                            fontSize: 11, padding: "2px 10px", borderRadius: 10,
                            background: item.type === "요약" ? "#FFF0F6" : "#E8FAFE",
                            color: item.type === "요약" ? PINK : CYAN, fontWeight: 500
                          }}>{item.type}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ width: 1, background: "#f0f0f0" }}/>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 130 }}>
                      <button onClick={() => setView("models")} style={{
                        padding: "16px 12px", borderRadius: 12, border: "none",
                        background: "#FFF0F6", color: PINK, fontSize: 14, fontWeight: 600,
                        cursor: "pointer", textAlign: "center", lineHeight: 1.4
                      }}>요약<br/>새로 생성</button>
                      <button onClick={() => setView("quizCreate")} style={{
                        padding: "16px 12px", borderRadius: 12, border: "none",
                        background: "#E8FAFE", color: CYAN, fontSize: 14, fontWeight: 600,
                        cursor: "pointer", textAlign: "center", lineHeight: 1.4
                      }}>퀴즈<br/>새로 생성</button>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}