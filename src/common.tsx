import { useEffect, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

// 피드백을 받을 팀 메일 (사이드바 하단·문의 메일 공통)
export const FEEDBACK_EMAIL = "tongkk.team@gmail.com";

// 색상은 모두 CSS 변수를 가리켜 라이트/다크 토큰을 자동으로 따른다(정의: src/index.css).
// 브랜드색 PINK·CYAN도 다크에서 채도를 낮춘 값으로 전환되며, 투명도를 섞을 때는
// color-mix(in srgb, var(--color-pink) N%, transparent)를 쓴다(var()엔 hex 알파 접미사를 못 붙인다).
export const PINK = "var(--color-pink)";
export const CYAN = "var(--color-cyan)";
export const PAGE_BACKGROUND = "var(--color-page)";
export const CARD_BACKGROUND = "var(--color-card)";
export const BORDER_COLOR = "var(--color-border)";
export const MUTED_SURFACE = "var(--color-muted-surface)";
export const SOFT_SHADOW = "var(--shadow-card)";

// LLM이 별표 안쪽에 공백을 넣어(`** 텍스트 **`) 출력하면 react-markdown이 굵게로 파싱하지
// 못하고 별표를 그대로 보여준다. 마크다운 렌더 직전에 한 줄 안에서 별표와 텍스트 사이의 공백을
// 제거해 정상적으로 굵게 처리되도록 한다.
// - 여는 **는 줄 시작/공백 뒤(여는 위치), 닫는 **는 줄 끝·공백·문장부호 앞(닫는 위치)에서만
//   매칭해, 한 줄에 굵게가 여러 개일 때 앞 굵게의 닫는 **가 뒤 굵게의 여는 **와 잘못 짝지어져
//   `**첫째** 그리고 **둘째**`가 깨지는 것을 막는다.
// - 내용을 공백·별표가 아닌 문자로 시작/끝나게 강제해 공백 수량자 모호성(역추적 폭주)을 없앤다.
//
// 추가로, 닫는 **의 바로 앞이 문장부호( ) ] . , 등)이고 바로 뒤에 한글/영숫자가 붙으면
// CommonMark flanking 규칙상 굵게가 닫히지 않아 **가 그대로 보인다(예: `**자외선(uv)**으로`).
// 문장부호와 닫는 ** 사이에 보이지 않는 ZWSP(U+200B)를 넣어 닫는 **가 정상적으로 인식되게 한다.
// (ZWSP는 화면에 보이지 않으므로 굵게 텍스트는 그대로 `자외선(uv)`로 렌더된다.)
export const normalizeBoldSpacing = (text: string): string =>
  text
    .replace(/(^|\s)\*\*[^\S\n]+([^*\n\s](?:[^*\n]*[^*\n\s])?)[^\S\n]+\*\*(?=$|\s|[.,!?;:)\]])/g, "$1**$2**")
    .replace(/(\*\*[^*\n]+?[^\s가-힣A-Za-z0-9*])\*\*(?=[가-힣A-Za-z0-9])/g, "$1\u200B**");

// LLM이 수식을 KaTeX가 못 읽는 구분자(\[ \], \( \), 또는 한 줄 전체가 맨 대괄호 [ ... ])로
// 내보내면 remark-math가 인식하지 못해 raw LaTeX가 그대로 깨져 보인다. remark-math 기본 설정이
// 인식하는 $$...$$(디스플레이)·$...$(인라인)로 정규화한다. 이미 $-구분자면 어느 패턴에도 걸리지
// 않아 그대로 둔다(멱등). 다른 정규화(굵게/출처/페이지마커)보다 먼저 돌려, 이후 처리가 이미
// $-구분된 텍스트 위에서 동작하게 한다.
export const normalizeMathDelimiters = (text: string): string => {
  // 0. 코드블록/인라인코드는 placeholder로 떼어내 보호한다(코드 안 대괄호·백슬래시를 건드리지 않음).
  const code: string[] = [];
  let s = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    code.push(m);
    return `CODE${code.length - 1}`;
  });

  // 1. 명시적 LaTeX 구분자: \[ ... \] → $$ ... $$,  \( ... \) → $ ... $ (정상 산문에 거의 안 나타나 무조건 안전)
  s = s
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_m, body) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_m, body) => `$${body.trim()}$`);

  // 2. [ ... ] 안에 역슬래시(\frac, \sigma, \rightarrow 등 LaTeX 명령 신호)가 있고 바로 뒤가 '('가 아니면(=링크 아님)
  //    디스플레이 수식으로 본다. 한 줄 전체든 본문 중간(한 줄에 여러 개)이든 매칭하고, 앞뒤 빈 줄을 넣어
  //    $$ 디스플레이 블록으로 승격한다. 역슬래시 필수라 각주 [^1]·[snake_case]·[참고]·[1]·링크는 건드리지 않는다.
  s = s.replace(
    /\[[ \t]*([^[\]\n]*?\\[^[\]\n]*?)[ \t]*\](?!\()/g,
    (_m, body) => `\n\n$$\n${body.trim()}\n$$\n\n`,
  );

  // 코드 placeholder 복원
  return s.replace(/CODE(\d+)/g, (_m, i) => code[Number(i)]);
};

