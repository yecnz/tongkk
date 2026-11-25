import BrandLogo from "../components/BrandLogo";
import LegalLinks from "../components/LegalLinks";
import { useId, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { PINK, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, SOFT_SHADOW } from "../common";
import { useAuth } from "../AuthContext";
import { useToast } from "../ToastContext";
import LoginModal, { type AuthMode } from "../components/LoginModal";
import PasswordControl from "../components/PasswordControl";
import { authErrorMessage, RESET_PASSWORD_PATH } from "../services/authFlow";

export default function Auth() {
  const { user, loading, recoveryMode, authCallbackError, updatePassword, endRecovery } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // 경로가 상태를 보존한다. SDK가 URL 토큰을 지운 후 새로고침해도 폼이 유지된다.
  const recoveryScreen = recoveryMode || pathname === RESET_PASSWORD_PATH;
  const expiredLink = new URLSearchParams(window.location.search).get('auth_error') === 'invalid_link'
    || (recoveryScreen && !loading && !user && !authCallbackError);
  const linkError = expiredLink ? '이 링크는 만료되었거나 더 이상 사용할 수 없어요.' : authCallbackError;
  const { showToast } = useToast();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [modalView, setModalView] = useState<'credentials' | 'reset'>('credentials');
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const id = useId();
  const passwordValid = newPassword.length >= 8;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;
  const passwordError = recoveryAttempted && !passwordValid;
  const confirmationError = recoveryAttempted && !passwordsMatch;

  const handleRecoverySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || loading || !user || linkError) return;
    setRecoveryAttempted(true);
    setRecoveryError("");
    if (!passwordValid || !passwordsMatch) return;
    pending.current = true;
    setSubmitting(true);
    try {
      await updatePassword(newPassword);
      showToast("비밀번호를 변경했어요. 새 비밀번호로 로그인되었습니다.", "success");
      endRecovery(); // recovery 종료 → 아래 리다이렉트 가드가 대시보드로 이동시킨다.
      navigate('/', { replace: true });
    } catch (err) {
      setRecoveryError(authErrorMessage(err, '비밀번호 변경에 실패했습니다. 로그인 상태를 확인하거나 새 재설정 메일을 요청해주세요.'));
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

  const showRecoveryCard = !loading && (Boolean(linkError) || recoveryScreen);
  const requestReset = () => {
    setModalView('reset');
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

      <div className={showRecoveryCard ? 'auth-recovery-page' : undefined} style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 32 }}>
          <BrandLogo large />
        </div>
        {showRecoveryCard ? linkError ? (
          <section className="auth-dialog auth-recovery auth-recovery-card" aria-labelledby={`${id}-title`}>
            <header>
              <h1 id={`${id}-title`}>재설정 링크를 확인해 주세요</h1>
              <p className="auth-recovery-description auth-form-error" role="alert">{linkError}</p>
            </header>
            <button type="button" className="auth-dialog-submit" onClick={requestReset}>재설정 메일 다시 받기</button>
            <button type="button" className="auth-recovery-link"
              onClick={() => { endRecovery(); navigate('/auth', { replace: true }); }}>
              로그인으로 돌아가기
            </button>
          </section>
        ) : (
          <form className="auth-dialog auth-recovery auth-recovery-card" onSubmit={handleRecoverySubmit} noValidate>
            <header>
              <h1>새 비밀번호 설정</h1>
              <p className="auth-recovery-description">새로 사용할 비밀번호를 입력해 주세요.</p>
            </header>
            <div className="auth-credential-fields">
              <div>
                <PasswordControl id={`${id}-password`} label="새 비밀번호" value={newPassword} onChange={setNewPassword}
                  autoComplete="new-password" disabled={submitting} invalid={passwordError} describedBy={`${id}-password-hint`} />
                <p id={`${id}-password-hint`} className="auth-signup-hint"
                  data-valid={passwordValid} role={passwordError ? 'alert' : undefined}>
                  {passwordError ? '비밀번호를 8자 이상 입력해주세요.' : '8자 이상'}
                </p>
              </div>
              <div>
                <PasswordControl id={`${id}-confirm`} label="새 비밀번호 확인" value={confirmPassword} onChange={setConfirmPassword}
                  autoComplete="new-password" disabled={submitting} invalid={confirmationError} describedBy={`${id}-confirm-hint`} />
                <p id={`${id}-confirm-hint`} className="auth-signup-hint"
                  data-valid={passwordValid && passwordsMatch} role={confirmationError ? 'alert' : undefined}>
                  {confirmationError ? '비밀번호가 일치하지 않아요.' : '비밀번호 일치'}
                </p>
              </div>
            </div>
            {recoveryError && <p className="auth-form-error" role="alert">{recoveryError}</p>}
            <button type="submit" className="auth-dialog-submit" disabled={submitting}>
              {submitting ? "변경 중..." : "비밀번호 변경"}
            </button>
            <button type="button" className="auth-recovery-link" disabled={submitting} onClick={requestReset}>
              재설정 메일 다시 받기
            </button>
          </form>
        ) : (
          <div style={{
            background: CARD_BACKGROUND,
            borderRadius: 20,
            padding: "40px 36px",
            width: "min(340px, calc(100vw - 48px))",
            border: `1px solid ${BORDER_COLOR}`,
            boxShadow: SOFT_SHADOW,
            boxSizing: "border-box",
          }}>
            {loading ? <p role="status">로그인 상태를 확인하고 있어요…</p> : (
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
        )}
        <LegalLinks style={{ justifyContent: "center", marginTop: 20 }} />
      </div>
    </div>
  );
}
