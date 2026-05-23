import { BACKEND_URL, getAuthRequestHeaders, parseApiError } from './backend';

type ConvertApiResponse = {
  markdown: string;
};

/**
 * PDF/PPT/PPTX/이미지 파일을 Markdown 문자열로 변환 (전처리 단계)
 * FastAPI 서버의 markitdown 및 OCR 분기 사용
 */
export async function extractMarkdownFromPDF(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600_000);

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
      throw new Error('파일 변환 시간 초과. 이미지가 많은 PDF라면 잠시 후 다시 시도하거나 페이지 수를 줄여주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
