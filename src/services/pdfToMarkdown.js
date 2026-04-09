const SERVER_URL = 'http://localhost:8000';

/**
 * PDF 파일을 Markdown 문자열로 변환 (전처리 단계)
 * FastAPI 서버의 markitdown 사용
 */
export async function extractMarkdownFromPDF(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${SERVER_URL}/convert`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || `변환 실패 (${response.status})`);
  }

  const data = await response.json();
  return data.markdown;
}