// LLM이 곱셈을 KaTeX로 감싸지 않고 별표로 출력하면(예: `5*5*3 + 1 = 76`) react-markdown이
// 가운데 `*5*`를 이탤릭 강조로 파싱해 별표가 사라지고 `553`처럼 깨져 보인다. 영숫자 사이에
// 공백 없이 끼어 곱셈 기호로만 쓰인 단일 별표를 `\*`로 이스케이프해 문자 그대로 렌더한다.
// - 코드(```·``)와 이미 $-구분된 수식($...$, $$...$$)은 placeholder로 떼어내 보호한다(그 안의 *는
//   손대지 않는다). 그래서 수식 정규화(normalizeMathDelimiters) '뒤'에 돌려야 한다.
// - 양옆이 영숫자인 단일 *만 매칭하므로 `**굵게**`(별표 인접)나 여닫는 이탤릭(별표 양옆이 공백·
//   문장부호·한글)은 건드리지 않는다. 캡처 그룹으로 앞 문자를 보존해 lookbehind 없이 처리한다(구버전 Safari 대응).
// - placeholder는 normalizeMathDelimiters와 같은 사용자 영역 문자(U+E000) sentinel로 감싸 본문과 안 섞이게 한다.
export const escapeStrayMultiplication = (text: string): string => {
  const guarded: string[] = [];
  const S = "";
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g, (m) => {
    guarded.push(m);
    return `${S}MUL${guarded.length - 1}${S}`;
  });
  const escaped = masked.replace(/([0-9A-Za-z])\*(?=[0-9A-Za-z])/g, "$1\\*");
  return escaped.replace(new RegExp(`${S}MUL(\\d+)${S}`, "g"), (_m, i) => guarded[Number(i)]);
};

export const pageRoutes = {
  "대시보드": "/",
  "학습 캘린더": "/calendar",
  "자료 요약": "/summary",
  "퀴즈 생성": "/quiz",
  "오답 노트": "/review",
  "학습 통계": "/stats",
  "마이페이지": "/mypage",
} as const;

export type PageRouteLabel = keyof typeof pageRoutes;

type SidebarProps = {
  active: PageRouteLabel | string;
  onNav: (item: PageRouteLabel) => void;
  onClose: () => void;
};

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
};

export const SidebarIcon = () => (
  <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
    <rect x="0.5" y="0.5" width="21" height="17" rx="4" stroke="var(--color-text-secondary)" strokeWidth="1"/>
    <line x1="8" y1="1" x2="8" y2="17" stroke="var(--color-text-secondary)" strokeWidth="1"/>
  </svg>
);

// 피드백 보내기 버튼의 종이비행기 아이콘 (사이드바·대시보드 헤더 공용)
export const PaperPlaneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </svg>
);

export const Sidebar = ({ active, onNav, onClose }: SidebarProps) => {
  // 사이드바가 열려 있는 동안 body에 클래스를 붙여, 본문(#root)을 오른쪽으로 밀어
  // 가리지 않고 폭이 줄어들게 한다(스타일 정의: src/index.css). 언마운트 시 원복.
  useEffect(() => {
    document.body.classList.add("tongkk-sidebar-open");
    return () => document.body.classList.remove("tongkk-sidebar-open");
  }, []);

  // height:100vh 대신 top/bottom 0 — #root에 zoom이 걸려 있어 100vh는 축소되지만
  // 뷰포트 모서리 기준 offset은 zoom과 무관하게 전체 높이를 채운다(정의: src/index.css).
  // 백드롭은 768px 이하(overlay 모드)에서만 CSS로 표시된다.
  return (
    <>
    <div className="tongkk-sidebar-backdrop" onClick={onClose} aria-hidden="true" />
    <div className="tongkk-sidebar" style={{
      position: "fixed", top: 0, left: 0, bottom: 0, width: 240, maxWidth: "80vw",
      background: CARD_BACKGROUND, borderRight: `1px solid ${BORDER_COLOR}`, zIndex: 100,
      display: "flex", flexDirection: "column", padding: "24px 0",
      boxShadow: "10px 0 30px rgba(15, 23, 42, 0.045)"
    }}>
      <div style={{ padding: "0 20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" className="tongkk-hover-fade" onClick={() => { onNav("대시보드"); onClose(); }} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <button type="button" className="tongkk-hover-dim" onClick={onClose} aria-label="사이드바 닫기" style={{ background: "none", border: "none", borderRadius: 8, padding: "2px 8px", cursor: "pointer", fontSize: 18, color: "var(--color-muted)" }}>✕</button>
      </div>
      {(Object.keys(pageRoutes) as PageRouteLabel[])
        .filter(item => item !== "자료 요약" && item !== "퀴즈 생성")
        .map(item => (
        <button type="button" key={item} className={active === item ? undefined : "tongkk-hover-row"} onClick={() => { onNav(item); onClose(); }} style={{
          padding: "14px 24px", border: "none", background: active === item ? "color-mix(in srgb, var(--color-pink) 11%, transparent)" : "transparent",
          textAlign: "left", fontSize: 15, fontWeight: active === item ? 600 : 400,
          color: active === item ? PINK : "var(--color-text-secondary)", cursor: "pointer", transition: "all 0.2s"
        }}>{item}</button>
      ))}

      {/* 하단 피드백 — mailto로 메일 작성을 띄우고, 메일 클라이언트가 없는 사용자를 위해 주소도 노출 */}
      <div style={{ marginTop: "auto", padding: "16px 20px 4px", borderTop: `1px solid ${BORDER_COLOR}` }}>
        <a
          href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Tongkk 피드백")}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "11px 14px", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`,
            background: MUTED_SURFACE, color: "var(--color-text-secondary)",
            fontSize: 14, fontWeight: 700, textDecoration: "none", cursor: "pointer",
          }}
        >
          <PaperPlaneIcon />
          피드백 보내기
        </a>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-muted)", textAlign: "center", wordBreak: "break-all" }}>
          {FEEDBACK_EMAIL}
        </p>
      </div>
    </div>
    </>
  );
};

