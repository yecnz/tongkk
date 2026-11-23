import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { parseAiSuggestions } from "../common";
import { FormattedTutorText } from "../components/AITutorDrawer";
import { AgentThreadExpiredError, sendAgentMessage, type AgentMessage } from "../services/agent";
import { fetchCourses } from "../services/courses";
import { loadSummariesFromServer } from "../services/summaries";
import tutorMascot from "../assets/mini/tutor-mascot.png";

// 메뉴바 팝오버의 튜터 창(이슈 104). 고른 과목의 가장 최근 요약을 자료로 넘겨 대화한다.
// 대화는 저장하지 않는다 — 길게 이어갈 대화는 본 앱의 AI 튜터에서.
export default function MiniTutor() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [courses, setCourses] = useState<string[]>([]);
  const [course, setCourse] = useState("");
  const [context, setContext] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [threadId, setThreadId] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const firstQuestionSent = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let ignore = false;
    fetchCourses()
      .then(records => {
        if (ignore) return;
        setCourses(records.map(r => r.name));
        setCourse(records[0]?.name ?? "");
        if (!records.length) setReady(true);
      })
      .catch(err => {
        console.warn("과목 불러오기 실패", err);
        if (!ignore) setReady(true);
      });
    return () => { ignore = true; };
  }, [user]);

  useEffect(() => {
    if (!course) return;
    let ignore = false;
    loadSummariesFromServer(course, { includeContent: true })
      .then(list => {
        if (ignore) return;
        const latest = list.reduce<(typeof list)[number] | undefined>((a, b) => (!a || b.createdAt > a.createdAt ? b : a), undefined);
        setContext(latest?.content ?? "");
      })
      .catch(err => {
        console.warn("요약 불러오기 실패", err);
        if (!ignore) setContext("");
      })
      .finally(() => { if (!ignore) setReady(true); });
    return () => { ignore = true; };
  }, [course]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  const ask = async (text: string, history: AgentMessage[], currentThread: string) => {
    const userMessage: AgentMessage = { role: "user", content: text };
    const nextMessages = [...history, userMessage];
    setMessages(nextMessages);
    setSending(true);
    setError("");
    try {
      const sendFull = () => sendAgentMessage("", nextMessages, context || undefined);
      const response = currentThread
        ? await sendAgentMessage(currentThread, [userMessage]).catch(err => {
          if (err instanceof AgentThreadExpiredError) return sendFull();
          throw err;
        })
        : await sendFull();
      setThreadId(response.threadId);
      setMessages([...nextMessages, { role: "assistant", content: response.result }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "튜터 응답을 받지 못했어요.");
    } finally {
      setSending(false);
    }
  };

  // /mini에서 넘어온 첫 질문은 과목 자료가 준비된 뒤 한 번만 보낸다.
  useEffect(() => {
    const question = (location.state as { question?: string } | null)?.question?.trim();
    if (!ready || !question || firstQuestionSent.current) return;
    firstQuestionSent.current = true;
    void ask(question, [], "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const changeCourse = (next: string) => {
    // 자료가 바뀌면 이전 대화 맥락이 맞지 않으니 새 대화로 시작한다.
    setCourse(next);
    setMessages([]);
    setThreadId("");
    setError("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || !user) return;
    setInput("");
    void ask(text, messages, threadId);
  };

  let body;
  if (loading) {
    body = <p className="text-[13px] text-muted">불러오는 중...</p>;
  } else if (!user) {
    body = (
      <p className="text-[13px] text-text">
        <Link to="/auth" target="_blank" className="font-bold text-text-strong underline">로그인</Link>하면 튜터에게 물어볼 수 있어요.
      </p>
    );
  } else {
    body = (
      <>
        {messages.length === 0 && !sending && ready && (
          courses.length === 0 ? (
            <div className="flex flex-col gap-1 text-[13px]">
              <p className="font-bold text-text-strong">아직 등록된 강의가 없어요</p>
              <a href="/" target="_blank" className="font-bold text-pink no-underline">Tongkk에서 강의자료 추가하기 →</a>
            </div>
          ) : (
            <p className="text-[13px] text-muted">
              {context ? `${course} 자료를 바탕으로 답해요. 궁금한 걸 물어보세요.` : `${course}에는 아직 요약한 자료가 없어요. 궁금한 걸 물어보세요.`}
            </p>
          )
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex w-full justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[14px] rounded-tr-[4px] bg-pink px-3 py-2 text-[13px] leading-normal text-on-brand">
                {m.content}
              </p>
            </div>
          ) : (() => {
            const { mainContent, suggestions } = parseAiSuggestions(m.content);
            const showSuggestions = i === messages.length - 1 && !sending && suggestions.length > 0;
            return (
              <div key={i} className="flex w-full items-start gap-2">
                <img src={tutorMascot} alt="" className="size-[21px] shrink-0 object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="rounded-[14px] rounded-tl-[4px] border border-border bg-card px-3 py-[10px] text-[13px] leading-normal text-text">
                    <FormattedTutorText content={mainContent} />
                  </div>
                  {showSuggestions && (
                    <div className="flex flex-wrap gap-[6px]">
                      {suggestions.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void ask(s, messages, threadId)}
                          className="cursor-pointer rounded-full border border-pink/20 bg-tint-pink px-[10px] py-[6px] text-left text-[12px]! leading-snug text-pink"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })(),
        )}
        {sending && (
          <div className="flex w-full items-start gap-2">
            <img src={tutorMascot} alt="" className="size-[21px] shrink-0 object-cover" />
            <p className="rounded-[14px] rounded-tl-[4px] border border-border bg-card px-3 py-[10px] text-[13px] text-muted">답변을 쓰는 중…</p>
          </div>
        )}
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div ref={bottomRef} />
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center p-6">
      <div className="flex h-[560px] w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
        <div className="flex items-center gap-[18px] py-[13px] pr-[14px] pl-4">
          <p className="flex-1 text-[13px] font-bold text-text-strong">Tongkk 튜터</p>
          {courses.length > 0 && (
            <select
              value={course}
              onChange={e => changeCourse(e.target.value)}
              disabled={sending}
              aria-label="과목 선택"
              className="h-6 max-w-[140px] cursor-pointer truncate rounded-full border-0 bg-tint-pink! px-[10px] text-[12px]! font-medium text-pink-deep! outline-none"
            >
              {courses.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
        </div>
        <div className="h-px w-full bg-border" />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{body}</div>
        <div className="h-px w-full bg-border" />
        <form onSubmit={submit} className="flex items-center gap-2 px-3 pt-[10px] pb-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="이어서 질문하기…"
            disabled={!user}
            className="min-w-0 flex-1 rounded-[10px] border border-border bg-card px-3 py-2 text-[13px]! text-text-strong outline-none placeholder:text-muted focus:border-pink"
          />
          <button
            type="submit"
            aria-label="보내기"
            disabled={!user || sending || !input.trim()}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-pink text-[15px]! font-bold text-on-brand disabled:cursor-default disabled:opacity-50"
          >
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}
