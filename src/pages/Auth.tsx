import BrandLogo from "../components/BrandLogo";
import LegalLinks from "../components/LegalLinks";
import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { PINK, CYAN, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, SOFT_SHADOW } from "../common";
import { useAuth } from "../AuthContext";
import { useToast } from "../ToastContext";
import LoginModal, { type AuthMode } from "../components/LoginModal";
import { authErrorMessage, RESET_PASSWORD_PATH } from "../services/authFlow";

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
  const { user, loading, recoveryMode, authCallbackError, updatePassword, endRecovery } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // 경로가 상태를 보존한다. SDK가 URL 토큰을 지운 후 새로고침해도 폼이 유지된다.
  const recoveryScreen = recoveryMode || pathname === RESET_PASSWORD_PATH;
  const linkError = authCallbackError || (recoveryScreen && !loading && !user ? '재설정 세션이 만료되었거나 유효하지 않습니다. 새 메일을 요청하세요.' : null);
  const { showToast } = useToast();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [modalView, setModalView] = useState<'credentials' | 'reset'>('credentials');
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwFocus, setPwFocus] = useState(false);
  const [confirmFocus, setConfirmFocus] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const id = useId();

  const handleRecoverySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || loading || !user || linkError) return;
    if (newPassword.length < 8) {
      setRecoveryError("비밀번호를 8자 이상 입력하세요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoveryError("비밀번호가 일치하지 않아요.");
      return;
    }
    setRecoveryError("");
    pending.current = true;
    setSubmitting(true);
    try {
      await updatePassword(newPassword);
      showToast("비밀번호를 변경했어요. 새 비밀번호로 로그인되었습니다.", "success");
      endRecovery(); // recovery 종료 → 아래 리다이렉트 가드가 대시보드로 이동시킨다.
      navigate('/', { replace: true });
    } catch (err) {
      setRecoveryError(authErrorMessage(err, '비밀번호 변경에 실패했습니다. 로그인 상태를 확인하거나 새 재설정 메일을 요청하세요.'));
    } finally {
      setSubmitting(false);
      pending.current = false;
    }
  };

  // recovery 중에는 user가 있어도 대시보드로 보내지 않고 새 비밀번호 입력 폼을 띄운다.
  if (!loading && user && !recoveryScreen && !linkError) return <Navigate to="/" replace />;

  const openModal = (nextMode: AuthMode = "signIn") => {
    setMode(nextMode);
    setModalView('credentials');
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
        <LoginModal onClose={() => setShowLoginModal(false)} initialMode={mode} initialView={modalView} />
      )}

      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 32 }}>
          <BrandLogo large />
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
          {loading ? <p role="status">로그인 상태를 확인하고 있습니다…</p> : linkError ? (
            <div>
              <h1 style={{ fontSize: 22 }}>인증 링크를 확인하세요</h1>
              <p role="alert" style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>{linkError}</p>
              <button type="button" onClick={() => { setModalView('reset'); setShowLoginModal(true); }}
                style={{ ...recoveryInputStyle(false), cursor: 'pointer', marginBottom: 12 }}>재설정 메일 다시 받기</button>
              <button type="button" onClick={() => { endRecovery(); navigate('/auth', { replace: true }); }}
                style={{ background: 'none', border: 0, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>로그인으로 돌아가기</button>
            </div>
          ) : recoveryScreen ? (
            <form onSubmit={handleRecoverySubmit} style={{ textAlign: "left" }}>
              <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 500, color: "var(--color-text-strong)", textAlign: "center" }}>
                새 비밀번호 설정
              </h1>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 24px", textAlign: "center" }}>
                새로 사용할 비밀번호를 입력하세요
              </p>

              <label htmlFor={`${id}-password`} style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>
                새 비밀번호
              </label>
              <input
                id={`${id}-password`}
                type="password"
                disabled={submitting}
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                onFocus={() => setPwFocus(true)}
                onBlur={() => setPwFocus(false)}
                placeholder="8자 이상 입력하세요"
                autoComplete="new-password"
                minLength={8}
                required
                style={{ ...recoveryInputStyle(pwFocus), marginBottom: 14 }}
              />

              <label htmlFor={`${id}-confirm`} style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>
                새 비밀번호 확인
              </label>
              <input
                id={`${id}-confirm`}
                type="password"
                disabled={submitting}
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                onFocus={() => setConfirmFocus(true)}
                onBlur={() => setConfirmFocus(false)}
                placeholder="다시 한 번 입력하세요"
                autoComplete="new-password"
                minLength={8}
                required
                style={{ ...recoveryInputStyle(confirmFocus), marginBottom: 20 }}
              />

              {recoveryError && (
                <p role="alert" style={{ margin: "0 0 14px", color: "var(--color-danger)", fontSize: 12, lineHeight: 1.5 }}>
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
              <button type="button" disabled={submitting} onClick={() => { setModalView('reset'); setShowLoginModal(true); }}
                style={{ background: 'none', border: 0, marginTop: 16, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>재설정 메일 다시 받기</button>
            </form>
          ) : (
            <>
              <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 500, color: "var(--color-text-strong)" }}>
                로그인이 필요합니다
              </h1>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 28px" }}>
                Tongkk를 이용하려면 로그인하세요
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
        <LegalLinks style={{ justifyContent: "center", marginTop: 20 }} />
      </div>
    </div>
  );
}
