// The sample text and Markdown/Mindmap renderers come directly from the app.
// build-demo.mjs bundles all runtime code and fonts for offline/file:// use.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from 'promo:markdown';
import QuizText from '../src/pages/quiz/QuizText';
import { MindmapView } from '../src/components/MindmapView';
import TutorDemo from './tutor-demo';
import { sampleOriginalMarkdown, sampleSummaries, sampleMindmap, sampleQuiz } from '../src/sampleDemoContent';
import 'katex/dist/katex.min.css';
import './demo-source.css';

const layoutChanged = () => { window.dispatchEvent(new CustomEvent('promo:layout')); };
const goToStep = (index: number) => window.dispatchEvent(new CustomEvent('promo:step', { detail: { index } }));
const tutorQuestions = [
  '선택 정렬의 시간 복잡도는 왜 O(n²)인가요?',
  '퀵 정렬의 최악 시간 복잡도는 왜 O(n²)인가요?',
  '선택 정렬은 왜 안정 정렬이 아닌가요?',
];
function askTutor(index: number) {
  askTutorQuestion(tutorQuestions[index]);
}
function askTutorQuestion(question: string) {
  goToStep(3);
  window.dispatchEvent(new CustomEvent('promo:tutor-question', { detail: { question } }));
}

function Original() {
  return <div className="demo-scroll" tabIndex={0} role="region" aria-label="원본 강의자료 읽기"><article className="demo-markdown"><Markdown>{sampleOriginalMarkdown}</Markdown></article></div>;
}

function Summary() {
  const [kind, setKind] = useState(sampleSummaries[0].kind);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const summary = sampleSummaries.find(item => item.kind === kind)!;
  useEffect(layoutChanged, [kind]);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % sampleSummaries.length
      : event.key === 'ArrowLeft' ? (index + sampleSummaries.length - 1) % sampleSummaries.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? sampleSummaries.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setKind(sampleSummaries[next].kind);
    refs.current[next]?.focus();
  }
  return <div className="demo-scroll" tabIndex={0} role="region" aria-label="예시 요약 읽기">
    <div className="demo-summary-tabs" role="tablist" aria-label="요약 유형">
      {sampleSummaries.map((item, index) => <button type="button" key={item.kind}
        ref={node => { refs.current[index] = node; }}
        className="demo-summary-tab" id={`demo-summary-tab-${item.kind}`} role="tab"
        aria-selected={kind === item.kind} aria-controls="demo-summary-content"
        tabIndex={kind === item.kind ? 0 : -1} onClick={() => setKind(item.kind)} onKeyDown={event => onKey(event, index)}>{item.label}</button>)}
    </div>
    <div id="demo-summary-content" role="tabpanel" tabIndex={0} aria-labelledby={`demo-summary-tab-${kind}`}>
      {kind === 'MINDMAP'
        ? <div className="demo-actual-mindmap"><MindmapView data={sampleMindmap} initialExpanded onNodeFocus={label => askTutorQuestion(`${label} 개념을 예시로 설명해줘`)} /></div>
        : <article className="demo-markdown"><Markdown>{summary.markdown}</Markdown></article>}
    </div>
  </div>;
}

// The two multiple-choice items and OX item are taken verbatim from the sample.
const questions = [sampleQuiz[0], sampleQuiz[1], sampleQuiz[3]].map(question => ({
  ...question,
  options: question.options || ['O', 'X'],
  answerIndex: question.answerIndex ?? (question.answer === 'O' ? 0 : 1),
}));

