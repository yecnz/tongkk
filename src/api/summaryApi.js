const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function runSummary({ file, course = "" }) {
  const formData = new FormData();
  formData.append("file", file);
  if (course) formData.append("course", course);

  const response = await fetch(`${API_BASE}/api/summary/run`, {
    method: "POST",
    body: formData,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.detail || "요약 생성 중 오류가 발생했습니다.";
    throw new Error(message);
  }

  return data;
}

export async function healthCheck() {
  const response = await fetch(`${API_BASE}/api/health`);
  if (!response.ok) throw new Error("백엔드 서버에 연결할 수 없습니다.");
  return response.json();
}