// 헤더용 공지 배너. 여러 멘트가 일정 시간마다 위로 슬라이드되며 전환되고, 끝까지 가면
// 끊김 없이 처음으로 순환한다(첫 항목을 끝에 한 번 더 붙여 점프를 숨김). 호버 시 멈춘다.
// 항목은 문자열, 또는 색을 따로 줄 때는 { text, color } 객체로 넣는다(color 미지정 시 기본 청록).
// 색은 옵션 A(연한 청록 tint 배경 + 진한 청록 글자)로, 라이트/다크 토큰을 자동으로 따른다.
type NoticeItem = string | { text: string; color?: string };

const NOTICE_HEIGHT = 38;   // 배너·각 멘트 줄 높이(px)
const NOTICE_ROTATE_MS = 4000;  // 한 멘트가 머무는 시간
const NOTICE_SLIDE_MS = 600;    // 슬라이드 전환 시간

export const NoticeBanner = ({ messages = [] }: { messages?: NoticeItem[] }) => {
  const count = messages.length;
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [paused, setPaused] = useState(false);

  // 멘트가 2개 이상일 때만 일정 시간마다 다음으로 슬라이드한다(호버 중엔 멈춤).
  useEffect(() => {
    if (count <= 1 || paused) return;
    const id = setInterval(() => setIndex(i => i + 1), NOTICE_ROTATE_MS);
    return () => clearInterval(id);
  }, [count, paused]);

  // 복제된 첫 항목(index === count)까지 슬라이드한 뒤 전환을 끄고 0으로 되돌려 순환시킨다.
  useEffect(() => {
    if (index !== count || count === 0) return;
    const t = setTimeout(() => { setAnimate(false); setIndex(0); }, NOTICE_SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, count]);

  // 0으로 점프한 직후 다음 프레임에 전환을 다시 켠다(점프가 보이지 않게).
  useEffect(() => {
    if (animate) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    return () => cancelAnimationFrame(r);
  }, [animate]);

  // 끊김 없는 순환을 위해 첫 항목을 끝에 한 번 더 붙인다.
  const lines = count ? [...messages, messages[0]] : [];

  return (
    <div
      className="tk-notice"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        flex: 1, overflow: "hidden", height: NOTICE_HEIGHT,
        borderRadius: 10, background: "var(--color-muted-surface)",
      }}
    >
      {lines.length > 0 && (
        <div style={{
          transform: `translateY(-${index * NOTICE_HEIGHT}px)`,
          transition: animate ? `transform ${NOTICE_SLIDE_MS}ms ease` : "none",
        }}>
          {lines.map((item, i) => {
            const text = typeof item === "string" ? item : item.text;
            const color = typeof item === "string" ? undefined : item.color;
            return (
              <div key={i} style={{
                height: NOTICE_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center",
                whiteSpace: "nowrap", color: color ?? "var(--color-cyan-deep)",
                fontSize: 14, fontWeight: 700,
              }}>{text}</div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Card = ({ children, style, className, ...props }: CardProps) => (
  <div className={["tongkk-card", className].filter(Boolean).join(" ")} style={{
    background: CARD_BACKGROUND, borderRadius: 18, border: `1px solid ${BORDER_COLOR}`,
    boxShadow: SOFT_SHADOW, ...style
  }} {...props}>{children}</div>
);
