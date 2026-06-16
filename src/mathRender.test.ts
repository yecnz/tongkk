import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "./common";

// end-to-end: 정규화 결과를 실제 요약 렌더와 동일한 remark-math + rehype-katex 파이프라인에 태워
// LLM이 내보낸 깨진 구분자가 KaTeX로 typeset 되는지 확인한다(문자열 변환만이 아니라 렌더까지).
const renderMarkdown = (md: string): string =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown as unknown as (p: Record<string, unknown>) => null,
      { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] },
      md,
    ),
  );

const render = (raw: string) => renderMarkdown(normalizeMathDelimiters(raw));
const hasKatex = (html: string) => /class="katex/.test(html);
const hasDisplay = (html: string) => /katex-display/.test(html);

describe("수식 렌더 end-to-end (정규화 → remark-math → KaTeX)", () => {
  it("사용자의 실제 깨진 입력(본문+인라인 복수 대괄호)이 KaTeX 디스플레이로 렌더된다", () => {
    const raw =
      "지수 함수와 선형 함수의 미분은 다음과 같이 정리된다. [ f(x)=e^x\\rightarrow \\frac{df}{dx}=e^x ] [ f_a(x)=ax\\rightarrow \\frac{df}{dx}=a ]";
    const html = render(raw);
    expect(hasKatex(html)).toBe(true);
    expect(hasDisplay(html)).toBe(true);
    // 본문 산문은 그대로 남는다.
    expect(html).toContain("지수 함수와 선형 함수의 미분은");
  });

  it("시그모이드 도함수 한 줄도 디스플레이 수식으로 렌더된다", () => {
    const raw =
      "시그모이드의 미분은 다음과 같이 정리된다. [ \\frac{d\\sigma(x)}{dx}=\\frac{e^{-x}}{(1+e^{-x})^2}=(1-\\sigma(x))\\sigma(x) ]";
    const html = render(raw);
    expect(hasKatex(html)).toBe(true);
    expect(hasDisplay(html)).toBe(true);
  });

  it("\\[ \\] / \\( \\) 구분자도 KaTeX로 렌더된다", () => {
    expect(hasKatex(render("\\[ a^2+b^2=c^2 \\]"))).toBe(true);
    expect(hasKatex(render("출력은 \\( \\sigma(x) \\) 이다"))).toBe(true);
  });

  it("마크다운 링크는 수식으로 변환되지 않고 <a>로 렌더된다", () => {
    const html = render("자세한 내용은 [원본 보기](https://example.com/doc)");
    expect(hasKatex(html)).toBe(false);
    expect(html).toContain("<a");
    expect(html).toContain("원본 보기");
  });
});
