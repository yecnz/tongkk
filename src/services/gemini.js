const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

export async function summarizeWithGemini(file) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API 키가 없습니다. .env.local 파일에 VITE_GEMINI_API_KEY를 설정해주세요.');
  }

  // PDF를 base64로 변환
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );

  const prompt = `다음은 강의 자료입니다. 학생이 시험 대비와 복습에 활용할 수 있도록 핵심 내용을 구조화하여 한국어로 요약해주세요.

출력 형식을 정확히 지켜주세요:

## 전체 흐름
강의 전체 흐름을 2~3문장으로 서술

## 핵심 개념
• 개념/용어: 정의
• (주요 개념을 bullet point로 나열)

## 주요 내용
(섹션별 핵심 내용을 구조적으로 정리)

## 알고 가야 할 포인트
• 포인트 1
• 포인트 2
• 포인트 3
(시험/학습에 중요한 핵심 3~5개)`;

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
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `API 오류 (${response.status})`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
