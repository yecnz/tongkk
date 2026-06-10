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
  // 원본 강의자료 본문. 있으면 요약과 함께 보내 사실·근거의 우선 기준이 된다.
  sourceMarkdown?: string;
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
  // embedded일 때 고정 높이(1100) 대신 부모 패널 높이를 100%로 채운다.
  // 이러면 튜터 내부(채팅)만 스크롤되고 요약 영역과 분리된 독립 스크롤이 된다.
  fill?: boolean;
  // embedded일 때 부모(마인드맵 칸 등)의 측정 높이(px)에 맞춘다. 지정되면 fill/고정값보다 우선한다.
  embeddedHeight?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // 확대 상태를 부모가 제어할 수 있게 한다. embedded일 때는 부모가 본문 칸을 숨기고 튜터를 꽉 채운다.
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

const markdownStyles = {
  paragraph: { margin: "0 0 8px", lineHeight: 1.65, color: "var(--color-text)" } satisfies CSSProperties,
  list: { margin: "6px 0 10px", paddingLeft: 20, lineHeight: 1.65 } satisfies CSSProperties,
};

// AI 튜터 입력창(textarea) 자동 높이: 줄높이 20px 기준 최대 5줄 + 상하 패딩(11*2) + 테두리(1*2).
const AGENT_INPUT_LINE_HEIGHT = 20;
const AGENT_INPUT_BORDER = 2;
const AGENT_INPUT_MAX_HEIGHT = AGENT_INPUT_LINE_HEIGHT * 5 + 22 + AGENT_INPUT_BORDER;

