import { describe, it, expect } from "vitest";
import { normalizeMathDelimiters } from "./common";

// LLM이 수식을 KaTeX가 못 읽는 구분자로 내보낼 때 remark-math가 인식하는 $$/$ 로 정규화하는지,
// 그리고 일반 마크다운(링크·인용·배열)·코드는 건드리지 않는지 특성화한다.
describe("normalizeMathDelimiters", () => {
  it("맨 대괄호 한 줄 디스플레이 수식을 $$로 감싼다", () => {
    expect(normalizeMathDelimiters("[ f(x)=\\frac{1}{x} ]").trim()).toBe(
      "$$\nf(x)=\\frac{1}{x}\n$$",
    );
  });

  it("본문 중간·한 줄에 여러 개인 인라인 대괄호 수식도 각각 $$로 승격한다", () => {
    const out = normalizeMathDelimiters(
      "정리된다. [ f(x)=e^x\\rightarrow \\frac{df}{dx}=e^x ] [ f_a(x)=ax\\rightarrow \\frac{df}{dx}=a ]",
    );
    expect(out).toContain("$$\nf(x)=e^x\\rightarrow \\frac{df}{dx}=e^x\n$$");
    expect(out).toContain("$$\nf_a(x)=ax\\rightarrow \\frac{df}{dx}=a\n$$");
    expect(out.startsWith("정리된다.")).toBe(true);
  });

  it("\\[ ... \\] 디스플레이 구분자를 $$로 바꾼다", () => {
    expect(normalizeMathDelimiters("\\[ a^2+b^2=c^2 \\]").trim()).toBe(
      "$$\na^2+b^2=c^2\n$$",
    );
  });

  it("\\( ... \\) 인라인 구분자를 $로 바꾼다", () => {
    expect(normalizeMathDelimiters("출력은 \\( \\sigma(x) \\) 이다.")).toBe(
      "출력은 $\\sigma(x)$ 이다.",
    );
  });

  it("마크다운 링크는 건드리지 않는다", () => {
    const link = "[원본 보기](https://example.com/a)";
    expect(normalizeMathDelimiters(link)).toBe(link);
  });

  it("역슬래시가 없는 일반 대괄호(인용·각주·식별자·배열)는 그대로 둔다", () => {
    expect(normalizeMathDelimiters("[1]")).toBe("[1]");
    expect(normalizeMathDelimiters("[참고]")).toBe("[참고]");
    expect(normalizeMathDelimiters("[a, b, c]")).toBe("[a, b, c]");
    // GFM 각주 참조/식별자: 신호 문자(^, _)가 있어도 역슬래시가 없으면 수식으로 보지 않는다.
    expect(normalizeMathDelimiters("본문[^1] 끝")).toBe("본문[^1] 끝");
    expect(normalizeMathDelimiters("[snake_case_id]")).toBe("[snake_case_id]");
    expect(normalizeMathDelimiters("[{json}]")).toBe("[{json}]");
  });

  it("이미 $-구분된 수식은 그대로 둔다(멱등)", () => {
    expect(normalizeMathDelimiters("인라인 $x^2$ 과 $$\\frac{a}{b}$$")).toBe(
      "인라인 $x^2$ 과 $$\\frac{a}{b}$$",
    );
  });

  it("코드 펜스 안의 LaTeX 구분자는 변환하지 않고 그대로 보존한다", () => {
    const fenced = "```\n\\[ x^2 \\]\n```";
    expect(normalizeMathDelimiters(fenced)).toBe(fenced);
  });

  it("인라인 코드 안의 대괄호 수식은 변환하지 않는다", () => {
    const inline = "예: `\\frac{a}{b}` 형태";
    expect(normalizeMathDelimiters(inline)).toBe(inline);
  });
});
