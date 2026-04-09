const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

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
 * Markdown 텍스트를 받아 GPT로 요약
 */
export async function summarizeWithGPT(markdown) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API 키가 없습니다. .env.local 파일에 VITE_OPENAI_API_KEY를 설정해주세요.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `${PROMPT}\n${markdown}`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `API 오류 (${response.status})`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