const markdownComponents: Components = {
  h1: ({ children }) => <h1 style={{ margin: "0 0 12px", fontSize: 18, lineHeight: 1.35, fontWeight: 850, color: "var(--color-text-strong)" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: "16px 0 10px", fontSize: 16, lineHeight: 1.4, fontWeight: 850, color: "var(--color-text-strong)" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: "14px 0 8px", fontSize: 14, lineHeight: 1.4, fontWeight: 800, color: "var(--color-text-strong)" }}>{children}</h3>,
  p: ({ children }) => <p style={markdownStyles.paragraph}>{children}</p>,
  ul: ({ children }) => <ul style={{ ...markdownStyles.list, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ ...markdownStyles.list, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 5, paddingLeft: 3 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 800, color: "var(--color-text-strong)" }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: "var(--color-text)" }}>{children}</em>,
  code: ({ children, className }) => (
    <code className={className} style={{ padding: className ? 0 : "1px 5px", borderRadius: 5, background: className ? "transparent" : "var(--color-surface)", color: className ? "inherit" : "#d6336c", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.92em" }}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre style={{ margin: "10px 0", padding: 12, borderRadius: 10, background: "var(--color-surface)", border: "1px solid var(--color-border-soft)", overflowX: "auto", lineHeight: 1.55 }}>
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
  contextMarkdown,
  sourceMarkdown,
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
  fill = false,
  embeddedHeight,
  open,
  onOpenChange,
  expanded,
  onExpandedChange,
}: AITutorDrawerProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [localThreadId, setLocalThreadId] = useState(threadId);
  const [agentInput, setAgentInput] = useState("");
  // 핸드오프(퀴즈 오답 복습 등)로 전달된 첫 질문. 대화 기록 로딩이 끝나는 대로 자동 전송한다.
  const [autoSendQuestion, setAutoSendQuestion] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<SummaryChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  // 기존 대화가 있을 때는 추천 질문을 접어두고 토글로 열어보게 한다(기본 접힘).
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(true);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const skipNextScrollRef = useRef(false);
  const initialQuestionRef = useRef("");
  const pendingNonceRef = useRef<number | null>(null);
  const agentInputRef = useRef<HTMLTextAreaElement>(null);
  const canUseAgent = Boolean(contextMarkdown.trim());
  const canPersistChat = Boolean(summaryId || materialId);
  const chatTarget = { summaryId, materialId };
  const isOpen = open ?? internalOpen;
  const isExpanded = (expanded ?? internalExpanded) && isOpen;
  const setOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [open, onOpenChange]);
  // 확대 토글. controlled면 부모에 위임하고, 아니면 내부 상태로 처리한다.
  const setExpanded = useCallback((nextExpanded: boolean) => {
    if (expanded === undefined) setInternalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  }, [expanded, onExpandedChange]);

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
    setAutoSendQuestion("");
    initialQuestionRef.current = "";
    // pendingQuestion 중복 적용 가드도 함께 리셋한다. 리셋하지 않으면 StrictMode가
    // 마운트 시 이펙트를 두 번 실행할 때, 2번째 패스에서 입력 초기화는 다시 일어나지만
    // pendingQuestion 채움은 nonce 가드에 막혀 입력칸이 비는 회귀가 생긴다.
    pendingNonceRef.current = null;

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
    // 입력창에 채워두면 로딩 중에도 질문이 보이고, 로딩이 끝나면 아래 이펙트가 자동 전송한다.
    setAgentInput(question);
    setAutoSendQuestion(question);
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
    // 드래그 질문은 현재 화면(분할/확대) 그대로 두고 입력창만 채운다. 강제로 확대하지 않는다.
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
  }, [isOpen, setExpanded]);

  const startNewConversation = async () => {
    if (chatLoading || agentLoading) return;
    setActiveSessionId(null);
    setAgentMessages([]);
    setLocalThreadId("");
    setAgentInput("");
    setAgentError("");
    setShowScrollBtn(false);
    setSessionMenuOpen(false);

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
          setSessionMenuOpen(false);
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
        localThreadId ? undefined : sourceMarkdown,
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

  // 핸드오프로 전달된 첫 질문은 대화 기록 로딩이 끝나고 튜터를 쓸 수 있게 되면 자동 전송한다.
  useEffect(() => {
    if (!autoSendQuestion || !canUseAgent || chatLoading || agentLoading) return;
    const question = autoSendQuestion;
    setAutoSendQuestion("");
    void sendAgentQuestion(question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendQuestion, canUseAgent, chatLoading, agentLoading]);

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
    border: "1px solid color-mix(in srgb, var(--color-pink) 20%, transparent)",
    borderRight: "none",
    borderRadius: "14px 0 0 14px",
    background: canUseAgent ? "var(--color-tint-pink)" : "var(--color-surface)",
    color: canUseAgent ? PINK : "var(--color-muted)",
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
      {isExpanded && layout === "drawer" && (
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
        position: layout === "embedded" ? "relative" : "fixed",
        top: layout === "embedded" ? "auto" : isExpanded ? 24 : 0,
        left: layout === "embedded" ? undefined : isExpanded ? "50%" : undefined,
        right: layout === "embedded" ? "auto" : isExpanded ? "auto" : 0,
        width: layout === "embedded" ? "100%" : isExpanded ? "min(1080px, calc(100vw - 48px))" : "min(420px, 100vw)",
        height: layout === "embedded" ? (embeddedHeight ?? (fill ? "100%" : 1100)) : isExpanded ? "calc(100vh - 48px)" : "100vh",
        minHeight: layout === "embedded" ? (embeddedHeight ?? (fill ? 0 : 1100)) : undefined,
        zIndex: layout === "embedded" ? "auto" : isExpanded ? 260 : 190,
        border: "1px solid var(--color-border-soft)",
        borderRight: layout === "embedded" ? "1px solid var(--color-border-soft)" : isExpanded ? "1px solid var(--color-border-soft)" : "none",
        borderRadius: layout === "embedded" ? 0 : isExpanded ? 16 : "16px 0 0 16px",
        padding: 20,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-card)",
        boxShadow: layout === "embedded" ? "none" : isExpanded ? "0 24px 80px rgba(0,0,0,0.22)" : isOpen ? "-18px 0 44px rgba(0,0,0,0.16)" : "none",
        transform: layout === "embedded" ? "translateX(0)" : isExpanded ? "translateX(-50%)" : isOpen ? "translateX(0)" : "translateX(104%)",
        transition: layout === "embedded" ? "none" : "transform 0.22s ease, box-shadow 0.22s ease, width 0.18s ease, height 0.18s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 850, color: "var(--color-text-strong)" }}>AI 튜터</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canUseAgent && (
              canPersistChat ? (
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setSessionMenuOpen(prev => !prev)}
                    aria-label="저장된 대화 목록 보기"
                    aria-expanded={sessionMenuOpen}
                    title="저장된 대화 목록"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: sessionMenuOpen ? "1px solid color-mix(in srgb, var(--color-pink) 33%, transparent)" : "1px solid var(--color-border-soft)",
                      background: sessionMenuOpen ? "var(--color-tint-pink)" : "var(--color-surface)",
                      color: sessionMenuOpen ? PINK : "var(--color-text-secondary)",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    대화 목록
                    <i className="fa-solid fa-chevron-down" style={{ fontSize: 9 }} />
                  </button>
                  {sessionMenuOpen && (
                    <>
                      <div onClick={() => setSessionMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 300 }} />
                      <div
                        role="menu"
                        style={{
                          position: "absolute",
                          top: "calc(100% + 6px)",
                          right: 0,
                          zIndex: 301,
                          width: 260,
                          maxHeight: 320,
                          overflowY: "auto",
                          background: "var(--color-card)",
                          borderRadius: 12,
                          border: "1px solid #ececec",
                          boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
                          padding: 6,
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        {chatSessions.length === 0 && (
                          <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--color-muted)", fontWeight: 800, textAlign: "center" }}>
                            저장된 대화가 없습니다
                          </div>
                        )}
                        {chatSessions.map(session => {
                          const isActive = session.id === activeSessionId;
                          return (
                            <button
                              key={session.id}
                              type="button"
                              role="menuitem"
                              onClick={() => { setSessionMenuOpen(false); void openChatSession(session.id); }}
                              disabled={chatLoading || agentLoading}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                width: "100%",
                                padding: "9px 10px",
                                borderRadius: 8,
                                border: "none",
                                background: isActive ? "var(--color-tint-pink)" : "transparent",
                                color: isActive ? PINK : "var(--color-text)",
                                textAlign: "left",
                                cursor: chatLoading || agentLoading ? "default" : "pointer",
                                opacity: chatLoading || agentLoading ? 0.6 : 1,
                              }}
                            >
                              <i className="fa-regular fa-message" style={{ fontSize: 12, color: isActive ? PINK : "var(--color-muted)", flexShrink: 0 }} />
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {session.title}
                                </span>
                                <span style={{ display: "block", fontSize: 10, color: "var(--color-muted)", fontWeight: 700 }}>
                                  {formatSessionDate(session.updatedAt)}
                                </span>
                              </span>
                              {isActive && <i className="fa-solid fa-check" style={{ fontSize: 12, color: PINK, flexShrink: 0 }} />}
                            </button>
                          );
                        })}
                        <div style={{ height: 1, background: "var(--color-border-soft)", margin: "4px 2px" }} />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setSessionMenuOpen(false); void startNewConversation(); }}
                          disabled={chatLoading || agentLoading}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            width: "100%",
                            padding: "9px 10px",
                            borderRadius: 8,
                            border: "none",
                            background: "transparent",
                            color: chatLoading || agentLoading ? "var(--color-muted)" : PINK,
                            fontSize: 12.5,
                            fontWeight: 850,
                            textAlign: "left",
                            cursor: chatLoading || agentLoading ? "default" : "pointer",
                          }}
                        >
                          <i className="fa-solid fa-plus" style={{ fontSize: 12, flexShrink: 0 }} />
                          <span>새 대화 시작</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void startNewConversation()}
                  disabled={chatLoading || agentLoading}
                  aria-label="기존 대화를 보존하고 새 대화 시작"
                  title="기존 대화를 보존하고 새 대화를 시작합니다"
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--color-border-soft)",
                    background: "var(--color-surface)",
                    color: chatLoading || agentLoading ? "var(--color-muted)" : "var(--color-text-secondary)",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: chatLoading || agentLoading ? "default" : "pointer",
                    opacity: chatLoading || agentLoading ? 0.6 : 1,
                  }}
                >
                  새 대화 시작
                </button>
              )
            )}
            {canUseAgent && (
              <button
                type="button"
                onClick={() => setExpanded(!isExpanded)}
                aria-label={isExpanded ? "AI 튜터 작게 보기" : "AI 튜터 확대 보기"}
                title={isExpanded ? "작게 보기" : "확대 보기"}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "1px solid color-mix(in srgb, var(--color-cyan) 33%, transparent)",
                  background: "var(--color-tint-cyan)",
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
              style={{ width: 30, height: 30, borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-surface)", color: "var(--color-muted)", cursor: "pointer", fontSize: 18, fontWeight: 800, lineHeight: "28px", padding: 0 }}
            >
              ×
            </button>
          </div>
        </div>
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
                  border: "1px solid var(--color-border-soft)",
                  background: "var(--color-surface)",
                  color: "var(--color-text-secondary)",
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
                <span style={{ color: "var(--color-muted)", fontSize: 13 }}>{suggestionsCollapsed ? "펼치기" : "접기"}</span>
              </button>
            ) : (
              <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800, color: "var(--color-muted)" }}>추천 질문</div>
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
                    border: "1px solid var(--color-border-soft)",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
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
              <div style={{ padding: 14, borderRadius: 12, background: "var(--color-surface)", color: "var(--color-muted)", fontSize: 13, lineHeight: 1.6 }}>
                {disabledReason}
              </div>
            ) : chatLoading ? (
              <div style={{ padding: 14, borderRadius: 12, background: "var(--color-surface)", color: "var(--color-muted)", fontSize: 13, lineHeight: 1.6 }}>
                이전 AI 튜터 대화를 불러오는 중입니다.
              </div>
            ) : agentMessages.length === 0 ? (
              <div style={{ padding: 14, borderRadius: 12, background: "var(--color-surface)", color: "var(--color-muted)", fontSize: 13, lineHeight: 1.6 }}>
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
                      <div style={{ padding: "10px 14px", borderRadius: 12, background: msg.role === "user" ? "var(--color-tint-cyan)" : "var(--color-surface)", color: "var(--color-text)", fontSize: 13, lineHeight: 1.6 }}>
                        <FormattedTutorText content={mainContent} />
                      </div>
                      {isLastAssistant && suggestions.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--color-muted)", letterSpacing: "0.04em" }}>바로 이어서</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {suggestions.map(suggestion => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => { skipNextScrollRef.current = true; void sendAgentQuestion(suggestion); }}
                                disabled={agentLoading}
                                style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--color-pink) 20%, transparent)", background: "var(--color-tint-pink)", color: PINK, fontSize: 12, fontWeight: 400, lineHeight: 1.35, cursor: agentLoading ? "default" : "pointer", opacity: agentLoading ? 0.55 : 1, textAlign: "left" }}
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
                  <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: 12, background: "var(--color-surface)", color: "var(--color-muted)", fontSize: 13 }}>
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
              style={{ position: "absolute", bottom: 8, right: 8, width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--color-border-soft)", background: "var(--color-card)", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", color: "var(--color-muted)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}
            >
              ↓
            </button>
          )}
        </div>

        {agentError && <div style={{ marginBottom: 10, fontSize: 12, color: "var(--color-danger)" }}>{agentError}</div>}
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
            style={{ flex: 1, minWidth: 0, padding: "11px 13px", borderRadius: 10, border: "1px solid var(--color-border-soft)", fontSize: 13, lineHeight: `${AGENT_INPUT_LINE_HEIGHT}px`, outline: "none", resize: "none", boxSizing: "border-box", maxHeight: AGENT_INPUT_MAX_HEIGHT, overflowY: "auto", fontFamily: "inherit" }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canUseAgent || chatLoading || !agentInput.trim() || agentLoading}
            style={{ padding: "11px 14px", borderRadius: 10, border: "none", background: !canUseAgent || chatLoading || agentLoading ? "var(--color-border-soft)" : PINK, color: "var(--color-on-brand)", fontSize: 13, lineHeight: `${AGENT_INPUT_LINE_HEIGHT}px`, fontWeight: 800, cursor: !canUseAgent || chatLoading || agentLoading ? "default" : "pointer", flexShrink: 0 }}
          >
            {agentLoading ? "응답 중" : "전송"}
          </button>
        </div>
      </aside>
    </>
  );
};
