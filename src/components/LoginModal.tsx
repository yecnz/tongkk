import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useAuth } from "../AuthContext";
import { AuthActionError, authErrorMessage, INVALID_LOGIN_CREDENTIALS_MESSAGE, isValidAuthEmail } from "../services/authFlow";
import { emailWaitSeconds } from "../services/authEmails";
import closeIcon from "../assets/mini/login-close.svg";
import checkSuccessIcon from "../assets/auth/check-success.svg";
import checkMutedIcon from "../assets/auth/check-muted.svg";
import LegalLinks from "./LegalLinks";
import PasswordControl, { type PasswordControlProps } from "./PasswordControl";
import "./LoginModal.css";

export type AuthMode = "signIn" | "signUp";
type View = 'credentials' | 'reset' | 'confirmation';
type LoginModalProps = {
  onClose: () => void;
  onAuthenticated?: () => void;
  initialMode?: AuthMode;
  initialView?: 'credentials' | 'reset';
  subtitle?: string;
  // 메뉴바 팝오버(/mini)용: 배경을 덮지 않고 팝오버 카드 자리(창 위쪽)에 작게 뜬다.
  compact?: boolean;
};

// Supabase 대시보드의 Email OTP length(6) · Email OTP expiration(300초)과 맞춘다.
const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

function SignupPasswordField({ hint, valid, error, compact, ...control }: Omit<PasswordControlProps, 'autoComplete' | 'invalid' | 'describedBy'> & {
  hint: string;
  valid: boolean;
  error: string;
  compact: boolean;
}) {
  const hintId = control.id + '-hint';
  return (
    <div className={compact ? 'mini-login-field' : undefined}>
      <PasswordControl {...control} autoComplete="new-password" invalid={!!error} describedBy={hintId} />
      <p id={hintId} className="auth-signup-hint" data-valid={valid} role={error ? 'alert' : undefined}>
        {!error && <img src={valid ? checkSuccessIcon : checkMutedIcon} alt="" width={12} height={12} />}
        {error || hint}
      </p>
    </div>
  );
}

