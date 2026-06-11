import { BACKEND_URL, fetchWithTunnelRetry, getAuthRequestHeaders, parseApiError } from './backend';

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
  // 터널 타임아웃(~100초) 후 재시도 2회가 들어갈 수 있도록 전체 예산 확보
  const timeoutId = window.setTimeout(() => controller.abort(), 300_000);

  try {
    // LibreOffice 변환(최대 120초)이 터널 제한을 넘겨도 서버 캐시에 남으므로 재시도로 회수
    const response = await fetchWithTunnelRetry(`${BACKEND_URL}/preview/pdf`, {
      method: 'POST',
      headers: await getAuthRequestHeaders(),
      body: formData,
      signal: controller.signal,
    }, [3_000, 10_000]);

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const previewBlob = await response.blob();
    return URL.createObjectURL(previewBlob);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('원본 미리보기 변환 시간이 초과되었습니다.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
