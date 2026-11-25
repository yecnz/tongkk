import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

// 개인정보처리방침·이용약관 바로가기. Google OAuth 검증상 홈에서 방침 링크가 보여야 한다.
export default function LegalLinks({ style }: { style?: CSSProperties }) {
  return (
    <nav style={{ display: "flex", gap: 16, fontSize: 13, ...style }}>
      <Link to="/privacy" style={{ color: "var(--color-muted)" }}>개인정보처리방침</Link>
      <Link to="/terms" style={{ color: "var(--color-muted)" }}>이용약관</Link>
    </nav>
  );
}
