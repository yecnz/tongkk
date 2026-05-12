import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { AgentMessage, AgentRole } from './agent';

type SummaryChatMessageRow = {
  role: AgentRole;
  content: string;
};

const toAgentMessage = (row: SummaryChatMessageRow): AgentMessage => ({
  role: row.role,
  content: row.content,
});

export async function loadSummaryChatMessages(summaryId: string): Promise<AgentMessage[]> {
  await requireSupabaseUser();

  const { data, error } = await supabase
    .from('summary_chat_messages')
    .select('role, content')
    .eq('summary_id', summaryId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(toAgentMessage);
}

export async function saveSummaryChatMessage(summaryId: string, message: AgentMessage): Promise<void> {
  const user = await requireSupabaseUser();

  const { error } = await supabase
    .from('summary_chat_messages')
    .insert({
      summary_id: summaryId,
      user_id: user.id,
      role: message.role,
      content: message.content,
    });

  if (error) throw new Error(formatSupabaseError(error));
}
