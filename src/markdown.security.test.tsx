import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LearningMarkdown from './features/learningSession/LearningMarkdown';
import { FormattedAiText } from './pages/summary/SummaryContent';
import QuizText from './pages/quiz/QuizText';

const renderers = {
  learning: (text: string) => renderToStaticMarkup(h(LearningMarkdown, { text })),
  summary: (text: string) => renderToStaticMarkup(h(FormattedAiText, { content: text })),
  quiz: (text: string) => renderToStaticMarkup(h(QuizText, { children: text })),
};

describe.each(Object.entries(renderers))('%s untrusted markdown', (_name, render) => {
  it('does not create executable HTML from source documents or model output', () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe srcdoc="<script>alert(1)</script>"></iframe>');
    expect(html).not.toMatch(/<(script|iframe|img)\b/i);
  });
  it('removes script and data protocols from markdown links', () => {
    const html = render('[attack](javascript:alert%281%29) [data](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toMatch(/href="(?:javascript:|data:)/i);
  });
  it('does not enable KaTeX trusted HTML or script links', () => {
    const html = render(String.raw`$\href{javascript:alert(1)}{attack}$ $\htmlStyle{background:url(javascript:alert(1))}{attack}$`);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/style="[^"]*javascript:/i);
  });
});
