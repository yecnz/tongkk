import { useState, type CSSProperties, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, SOFT_SHADOW } from "../common";
import { useAuth } from "../AuthContext";
import { useToast } from "../ToastContext";
import LoginModal, { type AuthMode } from "../components/LoginModal";

const recoveryInputStyle = (focused: boolean): CSSProperties => ({
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

export default function Auth() {
  const { user, loading, recoveryMode, updatePassword, endRecovery } = useAuth();
  const { showToast } = useToast();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwFocus, setPwFocus] = useState(false);
  const [confirmFocus, setConfirmFocus] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRecoverySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 6) {
      setRecoveryError("비밀번호는 6자 이상이어야 해요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoveryError("비밀번호가 일치하지 않아요.");
      return;
    }
    setRecoveryError("");
    setSubmitting(true);
    try {
      await updatePassword(newPassword);
      showToast("비밀번호를 변경했어요. 새 비밀번호로 로그인되었습니다.", "success");
      endRecovery(); // recovery 종료 → 아래 리다이렉트 가드가 대시보드로 이동시킨다.
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // recovery 중에는 user가 있어도 대시보드로 보내지 않고 새 비밀번호 입력 폼을 띄운다.
  if (!loading && user && !recoveryMode) return <Navigate to="/" replace />;

  const openModal = (nextMode: AuthMode = "signIn") => {
    setMode(nextMode);
    setShowLoginModal(true);
  };

  return (
    <div style={{
      minHeight: "100vh",
      fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: PAGE_BACKGROUND,
      padding: 24,
      boxSizing: "border-box",
    }}>
      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} initialMode={mode} />
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
          {recoveryMode ? (
            <form onSubmit={handleRecoverySubmit} style={{ textAlign: "left" }}>
              <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 500, color: "var(--color-text-strong)", textAlign: "center" }}>
                새 비밀번호 설정
              </h1>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 24px", textAlign: "center" }}>
                새로 사용할 비밀번호를 입력해주세요
              </p>

              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>
                새 비밀번호
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                onFocus={() => setPwFocus(true)}
                onBlur={() => setPwFocus(false)}
                placeholder="6자 이상 입력하세요"
                autoComplete="new-password"
                minLength={6}
                required
                style={{ ...recoveryInputStyle(pwFocus), marginBottom: 14 }}
              />

              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>
                새 비밀번호 확인
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                onFocus={() => setConfirmFocus(true)}
                onBlur={() => setConfirmFocus(false)}
                placeholder="다시 한 번 입력하세요"
                autoComplete="new-password"
                minLength={6}
                required
                style={{ ...recoveryInputStyle(confirmFocus), marginBottom: 20 }}
              />

              {recoveryError && (
                <p style={{ margin: "0 0 14px", color: "var(--color-danger)", fontSize: 12, lineHeight: 1.5 }}>
                  {recoveryError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  borderRadius: 14,
                  background: PINK,
                  border: "none",
                  color: "var(--color-on-brand)",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: submitting ? "default" : "pointer",
                  boxShadow: "0 8px 18px rgba(240,112,174,0.16)",
                }}
              >
                {submitting ? "변경 중..." : "비밀번호 변경"}
              </button>
            </form>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
