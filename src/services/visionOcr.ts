import { BACKEND_URL, getAuthRequestHeaders, parseApiError } from './backend';

type VisionOcrApiResponse = {
  text: string;
};

export async function extractTextWithGoogleVision(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 70_000);

  try {
    const response = await fetch(`${BACKEND_URL}/vision/ocr`, {
      method: 'POST',
      headers: await getAuthRequestHeaders(),
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as VisionOcrApiResponse;
    return data.text;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('이미지 OCR 시간 초과. 이미지 크기를 확인하거나 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
