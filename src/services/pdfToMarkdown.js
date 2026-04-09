const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

/**
 * PDF 파일을 Markdown 문자열로 변환 (전처리 단계)
 * FastAPI 서버의 markitdown 사용
 */
export async function extractMarkdownFromPDF(file) {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${BACKEND_URL}/convert`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `변환 실패 (${response.status})`);
    }

    const data = await response.json();
    return data.markdown;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('PDF 변환 시간 초과. 파일 크기를 확인하거나 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
