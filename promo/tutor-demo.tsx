// Embedded adaptation of src/components/AITutorDrawer.tsx.
// The renderer is extracted directly from the app at build time, without services.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedTutorText } from 'promo:tutor-markdown';
import { findTutorSample, initialTutorQuestions, unsupportedTutorAnswer } from './tutor-samples';
import './tutor-demo.css';

type Message = { role: 'user' | 'assistant'; content: string; followups?: string[]; preparedTopic?: string };

export default function TutorDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastQuestionRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  const sendQuestion = useCallback((rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) return;
    const sample = findTutorSample(question);
    setMessages(previous => [...previous, { role: 'user', content: question }, {
      role: 'assistant',
      content: sample?.answer ?? unsupportedTutorAnswer,
      followups: sample?.followups ?? initialTutorQuestions,
      preparedTopic: sample?.question,
    }]);
    setInput('');
    setCollapsed(true);
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const question = (event as CustomEvent<{ question?: unknown }>).detail?.question;
      if (typeof question === 'string') sendQuestion(question);
    };
    window.addEventListener('promo:tutor-question', listener);
    return () => window.removeEventListener('promo:tutor-question', listener);
  }, [sendQuestion]);

  useEffect(() => {
    const chat = chatRef.current;
    // Read the new question and the start of the answer without moving the page.
    if (chat) chat.scrollTop = lastQuestionRef.current?.offsetTop ?? 0;
    window.dispatchEvent(new CustomEvent('promo:layout'));
  }, [messages.length, collapsed]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(Math.max(field.scrollHeight, 44), 124)}px`;
  }, [input]);

  function restart() {
    setMessages([]);
    setInput('');
    setCollapsed(true);
    inputRef.current?.focus({ preventScroll: true });
  }

  return <section className="demo-tutor" aria-label="AI 튜터 예시 체험">
    <div className="demo-tutor-header">
      <h3>AI 튜터</h3>
      <button type="button" className="demo-tutor-restart" onClick={restart}>새 대화 시작</button>
    </div>
    <p className="demo-tutor-notice">시간 복잡도·정렬에 대해 준비된 예시 대화입니다. 새 AI 답변은 생성하지 않아요.</p>

    <div className="demo-tutor-suggestions">
      {messages.length > 0 ? <button type="button" className="demo-tutor-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        <span>추천 질문 {initialTutorQuestions.length}</span><span>{collapsed ? '펼치기' : '접기'}</span>
      </button> : <div className="demo-tutor-label">추천 질문</div>}
      {(messages.length === 0 || !collapsed) && <div className="demo-tutor-question-list">
        {initialTutorQuestions.map(question => <button type="button" key={question} className="demo-tutor-question" onClick={() => sendQuestion(question)}>{question}</button>)}
      </div>}
    </div>

    <div className="demo-tutor-chat" ref={chatRef} role="log" aria-label="튜터 예시 대화" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {messages.length === 0 ? <div className="demo-tutor-empty">예: “선택 정렬은 왜 O(n²)인가요?”<br />요약에서 읽은 개념을 예시와 이유로 확인해보세요.</div>
        : messages.map((message, index) => <div key={index} className={`demo-tutor-message is-${message.role}`} data-msg-role={message.role}
          ref={index === messages.length - 2 ? lastQuestionRef : undefined}>
          <div className="demo-tutor-bubble">
            {message.role === 'assistant' && message.preparedTopic && <span className="demo-tutor-prepared">관련 예시 답변 · {message.preparedTopic}</span>}
            {message.role === 'user' ? <p className="demo-tutor-user-text">{message.content}</p> : <FormattedTutorText content={message.content} />}
          </div>
          {message.role === 'assistant' && index === messages.length - 1 && <div className="demo-tutor-followups">
            <span>바로 이어서</span>
            <div className="demo-tutor-question-list">
              {message.followups?.map(question => <button type="button" key={question} className="demo-tutor-followup" onClick={() => sendQuestion(question)}>{question}</button>)}
              <button type="button" className="demo-tutor-followup" data-tutor-return-quiz onClick={() => {
                window.dispatchEvent(new CustomEvent('promo:step', { detail: { index: 2 } }));
                window.dispatchEvent(new CustomEvent('promo:quiz-retry'));
              }}>다시 풀어 확인하기</button>
            </div>
          </div>}
        </div>)}
    </div>

    <form className="demo-tutor-composer" onSubmit={event => { event.preventDefault(); sendQuestion(input); }}>
      <textarea ref={inputRef} value={input} onChange={event => setInput(event.target.value)} rows={1} maxLength={1000}
        aria-label="튜터에게 질문하기" placeholder="요약본에 대해 질문하기"
        onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            sendQuestion(input);
          }
        }} />
      <button type="submit" disabled={!input.trim()}>전송</button>
    </form>
  </section>;
}
