const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const PROMPT = `다음 [내용]을 입력받아 아래 작업을 순서대로 수행해.

1) 제목
콘텐츠 제목

2) 키워드
핵심 키워드를 추출

3) 브리프
50자 이내로 브리프 작성

4) 구성
내용 흐름을 분석해서 구성 목차를 간결하게 리스트업

5) 전체 요약
전체글을 요약
  - 중요 내용을 빠짐없이 포함
  - 250자 이내로 정리

6) 용어설명
새로운 용어가 있으면 볼드체로 표기하고 요약문 끝에 용어 설명 추가

전문용어 외에는 한국어로 답변해줘. 입력된 내용에 없는 것은 추가하지 말 것.

[내용]`;

/**
 * Markdown 텍스트를 받아 Gemini로 요약
 */
export async function summarizeWithGemini(markdown) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API 키가 없습니다. .env.local 파일에 VITE_GEMINI_API_KEY를 설정해주세요.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{
      parts: [{
        text: `${PROMPT}\n${markdown}`,
      }],
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  };

  let response;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status === 503) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[Gemini] 503 오류 - ${attempt}/${MAX_RETRIES} 재시도 중...`);
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw new Error('Gemini 서버 과부하 (503). 잠시 후 다시 시도해주세요.');
    }
    break;
  }

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `API 오류 (${response.status})`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
