import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export const PINK = "#F070AE";
export const CYAN = "#00C0E8";
export const PAGE_BACKGROUND = "#f7f8fb";
export const CARD_BACKGROUND = "#fbfcfe";
export const BORDER_COLOR = "#e2e6ee";
export const MUTED_SURFACE = "#f1f4f8";
export const SOFT_SHADOW = "0 10px 28px rgba(15, 23, 42, 0.045)";

export const pageRoutes = {
  "대시보드": "/",
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
    {(Object.keys(pageRoutes) as PageRouteLabel[]).map(item => (
      <button key={item} onClick={() => { onNav(item); onClose(); }} style={{
        padding: "14px 24px", border: "none", background: active === item ? "rgba(240,112,174,0.11)" : "transparent",
        textAlign: "left", fontSize: 15, fontWeight: active === item ? 600 : 400,
        color: active === item ? PINK : "#475569", cursor: "pointer", transition: "all 0.2s"
      }}>{item}</button>
    ))}
  </div>
);

export const Card = ({ children, style, ...props }: CardProps) => (
  <div className="tongkk-card" style={{
    background: CARD_BACKGROUND, borderRadius: 18, border: `1px solid ${BORDER_COLOR}`,
    boxShadow: SOFT_SHADOW, ...style
  }} {...props}>{children}</div>
);
