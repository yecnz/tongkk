import type { CSSProperties, MouseEvent } from "react";
import { Link } from "react-router-dom";

const termsPath = "/terms";
const privacyPath = "/privacy";

// 개인정보처리방침·이용약관 바로가기. Google OAuth 검증상 홈에서 방침 링크가 보여야 한다.
export default function LegalLinks({ style, signup = false, onNavigate }: {
  style?: CSSProperties;
  signup?: boolean;
  onNavigate?: () => void;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    onNavigate?.();
  }

  if (signup) {
    return (
      <p className="auth-signup-legal">
        가입 시 <Link to={termsPath} onClick={handleClick}>이용약관</Link>이 적용되며, 개인정보는 <Link to={privacyPath} onClick={handleClick}>개인정보처리방침</Link>에 따릅니다.
      </p>
    );
  }

  return (
    <nav style={{ display: "flex", gap: 16, fontSize: 13, ...style }}>
      <Link to={privacyPath} onClick={handleClick} style={{ color: "var(--color-muted)" }}>개인정보처리방침</Link>
      <Link to={termsPath} onClick={handleClick} style={{ color: "var(--color-muted)" }}>이용약관</Link>
    </nav>
  );
}
