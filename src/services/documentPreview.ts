import { BACKEND_URL, getAuthRequestHeaders, parseApiError } from './backend';

export async function createPdfPreviewFromUrl(fileUrl: string, fileName: string): Promise<string> {
  const sourceResponse = await fetch(fileUrl);
  if (!sourceResponse.ok) {
    throw new Error(`원본 파일을 불러오지 못했습니다. (${sourceResponse.status})`);
  }

  const sourceBlob = await sourceResponse.blob();
  const sourceFile = new File([sourceBlob], fileName, {
    type: sourceBlob.type || 'application/octet-stream',
  });
  const formData = new FormData();
  formData.append('file', sourceFile);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 180_000);

  try {
    const response = await fetch(`${BACKEND_URL}/preview/pdf`, {
      method: 'POST',
      headers: await getAuthRequestHeaders(),
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const previewBlob = await response.blob();
    return URL.createObjectURL(previewBlob);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('PPT/PPTX 미리보기 변환 시간이 초과되었습니다.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
