import Markdown from './LearningMarkdown';

// Keep older, longer feedback intact; reveal it on request instead of cutting sentences.
export default function LearningExplanation({ text, label = '해설 보기' }: { text: string; label?: string }) {
  if (text.trim().length > 160) return <details className="learning-explanation">
    <summary>{label}</summary><Markdown text={text} />
  </details>;
  return <Markdown text={text} />;
}
