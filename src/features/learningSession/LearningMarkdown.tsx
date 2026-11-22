import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeBoldSpacing, normalizeMathDelimiters } from '../../common';

export default function LearningMarkdown({ text }: { text: string }) {
  return <div className="learning-help"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
    {normalizeBoldSpacing(normalizeMathDelimiters(text))}
  </ReactMarkdown></div>;
}
