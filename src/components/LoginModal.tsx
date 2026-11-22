import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { PINK, CYAN, CARD_BACKGROUND, BORDER_COLOR, MUTED_SURFACE } from "../common";
import { useAuth } from "../AuthContext";
import { AuthActionError, authErrorMessage, isValidAuthEmail } from "../services/authFlow";
import { emailWaitSeconds } from "../services/authEmails";

export type AuthMode = "signIn" | "signUp";
type View = 'credentials' | 'reset' | 'confirmation';
type LoginModalProps = {
  onClose: () => void;
  initialMode?: AuthMode;
  initialView?: 'credentials' | 'reset';
  subtitle?: string;
};

const inputStyle = (focused: boolean): CSSProperties => ({
  width: "100%", padding: "13px 16px", borderRadius: 12,
  border: `1.5px solid ${focused ? CYAN : BORDER_COLOR}`, fontSize: 14, outline: "none",
  boxSizing: "border-box", background: focused ? "rgba(0,192,232,0.04)" : MUTED_SURFACE,
  transition: "border 0.2s, background 0.2s", color: "var(--color-text-strong)",
});
const linkStyle: CSSProperties = {
  background: "none", border: "none", fontSize: 12, color: "var(--color-muted)", cursor: "pointer", padding: 0,
};
const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, display: "block",
};

export default function LoginModal({ onClose, initialMode = "signIn", initialView = 'credentials', subtitle }: LoginModalProps) {
  const { signIn, signUp, resetPassword, resendConfirmation } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [view, setView] = useState<View>(initialView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocus, setEmailFocus] = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const [now, setNow] = useState(Date.now);
  const id = useId();
  const kind = view === 'reset' ? 'reset' : 'signup';
  const wait = emailWaitSeconds(kind, email, now);

  useEffect(() => {
    if (view === 'credentials') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  function changeView(next: View) {
    setView(next); setError(''); setMessage(''); setPassword(''); setNow(Date.now());
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const trimmedEmail = email.trim();
    if (!isValidAuthEmail(trimmedEmail)) {
      setError("이메일 형식이 올바르지 않아요. 예: name@example.com"); return;
    }
    if (view === 'credentials' && mode === 'signUp' && password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요."); return;
    }
    if (view !== 'credentials' && emailWaitSeconds(kind, email) > 0) return;
    pending.current = true;
    setError(''); setMessage(''); setSubmitting(true);
    try {
      if (view === 'reset') {
        await resetPassword(trimmedEmail);
        setMessage('재설정 메일을 요청했습니다. 가입한 이메일이라면 메일함과 스팸함을 확인해주세요.');
      } else if (view === 'confirmation') {
        await resendConfirmation(trimmedEmail);
        setMessage('가입 확인 메일을 요청했습니다. 메일함과 스팸함을 확인해주세요.');
      } else if (mode === 'signIn') {
        await signIn(trimmedEmail, password);
        onClose();
      } else {
        const result = await signUp(trimmedEmail, password);
        if (result.needsEmailConfirmation) {
          changeView('confirmation');
          setMessage('가입 확인이 필요합니다. 메일함에서 인증 링크를 눌러주세요. 이미 가입했다면 로그인 또는 비밀번호 찾기를 이용해주세요.');
        } else onClose();
      }
    } catch (err) {
      if (err instanceof AuthActionError && err.code === 'email_not_confirmed') changeView('confirmation');
      const fallback = view === 'reset' ? '재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.'
        : view === 'confirmation' ? '인증 메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.'
        : mode === 'signUp' ? '회원가입을 완료하지 못했어요. 입력한 정보를 확인하고 다시 시도해주세요.'
        : '로그인하지 못했어요. 입력한 정보를 확인하고 다시 시도해주세요.';
      setError(authErrorMessage(err, fallback));
    } finally {
      pending.current = false; setSubmitting(false); setNow(Date.now());
    }
  };

  const title = view === 'reset' ? '비밀번호 찾기' : view === 'confirmation' ? '이메일 인증' : mode === 'signIn' ? '로그인' : '회원가입';
  const buttonLabel = view === 'reset' ? '재설정 메일 보내기' : view === 'confirmation' ? '인증 메일 다시 보내기' : title;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(6px)', padding: 24, boxSizing: 'border-box' }}>
      <form onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        style={{ width: 'min(380px, 100%)', maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', background: CARD_BACKGROUND,
          borderRadius: 20, padding: '36px 32px', border: `1px solid ${BORDER_COLOR}`, boxShadow: '0 18px 48px rgba(15,23,42,0.09)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h2 id={`${id}-title`} style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 500, color: 'var(--color-text-strong)' }}>{title}</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {view === 'reset' ? '가입한 이메일로 재설정 링크를 받으세요' : view === 'confirmation' ? '메일의 링크로 가입을 확인해주세요' : subtitle ?? (mode === 'signIn' ? '계정에 로그인하세요' : '계정을 생성하세요')}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="닫기"
            style={{ ...linkStyle, fontSize: 18, padding: 8 }}>✕</button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label htmlFor={`${id}-email`} style={labelStyle}>이메일</label>
          <input id={`${id}-email`} type="email" value={email} disabled={submitting} required autoComplete="email"
            onChange={event => { setEmail(event.target.value); setMessage(''); }}
            onFocus={() => setEmailFocus(true)} onBlur={() => setEmailFocus(false)} placeholder="이메일을 입력하세요" style={inputStyle(emailFocus)} />
        </div>
        {view === 'credentials' && <div style={{ marginBottom: 24 }}>
          <label htmlFor={`${id}-password`} style={labelStyle}>비밀번호</label>
          <input id={`${id}-password`} type="password" value={password} disabled={submitting} required
            onChange={event => setPassword(event.target.value)} onFocus={() => setPasswordFocus(true)} onBlur={() => setPasswordFocus(false)}
            placeholder="비밀번호를 입력하세요" autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            minLength={mode === 'signUp' ? 8 : 1} style={inputStyle(passwordFocus)} />
        </div>}
        {message && <p role="status" style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>{message}</p>}
        {error && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 12, lineHeight: 1.5 }}>{error}</p>}
        <button type="submit" disabled={submitting || view !== 'credentials' && wait > 0}
          style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: PINK,
            color: 'var(--color-on-brand)', fontSize: 15, fontWeight: 600, cursor: submitting ? 'default' : 'pointer', margin: '8px 0 16px' }}>
          {submitting ? '처리 중...' : view !== 'credentials' && wait > 0 ? `${wait}초 후 재전송 가능` : buttonLabel}
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
          {view === 'credentials' ? <>
            <button type="button" disabled={submitting} onClick={() => changeView('reset')} style={linkStyle}>비밀번호 찾기</button>
            <button type="button" disabled={submitting} onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); changeView('credentials'); }} style={linkStyle}>
              {mode === 'signIn' ? '회원가입' : '로그인'}
            </button>
          </> : <>
            <button type="button" disabled={submitting} onClick={() => { setMode('signIn'); changeView('credentials'); }} style={linkStyle}>로그인으로 돌아가기</button>
            {view === 'confirmation' && <button type="button" disabled={submitting} onClick={() => changeView('reset')} style={linkStyle}>비밀번호 찾기</button>}
          </>}
        </div>
      </form>
    </div>
  );
}
