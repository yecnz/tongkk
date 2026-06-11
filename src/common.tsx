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
export const normalizeBoldSpacing = (text: string): string =>
  text.replace(/(^|\s)\*\*[^\S\n]+([^*\n\s](?:[^*\n]*[^*\n\s])?)[^\S\n]+\*\*(?=$|\s|[.,!?;:)\]])/g, "$1**$2**");

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
        <button className="tongkk-hover-fade" onClick={() => { onNav("대시보드"); onClose(); }} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <button className="tongkk-hover-dim" onClick={onClose} style={{ background: "none", border: "none", borderRadius: 8, padding: "2px 8px", cursor: "pointer", fontSize: 18, color: "var(--color-muted)" }}>✕</button>
      </div>
      {(Object.keys(pageRoutes) as PageRouteLabel[])
        .filter(item => item !== "자료 요약" && item !== "퀴즈 생성")
        .map(item => (
        <button key={item} className={active === item ? undefined : "tongkk-hover-row"} onClick={() => { onNav(item); onClose(); }} style={{
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
