import { findTutorSample, initialTutorQuestions, unsupportedTutorAnswer } from '../tutor-samples';
export type AgentMessage = { role: 'user' | 'assistant'; content: string; images?: string[] };
export type MateScope = { courseId: string; materialId: string; sourceHash: string };
export class AgentThreadExpiredError extends Error {}
export async function sendAgentMessage(threadId: string, messages: AgentMessage[], _markdown?: string, _sourceMarkdown?: string, _pages?: string, _scope?: MateScope, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('취소됨', 'AbortError');
  const question = messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
  const sample = findTutorSample(question);
  const result = `${sample ? `**준비된 예시 답변 · ${sample.question}**\n\n${sample.answer}` : unsupportedTutorAnswer}\n\n이어서 물어보기\n${(sample?.followups ?? initialTutorQuestions).map(item => `- ${item}`).join('\n')}`;
  return { result, threadId: threadId || 'demo-mini-tutor', messages: [...messages, { role: 'assistant' as const, content: result }] };
}
