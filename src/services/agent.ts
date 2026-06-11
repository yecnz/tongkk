import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';

export type AgentRole = 'user' | 'assistant';

export type AgentMessage = {
  role: AgentRole;
  content: string;
  // 사용자가 첨부한 이미지(data:image/...;base64,...). 화면 표시 및 백엔드 전송용.
  images?: string[];
};

export type AgentResponse = {
  result: string;
  threadId: string;
  messages: AgentMessage[];
};

type AgentApiResponse = {
  result: string;
  thread_id?: string;
  threadId?: string;
  messages?: AgentMessage[];
};

export async function sendAgentMessage(
  threadId: string,
  messages: AgentMessage[],
  markdown?: string,
  sourceMarkdown?: string,
  pages?: string,
): Promise<AgentResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130_000);

  try {
    const response = await fetch(`${BACKEND_URL}/agent`, {
      method: 'POST',
      headers: await getJsonRequestHeaders(),
      body: JSON.stringify({ thread_id: threadId || undefined, messages, markdown, source_markdown: sourceMarkdown, pages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json() as AgentApiResponse;
    return {
      result: data.result,
      threadId: data.thread_id || data.threadId || threadId,
      messages: data.messages || [],
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Agent 요청 시간 초과. 다시 시도해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
