import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import LoginModal from "../components/LoginModal";
import MiniAccount from "../components/MiniAccount";
import MiniSelect from "../components/MiniSelect";
import { parseAiSuggestions } from "../common";
import { FormattedTutorText } from "../components/AITutorDrawer";
import { AgentThreadExpiredError, sendAgentMessage, type AgentMessage } from "../services/agent";
import { fetchCourses } from "../services/courses";
import { loadCourseMaterialsFromServer, type CourseMaterial } from "../services/materials";
import tutorMascot from "../assets/mini/figma-tutor-mascot.png";
import "./Mini.css";

// 메뉴바 팝오버에서 선택한 강의자료를 참고해 대화한다.
// 대화는 저장하지 않는다 — 길게 이어갈 대화는 본 앱의 AI 튜터에서.
export default function MiniTutor() {
  const { user, loading } = useAuth();
  return <MiniTutorScreen key={user?.id ?? null} user={user} loading={loading} />;
}

function MiniTutorScreen({ user, loading }: { user: User | null; loading: boolean }) {
  // 로그인은 /auth로 보내지 않고 팝오버 자리에 작은 로그인 카드로 — 웹 로그인 페이지는 팝오버에 너무 크다.
  const [showLogin, setShowLogin] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [initialSelection] = useState(() => {
    const state = location.state as { accountId: string; question?: string; course?: string; materialId?: string } | null;
    return user && state?.accountId === user.id ? state : null;
  });
  const initialCourse = initialSelection?.course || "";
  const initialMaterialId = initialSelection?.materialId || "";
  const [courses, setCourses] = useState<string[]>([]);
  const [course, setCourse] = useState(initialCourse);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [materialId, setMaterialId] = useState(initialMaterialId);
  const [materialsLoading, setMaterialsLoading] = useState(Boolean(initialCourse));
  const [materialsError, setMaterialsError] = useState("");
  const [expandedList, setExpandedList] = useState<"course" | "material" | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [threadId, setThreadId] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const firstQuestionSent = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && location.state) navigate("/mini/tutor", { replace: true });
  }, [loading, location.state, navigate]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  // Esc로 팝오버 첫 화면(/mini)으로 돌아간다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !showLogin) navigate("/mini"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, showLogin]);

  useEffect(() => {
    if (!user) return;
    let ignore = false;
    fetchCourses()
      .then(records => {
        if (ignore) return;
        setCourses(records.map(r => r.name));
        setReady(true);
      })
      .catch(err => {
        console.warn("과목 불러오기 실패", err);
        if (!ignore) setReady(true);
      });
    return () => { ignore = true; };
  }, [user]);

  useEffect(() => {
    if (!course || !user) return;
    let ignore = false;
    setMaterialsLoading(true);
    setMaterialsError("");
    loadCourseMaterialsFromServer(course, { includeMarkdown: true })
      .then(list => {
        if (ignore) return;
        setMaterials(list);
      })
      .catch(err => {
        console.warn("강의자료 불러오기 실패", err);
        if (!ignore) setMaterialsError("강의자료를 불러오지 못했어요. 과목을 다시 선택해 주세요.");
      })
      .finally(() => { if (!ignore) setMaterialsLoading(false); });
    return () => { ignore = true; };
  }, [course, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  const ask = async (text: string, history: AgentMessage[], currentThread: string) => {
    const request = new AbortController();
    activeRequest.current = request;
    const userMessage: AgentMessage = { role: "user", content: text };
    const nextMessages = [...history, userMessage];
    setMessages(nextMessages);
    setSending(true);
    setError("");
    try {
      const selectedMaterial = materials.find(material => material.id === materialId);
      const source = selectedMaterial?.markdown.trim();
      if (selectedMaterial && !source) throw new Error("선택한 자료의 본문이 없어 질문에 반영할 수 없어요.");
      const sendFull = () => sendAgentMessage("", nextMessages, source ? `# ${selectedMaterial!.name}\n\n${source}` : undefined, undefined, undefined, request.signal);
      const response = currentThread
        ? await sendAgentMessage(currentThread, [userMessage], undefined, undefined, undefined, request.signal).catch(err => {
          if (!request.signal.aborted && err instanceof AgentThreadExpiredError) return sendFull();
          throw err;
        })
        : await sendFull();
      if (request.signal.aborted) return;
      setThreadId(response.threadId);
      setMessages([...nextMessages, { role: "assistant", content: response.result }]);
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : "튜터 응답을 받지 못했어요.");
    } finally {
      if (!request.signal.aborted) setSending(false);
    }
  };

  // /mini에서 넘어온 첫 질문은 과목 자료가 준비된 뒤 한 번만 보낸다.
  useEffect(() => {
    const question = initialSelection?.question?.trim();
    if (!ready || !question || firstQuestionSent.current || (initialMaterialId && materialsLoading)) return;
    firstQuestionSent.current = true;
    if (initialMaterialId && (materialsError || !materials.some(material => material.id === initialMaterialId))) {
      setInput(question);
      setError("선택한 자료를 불러오지 못했어요. 자료를 다시 선택해 주세요.");
      return;
    }
    void ask(question, [], "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, materialsLoading, materials, materialsError, initialMaterialId]);

  const changeCourse = (next: string) => {
    if (next === course) return;
    // 자료가 바뀌면 이전 대화 맥락이 맞지 않으니 새 대화로 시작한다.
    setCourse(next);
    setMaterials([]);
    setMaterialId("");
    setMaterialsLoading(Boolean(next));
    setMaterialsError("");
    setMessages([]);
    setThreadId("");
    setError("");
  };

  const changeMaterial = (next: string) => {
    if (next === materialId) return;
    setMaterialId(next);
    setMessages([]);
    setThreadId("");
    setError("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || !user || materialsLoading) return;
    setInput("");
    void ask(text, messages, threadId);
  };

  let body;
  if (loading) {
    body = <p className="text-[13px] text-muted">불러오는 중...</p>;
  } else if (!user) {
    body = (
      <p className="text-[13px] text-text">
        <button type="button" onClick={() => setShowLogin(true)} className="cursor-pointer border-0 bg-transparent p-0 font-bold text-text-strong underline">로그인</button>하면 튜터에게 물어볼 수 있어요.
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
              {materialId ? `선택한 자료를 바탕으로 답해요. 궁금한 걸 물어보세요.` : "자료를 선택하거나 일반 질문을 해보세요."}
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
            // 추천 질문만 있는 응답도 다음 메시지를 보내면 원래 답변을 볼 수 있어야 한다.
            const visibleContent = mainContent.trim() || (!showSuggestions ? m.content.trim() : "");
            return (
              <div key={i} className="flex w-full items-start gap-2">
                <img src={tutorMascot} alt="" className="size-[21px] shrink-0 object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {(visibleContent || !suggestions.length) && (
                    <div className="mini-tutor-reply rounded-[14px] rounded-tl-[4px] border px-3 py-[10px] text-[13px] leading-normal">
                      {visibleContent ? <FormattedTutorText content={visibleContent} compact /> : "답변을 받지 못했어요. 다시 질문해 주세요."}
                    </div>
                  )}
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
    <>
      <div className="mini-stage" hidden={showLogin}>
        <div className="mini-tutor">
          <div className="mini-tutor-titlebar">
            <button type="button" onClick={() => navigate("/mini")} aria-label="뒤로" title="뒤로 (Esc)"
              className="mini-window-back">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <p>Tongkk 튜터</p>
            {user && courses.length > 0 && (
              <details className="mini-tutor-source" onKeyDown={event => {
                if (event.key === "Escape" && event.currentTarget.open) {
                  event.stopPropagation();
                  event.currentTarget.open = false;
                  setExpandedList(null);
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}>
                <summary className="mini-tutor-course" aria-label="과목 및 강의자료 선택"><span>{course || "과목 선택"}</span><span aria-hidden="true">⌄</span></summary>
                <div className="mini-tutor-materials">
                  <MiniSelect
                    label="과목"
                    placeholder="과목 선택"
                    value={course}
                    options={courses.map(name => ({ value: name, label: name }))}
                    disabled={sending}
                    expanded={expandedList === "course"}
                    onToggle={() => setExpandedList(expandedList === "course" ? null : "course")}
                    onChange={next => { changeCourse(next); setExpandedList(null); }}
                  />
                  <MiniSelect
                    label="강의자료"
                    placeholder={materialsLoading ? "자료 불러오는 중…" : !course ? "먼저 과목을 선택하세요" : "강의자료 선택"}
                    value={materialId}
                    options={materials.map(material => ({ value: material.id, label: material.name }))}
                    disabled={!course || materialsLoading || sending}
                    expanded={expandedList === "material"}
                    onToggle={() => setExpandedList(expandedList === "material" ? null : "material")}
                    onChange={next => { changeMaterial(next); setExpandedList(null); }}
                  />
                  {course && !materialsLoading && !materialsError && materials.length === 0 && <p className="text-[11px] text-muted">이 과목에 업로드된 자료가 없어요.</p>}
                  {materialsError && <p role="alert" className="text-[11px] text-danger">{materialsError}</p>}
                  {messages.length > 0 && <p className="text-[11px] text-muted">과목이나 자료를 바꾸면 새 대화가 시작돼요.</p>}
                </div>
              </details>
            )}
            {user && <MiniAccount user={user} onSwitchAccount={() => setShowLogin(true)} />}
          </div>
          <div className="mini-tutor-messages">{body}</div>
          <form onSubmit={submit} className="mini-tutor-compose">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="이어서 질문하기…"
              disabled={!user || materialsLoading}
              aria-label="이어서 질문하기"
              className="mini-tutor-input"
            />
            <button
              type="submit"
              aria-label="보내기"
              disabled={!user || materialsLoading || sending || !input.trim()}
              className="mini-tutor-send"
            >
              ↑
            </button>
          </form>
        </div>
      </div>
      {showLogin && <LoginModal compact
        subtitle={user ? "다른 계정으로 학습을 이어가세요." : undefined}
        onClose={() => setShowLogin(false)}
        onAuthenticated={user ? () => {
          setShowLogin(false);
          navigate("/mini", { replace: true });
        } : undefined} />}
    </>
  );
}
