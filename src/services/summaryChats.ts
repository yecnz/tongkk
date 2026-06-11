import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';
import type { AgentMessage, AgentRole } from './agent';

export type SummaryChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type SummaryChatTarget = {
  summaryId?: string | null;
  materialId?: string | null;
};

type SummaryChatMessageRow = {
  id?: string;
  role: AgentRole;
  content: string;
  created_at?: string;
};

type SummaryChatSessionRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

const LEGACY_SUMMARY_SESSION_PREFIX = 'legacy-summary:';
const CHAT_SESSION_SCHEMA_MISSING_KEY = 'tongkk-summary-chat-session-schema-missing';

const isChatSessionSchemaMarkedMissing = () =>
  typeof window !== 'undefined' && window.sessionStorage.getItem(CHAT_SESSION_SCHEMA_MISSING_KEY) === '1';

const markChatSessionSchemaMissing = () => {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(CHAT_SESSION_SCHEMA_MISSING_KEY, '1');
  }
};

const isMissingChatSessionSchemaError = (error: SupabaseLikeError | null) => {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return (
    text.includes('summary_chat_sessions') ||
    text.includes('session_id') ||
    text.includes('could not find') ||
    text.includes('does not exist') ||
    text.includes('schema cache')
  );
};

const legacySummarySessionId = (summaryId: string) => `${LEGACY_SUMMARY_SESSION_PREFIX}${summaryId}`;

const getLegacySummaryId = (sessionId: string) =>
  sessionId.startsWith(LEGACY_SUMMARY_SESSION_PREFIX)
    ? sessionId.slice(LEGACY_SUMMARY_SESSION_PREFIX.length)
    : null;

const toAgentMessage = (row: SummaryChatMessageRow): AgentMessage => ({
  role: row.role,
  content: row.content,
});

