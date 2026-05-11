import { BACKEND_URL, getJsonRequestHeaders, parseApiError } from './backend';

export type AgentRole = 'user' | 'assistant';

export type AgentMessage = {
  role: AgentRole;
  content: string;
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
): Promise<AgentResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130_000);

  try {
    const response = await fetch(`${BACKEND_URL}/agent`, {
      method: 'POST',
      headers: await getJsonRequestHeaders(),
      body: JSON.stringify({ thread_id: threadId, messages }),
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
