import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import LearningMarkdown from './LearningMarkdown';

it('preserves multiplication and Korean range notation in learning content', () => {
  const html = renderToStaticMarkup(<LearningMarkdown text={'5*5*3 + 1 = 76\n\n1~3장과 4~6장'} />);
  expect(html).toContain('5*5*3 + 1 = 76');
  expect(html).not.toContain('<em>');
  expect(html).toContain('1~3장과 4~6장');
  expect(html).not.toContain('<del>');
});

it('renders generated headings, tables and normalized math consistently', () => {
  const html = renderToStaticMarkup(<LearningMarkdown text={'## 핵심\n\n|구분|내용|\n|---|---|\n|원리|설명|\n\n\\(x^2\\)'} />);
  expect(html).toContain('<h2>핵심</h2>');
  expect(html).toContain('<table>');
  expect(html).toContain('class="katex"');
});
