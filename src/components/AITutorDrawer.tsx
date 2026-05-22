import { useEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PINK } from "../common";
import { sendAgentMessage, type AgentMessage } from "../services/agent";
import {
  createSummaryChatSession,
  createSummaryChatTitle,
  loadSummaryChatSessions,
  loadSummaryChatMessages,
  saveSummaryChatMessage,
  type SummaryChatSession,
} from "../services/summaryChats";

type AITutorDrawerProps = {
  contextTitle: string;
  contextMarkdown: string;
  summaryId?: string | null;
  materialId?: string | null;
  threadId?: string;
  suggestedQuestions?: string[];
  initialQuestion?: string;
  disabledReason?: string;
  resetHistory?: boolean;
};

const markdownStyles = {
  paragraph: { margin: "0 0 8px", lineHeight: 1.65, color: "#444" } satisfies CSSProperties,
  list: { margin: "6px 0 10px", paddingLeft: 20, lineHeight: 1.65 } satisfies CSSProperties,
};

const markdownComponents: Components = {
  h1: ({ children }) => <h1 style={{ margin: "0 0 12px", fontSize: 18, lineHeight: 1.35, fontWeight: 850, color: "#222" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: "16px 0 10px", fontSize: 16, lineHeight: 1.4, fontWeight: 850, color: "#222" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: "14px 0 8px", fontSize: 14, lineHeight: 1.4, fontWeight: 800, color: "#222" }}>{children}</h3>,
  p: ({ children }) => <p style={markdownStyles.paragraph}>{children}</p>,
  ul: ({ children }) => <ul style={{ ...markdownStyles.list, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ ...markdownStyles.list, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 5, paddingLeft: 3 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 800, color: "#222" }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: "#555" }}>{children}</em>,
  code: ({ children, className }) => (
    <code className={className} style={{ padding: className ? 0 : "1px 5px", borderRadius: 5, background: className ? "transparent" : "#f3f4f6", color: className ? "inherit" : "#d6336c", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.92em" }}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre style={{ margin: "10px 0", padding: 12, borderRadius: 10, background: "#f6f7f9", border: "1px solid #eceff3", overflowX: "auto", lineHeight: 1.55 }}>
      {children}
    </pre>
  ),
};

const FormattedTutorText = ({ content }: { content: string }) => {
  const cleaned = content.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return null;

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {cleaned}
    </ReactMarkdown>
  );
};

const SUGGESTION_TRIGGER = /원하시면|다음으로는|해드릴게요|알려드릴게요|다음 단계로|중 하나로|바꿔드릴게요|골라주세요|선택해주세요/;

const parseAiSuggestions = (content: string): { mainContent: string; suggestions: string[] } => {
  const lines = content.split("\n");
  let tail = lines.length - 1;
  while (tail >= 0 && !lines[tail].trim()) tail--;

  const bulletItems: string[] = [];
  let bulletStart = tail + 1;
  let i = tail;
  while (i >= 0) {
    const line = lines[i].trim();
    if (!line) {
      i--;
      continue;
    }
    const match = line.match(/^[-•*]\s+(.{4,80})$/);
    if (!match) break;
    bulletItems.unshift(match[1].replace(/\*\*/g, ""));
    bulletStart = i;
    i--;
  }

  if (bulletItems.length === 0) {
    let cutIndex = lines.length;
    let inSection = false;
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j].trim();
      if (!line) continue;
      const quotedMatches = [...line.matchAll(/[“”“”]([^””“”]{4,60})[“”“”]/g)].map(match => match[1]);
      if (quotedMatches.length > 0) {
        bulletItems.unshift(...quotedMatches);
        cutIndex = j;
        inSection = true;
      } else if (SUGGESTION_TRIGGER.test(line)) {
        cutIndex = j;
        inSection = true;
      } else if (inSection) {
        break;
      } else {
        break;
      }
    }
    if (bulletItems.length > 0) {
      return { mainContent: lines.slice(0, cutIndex).join("\n").trim(), suggestions: bulletItems };
    }
    return { mainContent: content, suggestions: [] };
  }

  if (bulletItems.length < 2) return { mainContent: content, suggestions: [] };

  let cutIdx = bulletStart;
  let j = bulletStart - 1;
  while (j >= 0 && bulletStart - j <= 6) {
    const line = lines[j].trim();
    if (!line) {
      j--;
      continue;
    }
    if (SUGGESTION_TRIGGER.test(line)) cutIdx = j;
    j--;
  }

  return {
    mainContent: lines.slice(0, cutIdx).join("\n").trim(),
    suggestions: bulletItems,
  };
};