function Quiz() {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState(false);
  const [review, setReview] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const firstRender = useRef(true);
  const q = questions[current];
  const selected = answers[current];
  const answered = selected !== undefined;
  const currentCorrect = selected === q.answerIndex;
  const correctCount = questions.filter((question, index) => question.answerIndex === answers[index]).length;
  const score = Math.round(correctCount / questions.length * 100);
  const allAnswered = questions.every((_, index) => answers[index] !== undefined);
  const firstWrongIndex = questions.findIndex((question, index) => answers[index] !== question.answerIndex);

  useEffect(() => {
    layoutChanged();
    if (firstRender.current) { firstRender.current = false; return; }
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [current, result, review]);

  useEffect(() => {
    const openQuestion = (event: Event) => {
      const index = (event as CustomEvent<{ index: number }>).detail?.index;
      if (!Number.isInteger(index) || index < 0 || index >= questions.length) return;
      setCurrent(index); setResult(false); setReview(false);
    };
    const restart = () => { setAnswers({}); setCurrent(0); setResult(false); setReview(false); };
    window.addEventListener('promo:quiz-open', openQuestion);
    window.addEventListener('promo:quiz-retry', restart);
    return () => {
      window.removeEventListener('promo:quiz-open', openQuestion);
      window.removeEventListener('promo:quiz-retry', restart);
    };
  }, []);

  function choose(index: number) {
    if (answered) return;
    setAnswers(previous => previous[current] === undefined ? { ...previous, [current]: index } : previous);
  }
  function retry() { setAnswers({}); setCurrent(0); setResult(false); setReview(false); }
  function go(index: number) { setCurrent(index); setResult(false); }
  function finish() {
    const firstUnanswered = questions.findIndex((_, index) => answers[index] === undefined);
    if (firstUnanswered >= 0) { go(firstUnanswered); return; }
    setResult(true);
    setReview(false);
  }

  return <div className="demo-scroll demo-quiz-scroll" ref={scrollerRef} tabIndex={0} role="region" aria-label="예시 퀴즈 풀기">
    {result ? <div className="demo-quiz-result">
      <div className="demo-quiz-card demo-result-card">
        <div className={`demo-result-score ${score >= 80 ? 'is-high' : score >= 50 ? 'is-middle' : 'is-low'}`}>{score}%</div>
        <h2 tabIndex={-1} ref={headingRef}>{score >= 80 ? '훌륭해요!' : score >= 50 ? '좋은 시작이에요!' : '조금 더 노력해봐요!'}</h2>
        <p>{questions.length}문제 중 {correctCount}문제 정답</p>
        <div className="demo-result-actions">
          <button type="button" onClick={retry}>다시 풀기</button>
          <button type="button" onClick={() => { setReview(true); go(0); }}>풀이 확인</button>
          <button type="button" onClick={() => askTutor(firstWrongIndex < 0 ? 1 : firstWrongIndex)}>AI 튜터로 복습</button>
          <button type="button" className="is-primary" onClick={() => goToStep(1)}>요약 다시 보기</button>
        </div>
      </div>
    </div> : <>
      <div className="demo-quiz-status"><span>샘플 퀴즈</span><span>{current + 1} / {questions.length}</span></div>
      <div className="demo-quiz-progress" role="progressbar" aria-label="퀴즈 진행" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={current + 1}><div style={{ width: `${(current + 1) / questions.length * 100}%` }} /></div>
      <div className="demo-quiz-nav" aria-label="문제 이동">
        {questions.map((_, index) => <button type="button" key={index} onClick={() => go(index)}
          className={answers[index] === undefined ? '' : 'is-answered'} aria-current={index === current ? 'step' : undefined}
          aria-label={`${index + 1}번 문제, ${answers[index] === undefined ? '미응답' : '응답함'}${index === current ? ', 현재 문제' : ''}`}>{index + 1}</button>)}
      </div>
      <div className="demo-quiz-layout">
        <button type="button" className="demo-quiz-direction" aria-label="이전 문제" disabled={current === 0} onClick={() => go(current - 1)}><span>‹</span><span>이전</span></button>
        <div className="demo-quiz-card">
          <div className="demo-quiz-meta"><span>Q{current + 1}</span>{answered && <span className={`demo-answer-badge ${currentCorrect ? 'is-correct' : 'is-wrong'}`} role="status">{currentCorrect ? '정답' : '오답'}</span>}</div>
          <h3 ref={headingRef} tabIndex={-1} id="demo-question"><QuizText>{q.question}</QuizText></h3>
          <div className="demo-quiz-options" role="group" aria-labelledby="demo-question">
            {q.options.map((option, index) => {
              const correct = answered && index === q.answerIndex;
              const wrong = answered && index === selected && index !== q.answerIndex;
              return <button type="button" key={index}
                className={`demo-quiz-option${correct ? ' is-correct' : ''}${wrong ? ' is-wrong' : ''}`}
                aria-pressed={selected === index} aria-disabled={answered} onClick={() => choose(index)}>
                <span className="demo-option-letter">{String.fromCharCode(65 + index)}.</span><QuizText>{option}</QuizText>
                {correct && <span className="demo-option-mark" aria-label="정답">O</span>}{wrong && <span className="demo-option-mark" aria-label="내 답, 오답">X</span>}
              </button>;
            })}
          </div>
          {answered && <div className="demo-quiz-explanation"><strong>해설:</strong> <QuizText>{q.explanation}</QuizText></div>}
          {answered && <button type="button" className="demo-tutor-link" onClick={() => askTutor(current)}>이 문제를 튜터에게 질문하기 <span aria-hidden="true">↗</span></button>}
          <button type="button" className="demo-quiz-next" disabled={!answered}
            onClick={() => review ? setResult(true) : current < questions.length - 1 ? go(current + 1) : finish()}>
            {review ? '결과로 돌아가기' : current < questions.length - 1 ? '다음' : allAnswered ? '결과 보기' : '미응답 문제 풀기'}
          </button>
        </div>
        <button type="button" className="demo-quiz-direction" aria-label="다음 문제" disabled={current === questions.length - 1} onClick={() => go(current + 1)}><span>›</span><span>다음</span></button>
      </div>
    </>}
  </div>;
}

const mounts = [
  ['demo-original', <Original />],
  ['demo-summary', <Summary />],
  ['demo-quiz', <Quiz />],
  ['demo-tutor', <TutorDemo />],
] as const;
for (const [id, component] of mounts) {
  const root = document.getElementById(id);
  if (!root) continue;
  root.classList.add('demo-root');
  createRoot(root).render(component);
}
requestAnimationFrame(layoutChanged);
