import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

const termsPath = "/terms";
const privacyPath = "/privacy";

// 개인정보처리방침·이용약관 바로가기. Google OAuth 검증상 홈에서 방침 링크가 보여야 한다.
export default function LegalLinks({ style, signup = false }: { style?: CSSProperties; signup?: boolean }) {
  if (signup) {
    return (
      <p className="auth-signup-legal">
        가입 시 <Link to={termsPath}>이용약관</Link>이 적용되며, 개인정보는 <Link to={privacyPath}>개인정보처리방침</Link>에 따릅니다.
      </p>
    );
  }

  return (
    <nav style={{ display: "flex", gap: 16, fontSize: 13, ...style }}>
      <Link to={privacyPath} style={{ color: "var(--color-muted)" }}>개인정보처리방침</Link>
      <Link to={termsPath} style={{ color: "var(--color-muted)" }}>이용약관</Link>
    </nav>
  );
}