const formatSessionDate = (timestamp: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));

export const AITutorDrawer = ({
  contextTitle,
  contextMarkdown,
  summaryId,
  materialId,
  threadId = "",
  suggestedQuestions = [],
  initialQuestion,
  disabledReason = "요약 생성 후 AI 튜터를 사용할 수 있습니다",
  resetHistory = false,
}: AITutorDrawerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localThreadId, setLocalThreadId] = useState(threadId);
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<SummaryChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const skipNextScrollRef = useRef(false);
  const initialQuestionRef = useRef("");
  const canUseAgent = Boolean(contextMarkdown.trim());
  const canPersistChat = Boolean(summaryId || materialId);
  const chatTarget = { summaryId, materialId };

  const scrollToBottom = () => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 60);
  };

  useEffect(() => {
    let ignore = false;
    setLocalThreadId(threadId);
    setAgentInput("");
    setAgentError("");
    setActiveSessionId(null);
    setAgentMessages([]);
    setChatSessions([]);

    if (!canPersistChat || resetHistory) {
      setChatLoading(false);
      return () => {
        ignore = true;
      };
    }

    setChatLoading(true);
    loadSummaryChatSessions({ summaryId, materialId })
      .then(sessions => {
        if (ignore) return;
        setChatSessions(sessions);
        const firstSession = sessions[0];
        if (!firstSession) {
          setChatLoading(false);
          return;
        }

        setActiveSessionId(firstSession.id);
        return loadSummaryChatMessages(firstSession.id).then(messages => {
          if (!ignore) setAgentMessages(messages);
        });
      })
      .catch(err => {
        if (!ignore) {
          setAgentMessages([]);
          setAgentError(err instanceof Error ? err.message : "AI 튜터 대화 불러오기 실패");
        }
      })
      .finally(() => {
        if (!ignore) {
          setChatLoading(false);
          requestAnimationFrame(() => scrollToBottom());
        }
      });

    return () => {
      ignore = true;
    };
  }, [summaryId, materialId, threadId, contextMarkdown, resetHistory, canPersistChat]);

  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    const lastMsg = agentMessages[agentMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "user") return;
    const el = chatContainerRef.current;
    if (!el) return;
    const userDivs = el.querySelectorAll<HTMLElement>("[data-msg-role='user']");
    const last = userDivs[userDivs.length - 1];
    if (last) last.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [agentMessages]);

  useEffect(() => {
    const question = initialQuestion?.trim();
    if (!question || initialQuestionRef.current === question || !canUseAgent) return;
    initialQuestionRef.current = question;
    setIsOpen(true);
    setAgentInput(question);
  }, [initialQuestion, canUseAgent]);

  const startNewConversation = () => {
    setActiveSessionId(null);
    setAgentMessages([]);
    setLocalThreadId("");
    setAgentInput("");
    setAgentError("");
    setShowScrollBtn(false);
  };

  const openChatSession = async (sessionId: string) => {
    if (sessionId === activeSessionId || chatLoading || agentLoading) return;

    setActiveSessionId(sessionId);
    setAgentMessages([]);
    setLocalThreadId("");
    setAgentInput("");
    setAgentError("");
    setShowScrollBtn(false);
    setChatLoading(true);

    try {
      const messages = await loadSummaryChatMessages(sessionId);
      setAgentMessages(messages);
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "AI 튜터 대화 불러오기 실패");
    } finally {
      setChatLoading(false);
    }
  };

  const sendAgentQuestion = async (question: string) => {
    const content = question.trim();
    if (!content || !canUseAgent || chatLoading || agentLoading) return;

    setIsOpen(true);
    const userMessage: AgentMessage = { role: "user", content };
    const nextMessages = [...agentMessages, userMessage];
    setAgentMessages(nextMessages);
    setAgentInput("");
    setAgentError("");
    setAgentLoading(true);

    try {
      let persistenceError = "";
      let sessionId = activeSessionId;

      if (!sessionId && canPersistChat) {
        try {
          const createdSession = await createSummaryChatSession(chatTarget, createSummaryChatTitle(content));
          sessionId = createdSession.id;
          setActiveSessionId(createdSession.id);
          setChatSessions(prev => [createdSession, ...prev]);
        } catch (err) {
          persistenceError = err instanceof Error ? err.message : "AI 튜터 대화 세션 생성 실패";
        }
      }

      if (sessionId) {
        try {
          await saveSummaryChatMessage(sessionId, chatTarget, userMessage);
        } catch (err) {
          persistenceError = err instanceof Error ? err.message : "AI 튜터 대화 저장 실패";
        }
      }

      const response = await sendAgentMessage(
        localThreadId,
        localThreadId ? [userMessage] : nextMessages,
        localThreadId ? undefined : contextMarkdown,
      );
      const assistantMessage: AgentMessage = { role: "assistant", content: response.result };
      setLocalThreadId(response.threadId);
      setAgentMessages(prev => [...prev, assistantMessage]);
      if (sessionId) {
        try {
          await saveSummaryChatMessage(sessionId, chatTarget, assistantMessage);
          const updatedAt = Date.now();
          setChatSessions(prev => prev.map(session =>
            session.id === sessionId ? { ...session, updatedAt } : session
          ).sort((a, b) => b.updatedAt - a.updatedAt));
        } catch (err) {
          persistenceError = err instanceof Error ? err.message : "AI 튜터 대화 저장 실패";
        }
      }
      if (persistenceError) setAgentError(`대화 저장 실패: ${persistenceError}`);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Agent 요청 실패");
    } finally {
      setAgentLoading(false);
    }
  };

  const handleSubmit = async () => {
    await sendAgentQuestion(agentInput);
  };

  const toggleButtonStyle: CSSProperties = {
    position: "fixed",
    right: 0,
    top: "50%",
    zIndex: 191,
    transform: "translateY(-50%)",
    minWidth: 44,
    height: 104,
    padding: "10px 8px",
    border: `1px solid ${PINK}33`,
    borderRight: "none",
    borderRadius: "14px 0 0 14px",
    background: canUseAgent ? "#FFF0F6" : "#f2f2f2",
    color: canUseAgent ? PINK : "#999",
    boxShadow: "-6px 0 18px rgba(0,0,0,0.10)",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    opacity: isOpen ? 0 : 1,
    pointerEvents: isOpen ? "none" : "auto",
    writingMode: "vertical-rl",
    letterSpacing: 0,
    transition: "opacity 0.18s ease, background 0.18s ease",
  };

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} aria-label="AI 튜터 열기" title="AI 튜터" style={toggleButtonStyle}>
        AI 튜터
      </button>
      <aside style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "min(420px, 100vw)",
        height: "100vh",
        zIndex: 190,
        border: "1px solid #f0f0f0",
        borderRight: "none",
        borderRadius: "16px 0 0 16px",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        boxShadow: isOpen ? "-18px 0 44px rgba(0,0,0,0.16)" : "none",
        transform: isOpen ? "translateX(0)" : "translateX(104%)",
        transition: "transform 0.22s ease, box-shadow 0.22s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 850, color: "#222" }}>AI 튜터</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canUseAgent && (
              <button
                type="button"
                onClick={startNewConversation}
                style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fafafa", color: "#999", fontSize: 12, cursor: "pointer" }}
              >
                새 대화 시작
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="AI 튜터 닫기"
              style={{ width: 30, height: 30, borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", color: "#999", cursor: "pointer", fontSize: 18, lineHeight: "28px", padding: 0 }}
            >
              ×
            </button>
          </div>
        </div>
        <div style={{ margin: "0 0 14px", padding: "10px 12px", borderRadius: 10, background: "#fafafa", border: "1px solid #eeeeee" }}>
          <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 900, color: "#aaa" }}>기준</div>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: "#555", fontWeight: 800, wordBreak: "break-word" }}>
            {contextTitle}
          </div>
        </div>

        {canPersistChat && chatSessions.length > 0 && (
          <div style={{ marginBottom: 14, border: "1px solid #eeeeee", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setSessionsCollapsed(prev => !prev)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "none",
                background: "#fafafa",
                color: "#666",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 850,
              }}
            >
              <span>대화 목록 {chatSessions.length}</span>
              <span style={{ color: "#aaa", fontSize: 13 }}>{sessionsCollapsed ? "펼치기" : "접기"}</span>
            </button>
            {!sessionsCollapsed && (
              <div style={{ maxHeight: 132, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {chatSessions.map(session => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => void openChatSession(session.id)}
                      disabled={chatLoading || agentLoading}
                      style={{
                        padding: "9px 10px",
                        borderRadius: 9,
                        border: isActive ? `1px solid ${PINK}55` : "1px solid transparent",
                        background: isActive ? "#FFF0F6" : "#fff",
                        color: isActive ? PINK : "#555",
                        textAlign: "left",
                        cursor: chatLoading || agentLoading ? "default" : "pointer",
                        opacity: chatLoading || agentLoading ? 0.65 : 1,
                      }}
                    >
                      <span style={{ display: "block", marginBottom: 3, fontSize: 12, fontWeight: 850, lineHeight: 1.35, wordBreak: "break-word" }}>
                        {session.title}
                      </span>
                      <span style={{ display: "block", fontSize: 10, color: "#aaa", fontWeight: 700 }}>
                        {formatSessionDate(session.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {canUseAgent && suggestedQuestions.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#999" }}>추천 질문</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {suggestedQuestions.map(question => (
                <button
                  key={question}
                  type="button"
                  onClick={() => sendAgentQuestion(question)}
                  disabled={chatLoading || agentLoading}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 999,
                    border: "1px solid #eeeeee",
                    background: "#fafafa",
                    color: "#555",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    cursor: chatLoading || agentLoading ? "default" : "pointer",
                    opacity: chatLoading || agentLoading ? 0.55 : 1,
                    textAlign: "left",
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, position: "relative", marginBottom: 14 }}>
          <div ref={chatContainerRef} onScroll={handleChatScroll} style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {!canUseAgent ? (
              <div style={{ padding: 14, borderRadius: 12, background: "#fafafa", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                {disabledReason}
              </div>
            ) : chatLoading ? (
              <div style={{ padding: 14, borderRadius: 12, background: "#fafafa", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                이전 AI 튜터 대화를 불러오는 중입니다.
              </div>
            ) : agentMessages.length === 0 ? (
              <div style={{ padding: 14, borderRadius: 12, background: "#fafafa", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                예: “이 개념을 쉬운 예시로 설명해줘” 또는 “시험에 나올 만한 포인트를 알려줘”
              </div>
            ) : (
              <>
                {agentMessages.map((msg, i) => {
                  const isLastAssistant = msg.role === "assistant" && i === agentMessages.length - 1 && !agentLoading;
                  const { mainContent, suggestions } = msg.role === "assistant"
                    ? parseAiSuggestions(msg.content)
                    : { mainContent: msg.content, suggestions: [] };
                  return (
                    <div key={`${msg.role}-${i}`} data-msg-role={msg.role} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ padding: "10px 14px", borderRadius: 12, background: msg.role === "user" ? "#E8FAFE" : "#fafafa", color: "#444", fontSize: 13, lineHeight: 1.6 }}>
                        <FormattedTutorText content={mainContent} />
                      </div>
                      {isLastAssistant && suggestions.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#bbb", letterSpacing: "0.04em" }}>바로 이어서</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {suggestions.map(suggestion => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => { skipNextScrollRef.current = true; void sendAgentQuestion(suggestion); }}
                                disabled={agentLoading}
                                style={{ padding: "6px 10px", borderRadius: 999, border: `1px solid ${PINK}33`, background: "#FFF0F6", color: PINK, fontSize: 12, fontWeight: 400, lineHeight: 1.35, cursor: agentLoading ? "default" : "pointer", opacity: agentLoading ? 0.55 : 1, textAlign: "left" }}
                              >
                                {suggestion.replace(/\*\*/g, "")}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {agentLoading && (
                  <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 12, background: "#fafafa", color: "#aaa", fontSize: 13 }}>
                    응답 중...
                  </div>
                )}
              </>
            )}
          </div>
          {showScrollBtn && (
            <button
              type="button"
              onClick={scrollToBottom}
              title="맨 아래로"
              style={{ position: "absolute", bottom: 8, right: 8, width: 32, height: 32, borderRadius: "50%", border: "1px solid #e0e0e0", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", color: "#888", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}
            >
              ↓
            </button>
          )}
        </div>

        {agentError && <div style={{ marginBottom: 10, fontSize: 12, color: "#E53E3E" }}>{agentError}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={agentInput}
            onChange={e => setAgentInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void handleSubmit(); }}
            disabled={!canUseAgent || chatLoading || agentLoading}
            placeholder="요약본에 대해 질문하기"
            style={{ flex: 1, minWidth: 0, padding: "11px 13px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none" }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canUseAgent || chatLoading || !agentInput.trim() || agentLoading}
            style={{ padding: "0 14px", borderRadius: 10, border: "none", background: !canUseAgent || chatLoading || agentLoading ? "#ddd" : PINK, color: "#fff", fontSize: 13, fontWeight: 800, cursor: !canUseAgent || chatLoading || agentLoading ? "default" : "pointer", flexShrink: 0 }}
          >
            {agentLoading ? "응답 중" : "전송"}
          </button>
        </div>
      </aside>
    </>
  );
};
