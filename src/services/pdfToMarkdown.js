const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * PDF 파일을 Markdown 문자열로 변환 (전처리 단계)
 * Python의 pymupdf4llm.to_markdown() 역할
 */
export async function extractMarkdownFromPDF(file) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API 키가 없습니다.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64,
              },
            },
            {
              text: `이 PDF 문서를 Markdown 형식으로 변환해줘.

규칙:
- 제목/소제목은 #, ##, ### 으로 표현해
- 열거형 항목은 bullet point(-)로 표현해
- 표가 있으면 Markdown 표 형식으로 변환해
- 원문 내용을 빠짐없이 유지하고 요약하지 마
- 원문의 순서와 구조를 그대로 유지해
- 이미지나 그래프는 [그림: 간단한 설명] 형식으로 표시해
- 수식은 최대한 텍스트로 표현해

오직 변환된 Markdown 내용만 출력하고 다른 설명은 붙이지 마.`,
            },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `PDF 변환 실패 (${response.status})`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
}