const toChatSession = (row: SummaryChatSessionRow): SummaryChatSession => ({
  id: row.id,
  title: row.title,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

export const createSummaryChatTitle = (question: string) => {
  const normalized = question.replace(/\s+/g, ' ').trim();
  if (!normalized) return '새 튜터 대화';
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
};

const requireChatTarget = (target: SummaryChatTarget) => {
  if (!target.summaryId && !target.materialId) {
    throw new Error('AI 튜터 대화 저장 기준이 없습니다.');
  }
};

async function loadLegacySummaryMessages(summaryId: string): Promise<SummaryChatMessageRow[]> {
  const { data, error } = await supabase
    .from('summary_chat_messages')
    .select('role, content, created_at')
    .eq('summary_id', summaryId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(formatSupabaseError(error));
  return data || [];
}

async function createLegacySummarySession(summaryId: string): Promise<SummaryChatSession | null> {
  const messages = await loadLegacySummaryMessages(summaryId);
  if (messages.length === 0) return null;

  const firstUserMessage = messages.find(message => message.role === 'user');
  const firstMessageCreatedAt = messages[0]?.created_at;
  const lastMessageCreatedAt = messages[messages.length - 1]?.created_at;
  const firstCreatedAt = firstMessageCreatedAt ? new Date(firstMessageCreatedAt).getTime() : Date.now();
  const lastCreatedAt = lastMessageCreatedAt ? new Date(lastMessageCreatedAt).getTime() : firstCreatedAt;

  return {
    id: legacySummarySessionId(summaryId),
    title: createSummaryChatTitle(firstUserMessage?.content || '기존 튜터 대화'),
    createdAt: firstCreatedAt,
    updatedAt: lastCreatedAt,
  };
}

async function migrateLegacySummaryMessages(summaryId: string): Promise<void> {
  const user = await requireSupabaseUser();

  const { data: legacyMessages, error: legacyError } = await supabase
    .from('summary_chat_messages')
    .select('id, role, content, created_at')
    .eq('summary_id', summaryId)
    .is('session_id', null)
    .order('created_at', { ascending: true });

  if (legacyError) throw new Error(formatSupabaseError(legacyError));
  if (!legacyMessages || legacyMessages.length === 0) return;

  const firstUserMessage = legacyMessages.find(message => message.role === 'user');
  const title = createSummaryChatTitle(firstUserMessage?.content || '기존 튜터 대화');

  const { data: session, error: sessionError } = await supabase
    .from('summary_chat_sessions')
    .insert({
      summary_id: summaryId,
      user_id: user.id,
      title,
    })
    .select('id')
    .single();

  if (sessionError) throw new Error(formatSupabaseError(sessionError));

  const { error: updateError } = await supabase
    .from('summary_chat_messages')
    .update({ session_id: session.id })
    .eq('summary_id', summaryId)
    .is('session_id', null);

  if (updateError) throw new Error(formatSupabaseError(updateError));
}

export async function loadSummaryChatSessions(target: SummaryChatTarget): Promise<SummaryChatSession[]> {
  await requireSupabaseUser();
  requireChatTarget(target);

  if (isChatSessionSchemaMarkedMissing()) {
    if (!target.summaryId) return [];
    const legacySession = await createLegacySummarySession(target.summaryId);
    return legacySession ? [legacySession] : [];
  }

  try {
    if (target.summaryId) {
      await migrateLegacySummaryMessages(target.summaryId);
    }

    let query = supabase
      .from('summary_chat_sessions')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (target.summaryId) {
      query = query.eq('summary_id', target.summaryId);
    } else {
      query = query.eq('material_id', target.materialId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []).map(toChatSession);
  } catch (error) {
    if (isMissingChatSessionSchemaError(error as SupabaseLikeError | null) && target.summaryId) {
      markChatSessionSchemaMissing();
      const legacySession = await createLegacySummarySession(target.summaryId);
      return legacySession ? [legacySession] : [];
    }
    throw new Error(formatSupabaseError(error as SupabaseLikeError | null));
  }
}

export async function createSummaryChatSession(target: SummaryChatTarget, title: string): Promise<SummaryChatSession> {
  const user = await requireSupabaseUser();
  requireChatTarget(target);

  if (isChatSessionSchemaMarkedMissing() && target.summaryId) {
    const now = Date.now();
    return {
      id: legacySummarySessionId(target.summaryId),
      title: title || '새 튜터 대화',
      createdAt: now,
      updatedAt: now,
    };
  }

  const { data, error } = await supabase
    .from('summary_chat_sessions')
    .insert({
      summary_id: target.summaryId || null,
      material_id: target.materialId || null,
      user_id: user.id,
      title: title || '새 튜터 대화',
    })
    .select('id, title, created_at, updated_at')
    .single();

  if (error) {
    if (isMissingChatSessionSchemaError(error) && target.summaryId) {
      markChatSessionSchemaMissing();
      const now = Date.now();
      return {
        id: legacySummarySessionId(target.summaryId),
        title: title || '새 튜터 대화',
        createdAt: now,
        updatedAt: now,
      };
    }
    throw new Error(formatSupabaseError(error));
  }
  return toChatSession(data);
}

export async function loadSummaryChatMessages(sessionId: string): Promise<AgentMessage[]> {
  await requireSupabaseUser();
  const legacySummaryId = getLegacySummaryId(sessionId);
  if (legacySummaryId) {
    return (await loadLegacySummaryMessages(legacySummaryId)).map(toAgentMessage);
  }

  const { data, error } = await supabase
    .from('summary_chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(formatSupabaseError(error));
  return (data || []).map(toAgentMessage);
}

// 자료에 직접 연결된 튜터 세션 정리(자료 삭제 시). material_id는 FK가 아니라 cascade가 없어
// 여기서 지워야 한다. 메시지는 session_id FK의 on delete cascade로 함께 삭제된다.
// 요약 기반 세션은 summaries 삭제 시 summary_id cascade로 정리되므로 대상이 아니다.
export async function deleteChatSessionsByMaterialId(materialId: string): Promise<void> {
  if (isChatSessionSchemaMarkedMissing()) return;

  const { error } = await supabase
    .from('summary_chat_sessions')
    .delete()
    .eq('material_id', materialId);

  if (error) {
    if (isMissingChatSessionSchemaError(error)) {
      markChatSessionSchemaMissing();
      return;
    }
    throw new Error(formatSupabaseError(error));
  }
}

export async function saveSummaryChatMessage(sessionId: string, target: SummaryChatTarget, message: AgentMessage): Promise<void> {
  const user = await requireSupabaseUser();
  const legacySummaryId = getLegacySummaryId(sessionId);

  if (legacySummaryId) {
    const { error } = await supabase
      .from('summary_chat_messages')
      .insert({
        summary_id: legacySummaryId,
        user_id: user.id,
        role: message.role,
        content: message.content,
      });

    if (error && !isMissingChatSessionSchemaError(error)) throw new Error(formatSupabaseError(error));
    return;
  }

  const { error } = await supabase
    .from('summary_chat_messages')
    .insert({
      session_id: sessionId,
      summary_id: target.summaryId || null,
      user_id: user.id,
      role: message.role,
      content: message.content,
    });

  if (error) {
    if (isMissingChatSessionSchemaError(error) && target.summaryId) {
      markChatSessionSchemaMissing();
      const { error: legacyError } = await supabase
        .from('summary_chat_messages')
        .insert({
          summary_id: target.summaryId,
          user_id: user.id,
          role: message.role,
          content: message.content,
        });

      if (legacyError) throw new Error(formatSupabaseError(legacyError));
      return;
    }
    throw new Error(formatSupabaseError(error));
  }

  const { error: sessionError } = await supabase
    .from('summary_chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (sessionError && !isMissingChatSessionSchemaError(sessionError)) {
    throw new Error(formatSupabaseError(sessionError));
  }
}
