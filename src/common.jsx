export const PINK = "#F070AE";
export const CYAN = "#00C0E8";

export const pageRoutes = {
  "대시보드": "/",
  "자료 요약": "/summary",
  "퀴즈 생성": "/quiz",
  "커뮤니티": "/community",
  "마이페이지": "/mypage",
};

export const SidebarIcon = () => (
  <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
    <rect x="0.5" y="0.5" width="21" height="17" rx="3" stroke="#999" strokeWidth="1"/>
    <line x1="8" y1="1" x2="8" y2="17" stroke="#999" strokeWidth="1"/>
  </svg>
);

export const Sidebar = ({ active, onNav, onClose }) => (
  <div style={{
    position: "fixed", top: 0, left: 0, width: 240, height: "100vh",
    background: "#fff", borderRight: "1px solid #eee", zIndex: 100,
    display: "flex", flexDirection: "column", padding: "24px 0",
    boxShadow: "2px 0 12px rgba(0,0,0,0.06)"
  }}>
    <div style={{ padding: "0 20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#999" }}>✕</button>
    </div>
    {Object.keys(pageRoutes).map(item => (
      <button key={item} onClick={() => { onNav(item); onClose(); }} style={{
        padding: "14px 24px", border: "none", background: active === item ? "#FFF0F6" : "transparent",
        textAlign: "left", fontSize: 15, fontWeight: active === item ? 600 : 400,
        color: active === item ? PINK : "#555", cursor: "pointer", transition: "all 0.2s"
      }}>{item}</button>
    ))}
  </div>
);

export const Card = ({ children, style, ...props }) => (
  <div style={{
    background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)", ...style
  }} {...props}>{children}</div>
);
