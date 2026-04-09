const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const PROMPT = `너는 대학 전공 강의자료를 '시험 대비용'으로 정리하는 조교이다.
목표는 문서의 전체 흐름을 파악하게 하면서도, 시험에 나올 가능성이 높은 세부 항목을 빠뜨리지 않고 정리하는 것이다.

반드시 지켜라.
1. 문서의 대단원/소단원 순서를 유지하라.
2. 원문에 등장하는 열거형 항목(예: n가지 특성, n계층 구조, n가지 구축 방식, n가지 투명성, 종류, 연산, 장단점)은 개수와 항목 이름을 보존하라.
3. 정의, 특징, 구성요소, 종류, 장단점, 비교 항목은 서로 섞지 말고 분리해서 정리하라.
4. 원문에 없는 내용을 추측해서 추가하지 마라.
5. 너무 추상적으로 뭉뚱그리지 말고, 원문에 있는 구체 용어를 유지하라.
6. 한국어 용어 뒤에 영어 용어가 함께 제시된 경우 가능하면 괄호로 함께 적어라.
7. "다양한", "여러 가지" 같은 표현만 쓰고 구체 항목을 생략하지 마라.
8. 시험 직전 복습에 바로 쓸 수 있도록 정리하라.

[출력 형식]
# 전체 흐름
- 문서가 어떤 순서로 전개되는지 4~8개 bullet

# 섹션별 핵심 정리
## 1. [원문 대제목]
- 핵심 정의
- 핵심 설명 3~6개
- 반드시 기억할 세부 항목
- 장점/단점 또는 특징(있으면)
- 비교 대상(있으면)

## 2. [원문 대제목]
- 위와 동일 형식 반복

# 열거형 암기 포인트
- 개수와 항목명을 보존하여 정리

# 비교 포인트
- 비교 대상별 차이점을 표 또는 bullet로 정리
- 비교가 없으면 "없음"

# 시험 직전 체크리스트
- 단답형/서술형으로 나올 수 있는 키워드 10~15개
- 각 키워드는 한 줄 설명 포함

# 한 줄 요약
- 문서 전체를 1~2문장으로 정리`;

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
        text: `${PROMPT}\n\n[강의자료 원문 - Markdown]\n${markdown}`,
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
