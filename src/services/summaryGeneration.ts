import { findReusableSummary, prepareSummaryIdentity } from './summaries';
import type { SummaryTemplate } from './gpt';

export async function resolveSummaryRequest(course: string, markdown: string, materials: { id: string; name: string }[],
  template: SummaryTemplate, options: { pageRange?: string; focusPrompt?: string } | undefined, force: boolean) {
  const identity = await prepareSummaryIdentity(course, markdown, materials, template, options);
  const existing = force ? null : await findReusableSummary(course, identity.request_key);
  return { identity, existing };
}
