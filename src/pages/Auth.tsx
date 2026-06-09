import { useState, type CSSProperties, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, SOFT_SHADOW } from "../common";
import { useAuth } from "../AuthContext";
import { useToast } from "../ToastContext";

type AuthMode = "signIn" | "signUp";

const inputStyle = (focused: boolean): CSSProperties => ({
  width: "100%",
  padding: "13px 16px",
  borderRadius: 12,
  border: `1.5px solid ${focused ? CYAN : BORDER_COLOR}`,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  background: focused ? "rgba(0,192,232,0.04)" : MUTED_SURFACE,
  transition: "border 0.2s, background 0.2s",
  color: "var(--color-text-strong)",
});

const linkStyle: CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 12,
  color: "var(--color-muted)",
  cursor: "pointer",
  padding: 0,
};

export default function Auth() {
  const { user, loading, signIn, signUp, resetPassword } = useAuth();
  const { showToast } = useToast();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocus, setEmailFocus] = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signIn") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const openModal = (nextMode: AuthMode = "signIn") => {
    setMode(nextMode);
    setError("");
    setShowLoginModal(true);
  };

  const handlePasswordReset = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("비밀번호를 재설정할 이메일을 입력해주세요.");
      return;
    }
    setError("");
    try {
      await resetPassword(trimmed);
      showToast("비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "비밀번호 재설정 메일 전송에 실패했습니다.");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: PAGE_BACKGROUND,
      padding: 24,
      boxSizing: "border-box",
    }}>
      {showLoginModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(15,23,42,0.2)",
          backdropFilter: "blur(6px)",
          padding: 24,
          boxSizing: "border-box",
        }}>
          <form
            onSubmit={handleSubmit}
            style={{
              width: "min(380px, 100%)",
              background: CARD_BACKGROUND,
              borderRadius: 20,
              padding: "36px 32px",
              border: `1px solid ${BORDER_COLOR}`,
              boxShadow: "0 18px 48px rgba(15, 23, 42, 0.09)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 500, color: "var(--color-text-strong)" }}>
                  {mode === "signIn" ? "로그인" : "회원가입"}
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {mode === "signIn" ? "계정에 로그인하세요" : "계정을 생성하세요"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowLoginModal(false);
                  setError("");
                }}
                aria-label="닫기"
                style={{
                  background: MUTED_SURFACE,
                  border: "none",
                  borderRadius: "50%",
                  width: 34,
                  height: 34,
                  cursor: "pointer",
                  fontSize: 16,
                  color: "var(--color-text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                onFocus={() => setEmailFocus(true)}
                onBlur={() => setEmailFocus(false)}
                placeholder="이메일을 입력하세요"
                autoComplete="email"
                required
                style={inputStyle(emailFocus)}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                onFocus={() => setPasswordFocus(true)}
                onBlur={() => setPasswordFocus(false)}
                placeholder="비밀번호를 입력하세요"
                autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                minLength={6}
                required
                style={inputStyle(passwordFocus)}
              />
            </div>

            {error && (
              <p style={{ margin: "0 0 14px", color: "var(--color-danger)", fontSize: 12, lineHeight: 1.5 }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                padding: "14px 0",
                borderRadius: 14,
                border: "none",
                background: PINK,
                color: "var(--color-on-brand)",
                fontSize: 15,
                fontWeight: 600,
                cursor: submitting ? "default" : "pointer",
                boxShadow: "none",
                marginBottom: 16,
              }}
            >
              {submitting ? "처리 중..." : mode === "signIn" ? "로그인" : "회원가입"}
            </button>

            <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
              <button type="button" onClick={handlePasswordReset} style={linkStyle}>
                비밀번호 찾기
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signIn" ? "signUp" : "signIn");
                  setError("");
                }}
                style={linkStyle}
              >
                {mode === "signIn" ? "회원가입" : "로그인"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 36,
            fontWeight: 800,
            color: PINK,
            letterSpacing: 0,
          }}>
            Tongkk
          </div>
        </div>
        <div style={{
          background: CARD_BACKGROUND,
          borderRadius: 20,
          padding: "40px 36px",
          width: "min(340px, calc(100vw - 48px))",
          border: `1px solid ${BORDER_COLOR}`,
          boxShadow: SOFT_SHADOW,
          boxSizing: "border-box",
        }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 500, color: "var(--color-text-strong)" }}>
            로그인이 필요합니다
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 28px" }}>
            Tongkk를 이용하려면 로그인해주세요
          </p>
          <button
            type="button"
            onClick={() => openModal("signIn")}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 14,
              background: PINK,
              border: "none",
              color: "var(--color-on-brand)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 8px 18px rgba(240,112,174,0.16)",
            }}
          >
            로그인
          </button>
        </div>
      </div>
    </div>
  );
}