export default function LoginModal({ onClose, onAuthenticated = onClose, initialMode = "signIn", initialView = 'credentials', subtitle, compact = false }: LoginModalProps) {
  const { signIn, signUp, resetPassword, resendConfirmation, verifySignupCode } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [view, setView] = useState<View>(initialView);
  const [email, setEmail] = useState("");
  const [emailTypeMismatch, setEmailTypeMismatch] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [signupAttempted, setSignupAttempted] = useState(false);
  const [code, setCode] = useState("");
  const [codeFocus, setCodeFocus] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [wrongCode, setWrongCode] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const [now, setNow] = useState(Date.now);
  const id = useId();
  const signingUp = view === 'credentials' && mode === 'signUp';
  const webSignIn = !compact && view === 'credentials' && mode === 'signIn';
  const confirming = view === 'confirmation';
  const resetting = view === 'reset';
  const webReset = resetting && !compact;
  const emailValid = isValidAuthEmail(email) && !emailTypeMismatch;
  const passwordValid = password.length >= 8;
  const passwordsMatch = passwordConfirmation.length > 0 && password === passwordConfirmation;
  const signupValid = emailValid && passwordValid && passwordsMatch;
  const emailError = signupAttempted && !emailValid && '올바르지 않은 이메일입니다. 이메일 형식에 맞게 입력해주세요.';
  const kind = view === 'reset' ? 'reset' : 'signup';
  const wait = emailWaitSeconds(kind, email, now);
  // 보낸 인증번호의 남은 시간(초). 이번 창에서 보낸 적이 없으면 null.
  const remaining = sentAt === null ? null : Math.max(0, Math.ceil((sentAt + CODE_TTL_MS - now) / 1000));
  const expired = remaining === 0;

  useEffect(() => {
    if (view === 'credentials') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  function changeView(next: View) {
    setView(next); setError(''); setMessage(''); setPassword(''); setCode(''); setSentAt(null); setNow(Date.now());
    setPasswordConfirmation(''); setSignupAttempted(false); setWrongCode(false);
  }

  function changeEmail(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    setEmailTypeMismatch(event.target.validity.typeMismatch);
    setMessage('');
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    if (confirming) {
      if (expired || (sentAt !== null && Date.now() >= sentAt + CODE_TTL_MS)) { void resend(); return; }
      if (code.length !== CODE_LENGTH) return;
    }
    if (signingUp) {
      setSignupAttempted(true);
      setError('');
      if (!signupValid) return;
    }
    if (webSignIn && (!emailValid || !password)) {
      setError(INVALID_LOGIN_CREDENTIALS_MESSAGE);
      return;
    }
    const trimmedEmail = email.trim();
    if (!isValidAuthEmail(trimmedEmail) || (webReset && emailTypeMismatch)) {
      setError("이메일 주소를 다시 확인해주세요."); return;
    }
    if (view === 'reset' && emailWaitSeconds(kind, email) > 0) return;
    pending.current = true;
    setError(''); setMessage(''); setWrongCode(false); setSubmitting(true);
    try {
      if (view === 'reset') {
        await resetPassword(trimmedEmail);
        setMessage('재설정 메일을 요청했습니다. 가입한 이메일이라면 메일함과 스팸함을 확인해주세요.');
      } else if (view === 'confirmation') {
        await verifySignupCode(trimmedEmail, code);
        onAuthenticated();
      } else if (mode === 'signIn') {
        await signIn(trimmedEmail, password);
        onAuthenticated();
      } else {
        const result = await signUp(trimmedEmail, password);
        if (result.needsEmailConfirmation) {
          changeView('confirmation');
          setSentAt(Date.now());
        } else onAuthenticated();
      }
    } catch (err) {
      if (err instanceof AuthActionError && err.code === 'email_not_confirmed') {
        changeView('confirmation');
        return;
      }
      const fallback = view === 'reset' ? '재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.'
        : view === 'confirmation' ? '인증하지 못했어요. 인증번호를 확인하고 다시 시도해주세요.'
        : mode === 'signUp' ? '회원가입을 완료하지 못했어요. 입력한 정보를 확인하고 다시 시도해주세요.'
        : '로그인하지 못했어요. 입력한 정보를 확인하고 다시 시도해주세요.';
      // Supabase는 틀린 번호와 만료된 번호 모두 otp_expired로 응답한다.
      if (confirming && err && typeof err === 'object' && 'code' in err && err.code === 'otp_expired') {
        setWrongCode(true);
      } else {
        setError(authErrorMessage(err, fallback));
      }
    } finally {
      pending.current = false; setSubmitting(false); setNow(Date.now());
    }
  };

  const resend = async () => {
    if (pending.current || emailWaitSeconds(kind, email) > 0) return;
    const trimmedEmail = email.trim();
    if (!isValidAuthEmail(trimmedEmail)) {
      setError("이메일 주소를 다시 확인해주세요."); return;
    }
    pending.current = true;
    setError(''); setMessage(''); setWrongCode(false); setSubmitting(true);
    try {
      await resendConfirmation(trimmedEmail);
      setCode(''); setSentAt(Date.now());
      setMessage('새 인증번호를 보냈어요.');
    } catch (err) {
      setError(authErrorMessage(err, '인증 메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.'));
    } finally {
      pending.current = false; setSubmitting(false); setNow(Date.now());
    }
  };

  const title = view === 'reset' ? '비밀번호 찾기' : view === 'confirmation' ? '이메일 인증' : mode === 'signIn' ? '로그인' : '회원가입';
  const buttonLabel = view === 'reset' ? '재설정 메일 보내기' : confirming ? (expired ? '인증번호 다시 받기' : '인증하기') : signingUp ? '다음' : title;
  const compactCredentials = compact && view === 'credentials';
  const codeError = wrongCode && !expired;
  const confirmationNotice = error || (expired ? '인증번호가 만료되었습니다. 새 인증번호를 받아 주세요.'
    : codeError ? '인증번호가 일치하지 않습니다. 다시 확인해주세요.' : message);
  const submitDisabled = submitting || (view === 'reset' && wait > 0)
    || (confirming && (expired ? wait > 0 : code.length < CODE_LENGTH));

  return (
    <div className={compact ? 'mini-stage' : 'auth-overlay'}
      style={compact ? undefined : { position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box', background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(6px)' }}>
      <form onSubmit={handleSubmit} noValidate={signingUp || webSignIn || webReset} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        aria-describedby={webSignIn && subtitle ? `${id}-description` : undefined}
        className={[compact ? 'mini-login-card' : 'auth-dialog', confirming ? 'auth-confirmation' : '', signingUp ? 'auth-signup' : '', webReset ? 'auth-recovery' : ''].filter(Boolean).join(' ')}
        onKeyDown={compact ? (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (!pending.current) onClose();
        } : undefined}>
        <div className={compact ? 'mini-login-heading' : 'auth-dialog-heading'}>
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {confirming ? <p className="auth-confirmation-description">
              {email.trim()} 으로 {sentAt === null ? '받은 인증번호를 입력해 주세요.' : '인증번호를 보냈어요.'}<br />
              메일이 안 보이면 스팸함을 확인해주세요.
            </p> : webReset ? (
              <p className="auth-recovery-description" role={message ? 'status' : undefined}>
                {message ? <>가입한 이메일이라면 재설정 링크를 보냈어요.<br />메일이 안 보이면 스팸함을 확인해 주세요.</>
                  : '가입한 이메일로 비밀번호 재설정 링크를 보내드려요.'}
              </p>
            ) : webSignIn ? (subtitle && <p id={`${id}-description`} className="sr-only">{subtitle}</p>)
              : !signingUp && <p>{resetting ? '가입한 이메일로 재설정 링크를 받으세요' : subtitle ?? '계정에 로그인하세요'}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="닫기"
            className={compact ? 'mini-login-close' : 'auth-dialog-close'}>
            {compact ? <img src={closeIcon} alt="" /> : '✕'}
          </button>
        </div>
        {signingUp && <div className="auth-credential-fields">
          <div className={compact ? 'mini-login-field' : undefined}>
            <input id={`${id}-email`} className="auth-credential-input" type="email" aria-label="이메일"
              aria-invalid={!!emailError} aria-describedby={emailError ? `${id}-email-error` : undefined}
              placeholder="이메일" autoComplete="email" autoFocus={compact} required disabled={submitting}
              value={email} onChange={changeEmail} />
            {emailError && <p id={`${id}-email-error`} className="auth-signup-hint" role="alert">{emailError}</p>}
          </div>
          <SignupPasswordField id={`${id}-password`} label="비밀번호" value={password} onChange={setPassword}
            hint="8자 이상" valid={passwordValid} compact={compact} disabled={submitting}
            error={signupAttempted && !passwordValid ? '비밀번호를 8자 이상 입력해주세요.' : ''} />
          <SignupPasswordField id={`${id}-password-confirmation`} label="비밀번호 확인" value={passwordConfirmation}
            onChange={setPasswordConfirmation} hint="비밀번호 일치" valid={passwordsMatch && passwordValid}
            compact={compact} disabled={submitting}
            error={signupAttempted && !passwordsMatch ? '비밀번호가 일치하지 않아요.' : ''} />
        </div>}
        {webSignIn && <div className="auth-credential-fields">
          <input id={`${id}-email`} className="auth-credential-input" type="email" aria-label="이메일"
            placeholder="이메일" autoComplete="email" required disabled={submitting} value={email} onChange={changeEmail} />
          <PasswordControl id={`${id}-password`} label="비밀번호" value={password} onChange={setPassword}
            autoComplete="current-password" disabled={submitting} />
          <button type="button" className="auth-login-reset" disabled={submitting} onClick={() => changeView('reset')}>
            비밀번호를 잊으셨나요?
          </button>
        </div>}
        {webReset && <input id={`${id}-email`} className="auth-credential-input" type="email" aria-label="이메일"
          placeholder="이메일" autoComplete="email" required disabled={submitting} value={email} onChange={changeEmail} />}
        {compact && !confirming && !signingUp && <div className="mini-login-field">
          <label htmlFor={`${id}-email`}>이메일</label>
          <input id={`${id}-email`} type="email" value={email} disabled={submitting} required autoComplete="email" autoFocus={compact}
            onChange={changeEmail} placeholder="이메일을 입력하세요" />
        </div>}
        {compactCredentials && !signingUp && <div className="mini-login-field">
          <label htmlFor={`${id}-password`}>비밀번호</label>
          <input id={`${id}-password`} type="password" value={password} disabled={submitting} required
            onChange={event => setPassword(event.target.value)}
            placeholder="비밀번호를 입력하세요" autoComplete="current-password" minLength={1} />
        </div>}
        {compactCredentials && <button type="button" className="mini-login-reset" disabled={submitting} onClick={() => changeView('reset')}>비밀번호를 잊으셨나요?</button>}
        {confirming && <>
          {/* 실제 입력은 투명한 input 하나가 받고(붙여넣기·문자 자동완성 지원), 6칸은 보여주기만 한다. */}
          <div className="auth-code-cells" data-expired={expired} data-invalid={codeError}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => {
              const active = codeFocus && !expired && i === Math.min(code.length, CODE_LENGTH - 1);
              return (
                <div key={i} aria-hidden="true" className="auth-code-cell" data-active={active}>
                  {code[i] ?? (active && <span className="auth-code-caret" />)}
                </div>
              );
            })}
            <input key={sentAt} id={`${id}-code`} aria-label={`인증번호 ${CODE_LENGTH}자리`} value={code} disabled={submitting || expired} autoFocus
              aria-invalid={codeError} aria-describedby={confirmationNotice ? `${id}-confirmation-notice` : undefined}
              inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH}
              onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)); setError(''); setWrongCode(false); }}
              onFocus={() => setCodeFocus(true)} onBlur={() => setCodeFocus(false)}
              style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, fontSize: 16, border: 'none', cursor: 'text' }} />
          </div>
          {(remaining !== null || confirmationNotice) && <div className="auth-confirmation-status">
            {remaining !== null && <p className="auth-code-timer">
              남은 시간 <strong>{pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}</strong>
            </p>}
            {confirmationNotice && <p id={`${id}-confirmation-notice`} role={error || codeError ? 'alert' : 'status'}
              data-danger={!!error || codeError || expired}>
              {confirmationNotice}
            </p>}
          </div>}
        </>}
        {compact && resetting && message && <p role="status" style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>{message}</p>}
        {!confirming && error && <p role="alert" className="auth-form-error">{error}</p>}
        <button type="submit" disabled={submitDisabled}
          className={compact ? 'mini-login-submit' : 'auth-dialog-submit'}
          data-cooldown={webReset && wait > 0}
          data-incomplete={signingUp ? !signupValid : confirming && !expired && !submitting && code.length < CODE_LENGTH}>
          {submitting ? '처리 중...' : view === 'reset' && wait > 0 ? `${wait}초 후 재전송 가능` : buttonLabel}
        </button>
        {!(confirming && expired) && <div className={compact ? 'mini-login-footer' : 'auth-dialog-footer'}>
          {view === 'credentials' ? <>
            <span>{signingUp ? '이미 계정이 있나요?' : webSignIn && error ? '계정이 없나요?' : '처음이신가요?'}</span>
            <button type="button" disabled={submitting} onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); changeView('credentials'); }}>
              {mode === 'signIn' ? '회원가입' : '로그인'}
            </button>
          </> : confirming ? <p className="auth-confirmation-resend">
            메일을 받지 못했나요?{' '}
            {wait > 0
              ? <span>{Math.floor(wait / 60)}:{pad(wait % 60)} 후 재전송 가능</span>
              : <button type="button" disabled={submitting} onClick={resend}>인증번호 재전송</button>}
          </p> : (
            <button type="button" className={webReset ? 'auth-recovery-link' : undefined} disabled={submitting} onClick={() => { setMode('signIn'); changeView('credentials'); }}>로그인으로 돌아가기</button>
          )}
        </div>}
        {!compact && signingUp && <LegalLinks signup onNavigate={onClose} />}
      </form>
    </div>
  );
}
