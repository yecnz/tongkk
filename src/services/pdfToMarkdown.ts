import { BACKEND_URL, getAuthRequestHeaders, parseApiError } from './backend';

type ConvertApiResponse = {
  markdown: string;
};

/**
 * PDF/PPT/PPTX 파일을 Markdown 문자열로 변환 (전처리 단계)
 * FastAPI 서버의 markitdown 사용
 */
export async function extractMarkdownFromPDF(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${BACKEND_URL}/convert`, {
      method: 'POST',
      headers: await getAuthRequestHeaders(),
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as ConvertApiResponse;
    return data.markdown;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('파일 변환 시간 초과 (2분). 파일 크기를 줄이거나 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
