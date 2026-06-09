import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export const PINK = "#F070AE";
export const CYAN = "#00C0E8";
export const PAGE_BACKGROUND = "#f7f8fb";
export const CARD_BACKGROUND = "#fbfcfe";
export const BORDER_COLOR = "#e2e6ee";
export const MUTED_SURFACE = "#f1f4f8";
export const SOFT_SHADOW = "0 10px 28px rgba(15, 23, 42, 0.045)";

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
    <rect x="0.5" y="0.5" width="21" height="17" rx="4" stroke="#64748b" strokeWidth="1"/>
    <line x1="8" y1="1" x2="8" y2="17" stroke="#64748b" strokeWidth="1"/>
  </svg>
);

export const Sidebar = ({ active, onNav, onClose }: SidebarProps) => (
  <div className="tongkk-sidebar" style={{
    position: "fixed", top: 0, left: 0, width: 240, height: "100vh",
    background: CARD_BACKGROUND, borderRight: `1px solid ${BORDER_COLOR}`, zIndex: 100,
    display: "flex", flexDirection: "column", padding: "24px 0",
    boxShadow: "10px 0 30px rgba(15, 23, 42, 0.045)"
  }}>
    <div style={{ padding: "0 20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button onClick={() => { onNav("대시보드"); onClose(); }} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}>✕</button>
    </div>
    {(Object.keys(pageRoutes) as PageRouteLabel[])
      .filter(item => item !== "자료 요약" && item !== "퀴즈 생성")
      .map(item => (
      <button key={item} onClick={() => { onNav(item); onClose(); }} style={{
        padding: "14px 24px", border: "none", background: active === item ? "rgba(240,112,174,0.11)" : "transparent",
        textAlign: "left", fontSize: 15, fontWeight: active === item ? 600 : 400,
        color: active === item ? PINK : "#475569", cursor: "pointer", transition: "all 0.2s"
      }}>{item}</button>
    ))}
  </div>
);

export const Card = ({ children, style, className, ...props }: CardProps) => (
  <div className={["tongkk-card", className].filter(Boolean).join(" ")} style={{
    background: CARD_BACKGROUND, borderRadius: 18, border: `1px solid ${BORDER_COLOR}`,
    boxShadow: SOFT_SHADOW, ...style
  }} {...props}>{children}</div>
);
