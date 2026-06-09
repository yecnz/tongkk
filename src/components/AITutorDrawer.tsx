import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PINK, CYAN, normalizeBoldSpacing } from "../common";
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
  onInitialQuestionConsumed?: () => void;
  // 마운트 후에도 사용자가 본문을 선택할 때마다 새 질문을 입력창에 채워 넣기 위한 prop.
  // nonce가 바뀔 때마다 같은 텍스트라도 다시 반영된다.
  pendingQuestion?: { text: string; nonce: number };
  disabledReason?: string;
  resetHistory?: boolean;
  layout?: "drawer" | "embedded";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const markdownStyles = {
  paragraph: { margin: "0 0 8px", lineHeight: 1.65, color: "#444" } satisfies CSSProperties,
  list: { margin: "6px 0 10px", paddingLeft: 20, lineHeight: 1.65 } satisfies CSSProperties,
};

// AI 튜터 입력창(textarea) 자동 높이: 줄높이 20px 기준 최대 5줄 + 상하 패딩(11*2) + 테두리(1*2).
const AGENT_INPUT_LINE_HEIGHT = 20;
const AGENT_INPUT_BORDER = 2;
const AGENT_INPUT_MAX_HEIGHT = AGENT_INPUT_LINE_HEIGHT * 5 + 22 + AGENT_INPUT_BORDER;

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
  const cleaned = normalizeBoldSpacing(content.replace(/\r\n/g, "\n").trim());
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
  onInitialQuestionConsumed,
  pendingQuestion,
  disabledReason = "요약 생성 후 AI 튜터를 사용할 수 있습니다",
  resetHistory = false,
  layout = "drawer",
  open,
  onOpenChange,
}: AITutorDrawerProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [localThreadId, setLocalThreadId] = useState(threadId);
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<SummaryChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  // 기존 대화가 있을 때는 추천 질문을 접어두고 토글로 열어보게 한다(기본 접힘).
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(true);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const skipNextScrollRef = useRef(false);
  const initialQuestionRef = useRef("");
  const pendingNonceRef = useRef<number | null>(null);
  const agentInputRef = useRef<HTMLTextAreaElement>(null);
  const canUseAgent = Boolean(contextMarkdown.trim());
  const canPersistChat = Boolean(summaryId || materialId);
  const chatTarget = { summaryId, materialId };
  const isOpen = open ?? internalOpen;
  const isExpanded = expanded && isOpen;
  const setOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [open, onOpenChange]);

  const scrollToBottom = () => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // 입력 길이에 따라 textarea 높이를 1~5줄 범위에서 자동 조절한다.
  useEffect(() => {
    const el = agentInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + AGENT_INPUT_BORDER, AGENT_INPUT_MAX_HEIGHT)}px`;
  }, [agentInput]);

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 60);
  };

  const refreshChatSessions = useCallback(async () => {
    if (!canPersistChat) return;
    const sessions = await loadSummaryChatSessions({ summaryId, materialId });
    setChatSessions(sessions);
  }, [canPersistChat, summaryId, materialId]);

  useEffect(() => {
    let ignore = false;
    setLocalThreadId(threadId);
    setAgentInput("");
    setAgentError("");
    setActiveSessionId(null);
    setAgentMessages([]);
    setChatSessions([]);
    initialQuestionRef.current = "";

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
    setOpen(true);
    setAgentInput(question);
    onInitialQuestionConsumed?.();
  }, [initialQuestion, canUseAgent, setOpen, onInitialQuestionConsumed]);

  // 본문 선택 → "AI 튜터에게 묻기"로 전달된 질문을 입력창에 채운다.
  // initialQuestion과 달리 nonce 기반이라 같은 텍스트를 다시 선택해도 매번 반영된다.
  useEffect(() => {
    if (!pendingQuestion || !canUseAgent) return;
    if (pendingNonceRef.current === pendingQuestion.nonce) return;
    const text = pendingQuestion.text.trim();
    if (!text) return;
    pendingNonceRef.current = pendingQuestion.nonce;
    setOpen(true);
    setAgentInput(text);
    requestAnimationFrame(() => {
      const el = agentInputRef.current;
      if (el) {
        // preventScroll: 입력창에 포커스해도 페이지가 입력창 위치로 스크롤되지 않게 한다.
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [pendingQuestion, canUseAgent, setOpen]);

  useEffect(() => {
    if (!isOpen) setExpanded(false);
  }, [isOpen]);

  const startNewConversation = async () => {
    if (chatLoading || agentLoading) return;
    setActiveSessionId(null);
    setAgentMessages([]);
    setLocalThreadId("");
    setAgentInput("");
    setAgentError("");
    setShowScrollBtn(false);
    setSessionsCollapsed(false);

    if (!canPersistChat) return;
    setChatLoading(true);
    try {
      await refreshChatSessions();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "AI 튜터 대화 목록을 불러오지 못했습니다.");
    } finally {
      setChatLoading(false);
    }
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

    setOpen(true);
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
          setSessionsCollapsed(false);
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
      {layout === "drawer" && (
        <button type="button" onClick={() => setOpen(true)} aria-label="AI 튜터 열기" title="AI 튜터" style={toggleButtonStyle}>
          AI 튜터
        </button>
      )}
      {isExpanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 259,
            background: "rgba(0,0,0,0.32)",
          }}
        />
      )}
      <aside style={{
        position: isExpanded ? "fixed" : layout === "embedded" ? "relative" : "fixed",
        top: isExpanded ? 24 : layout === "embedded" ? "auto" : 0,
        left: isExpanded ? "50%" : undefined,
        right: isExpanded ? "auto" : layout === "embedded" ? "auto" : 0,
        width: isExpanded ? "min(1080px, calc(100vw - 48px))" : layout === "embedded" ? "100%" : "min(420px, 100vw)",
        height: isExpanded ? "calc(100vh - 48px)" : layout === "embedded" ? 1100 : "100vh",
        minHeight: isExpanded ? undefined : layout === "embedded" ? 1100 : undefined,
        zIndex: isExpanded ? 260 : layout === "embedded" ? "auto" : 190,
        border: "1px solid #f0f0f0",
        borderRight: isExpanded || layout === "embedded" ? "1px solid #f0f0f0" : "none",
        borderRadius: isExpanded ? 16 : layout === "embedded" ? 0 : "16px 0 0 16px",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        boxShadow: isExpanded ? "0 24px 80px rgba(0,0,0,0.22)" : layout === "drawer" && isOpen ? "-18px 0 44px rgba(0,0,0,0.16)" : "none",
        transform: isExpanded ? "translateX(-50%)" : layout === "embedded" || isOpen ? "translateX(0)" : "translateX(104%)",
        transition: layout === "embedded" ? "none" : "transform 0.22s ease, box-shadow 0.22s ease, width 0.18s ease, height 0.18s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 850, color: "#222" }}>AI 튜터</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canUseAgent && (
              <button
                type="button"
                onClick={() => void startNewConversation()}
                disabled={chatLoading || agentLoading}
                aria-label="기존 대화를 보존하고 새 대화 시작"
                title="기존 대화를 보존하고 새 대화를 시작합니다"
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "1px solid #e0e0e0",
                  background: "#fafafa",
                  color: chatLoading || agentLoading ? "#bbb" : "#777",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: chatLoading || agentLoading ? "default" : "pointer",
                  opacity: chatLoading || agentLoading ? 0.6 : 1,
                }}
              >
                새 대화 시작
              </button>
            )}
            {canUseAgent && (
              <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                aria-label={isExpanded ? "AI 튜터 작게 보기" : "AI 튜터 확대 보기"}
                title={isExpanded ? "작게 보기" : "확대 보기"}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: `1px solid ${CYAN}55`,
                  background: "#E8FAFE",
                  color: CYAN,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                <i className={isExpanded ? "fa-solid fa-down-left-and-up-right-to-center" : "fa-solid fa-up-right-and-down-left-from-center"} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="AI 튜터 닫기"
              style={{ width: 30, height: 30, borderRadius: 10, border: "1px solid #e0e0e0", background: "#f3f4f6", color: "#999", cursor: "pointer", fontSize: 18, fontWeight: 800, lineHeight: "28px", padding: 0 }}
            >
              ×
            </button>
          </div>
        </div>
        <div style={{ margin: "0 0 14px", padding: "10px 12px", borderRadius: 10, background: "#fafafa", border: "1px solid #eeeeee" }}>
          <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 900, color: "#aaa" }}>근거로 본 자료</div>
          <div style={{ fontSize: 12, lineHeight: 1.45, color: "#555", fontWeight: 800, wordBreak: "break-word" }}>
            {contextTitle}
          </div>
          <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, color: "#999", fontWeight: 700 }}>
            답변은 이 자료 범위 안에서만 설명하도록 요청됩니다.
          </div>
        </div>

        {canPersistChat && (chatSessions.length > 0 || !activeSessionId) && (
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
                {!activeSessionId && (
                  <div style={{
                    padding: "9px 10px",
                    borderRadius: 9,
                    border: `1px solid ${PINK}55`,
                    background: "#FFF0F6",
                    color: PINK,
                    fontSize: 12,
                    fontWeight: 850,
                    lineHeight: 1.35,
                  }}>
                    새 대화 작성 중
                  </div>
                )}
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
            {agentMessages.length > 0 ? (
              <button
                type="button"
                onClick={() => setSuggestionsCollapsed(prev => !prev)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #eeeeee",
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
                <span>추천 질문 {suggestedQuestions.length}</span>
                <span style={{ color: "#aaa", fontSize: 13 }}>{suggestionsCollapsed ? "펼치기" : "접기"}</span>
              </button>
            ) : (
              <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#999" }}>추천 질문</div>
            )}
            {(agentMessages.length === 0 || !suggestionsCollapsed) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: agentMessages.length > 0 ? 8 : 0 }}>
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
            )}
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
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={agentInputRef}
            value={agentInput}
            onChange={e => setAgentInput(e.target.value)}
            onKeyDown={e => {
              // Enter는 전송, Shift+Enter는 줄바꿈. 한글 IME 조합 중 Enter는 전송하지 않는다.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={!canUseAgent || chatLoading || agentLoading}
            placeholder="요약본에 대해 질문하기"
            rows={1}
            style={{ flex: 1, minWidth: 0, padding: "11px 13px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, lineHeight: `${AGENT_INPUT_LINE_HEIGHT}px`, outline: "none", resize: "none", boxSizing: "border-box", maxHeight: AGENT_INPUT_MAX_HEIGHT, overflowY: "auto", fontFamily: "inherit" }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canUseAgent || chatLoading || !agentInput.trim() || agentLoading}
            style={{ padding: "11px 14px", borderRadius: 10, border: "none", background: !canUseAgent || chatLoading || agentLoading ? "#ddd" : PINK, color: "#fff", fontSize: 13, lineHeight: `${AGENT_INPUT_LINE_HEIGHT}px`, fontWeight: 800, cursor: !canUseAgent || chatLoading || agentLoading ? "default" : "pointer", flexShrink: 0 }}
          >
            {agentLoading ? "응답 중" : "전송"}
          </button>
        </div>
      </aside>
    </>
  );
};
