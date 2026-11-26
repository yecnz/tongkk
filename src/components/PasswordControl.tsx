import { useState } from "react";
import visibilityIcon from "../assets/auth/visibility.svg";
import visibilityOffIcon from "../assets/auth/visibility-off.svg";

export type PasswordControlProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  invalid?: boolean;
  describedBy?: string;
};

export default function PasswordControl({ id, label, value, onChange, autoComplete, disabled, invalid, describedBy }: PasswordControlProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password-control">
      <input id={id} className="auth-credential-input" type={visible ? 'text' : 'password'}
        aria-label={label} aria-invalid={invalid} aria-describedby={describedBy}
        placeholder={label} autoComplete={autoComplete} required disabled={disabled}
        value={value} onChange={event => onChange(event.target.value)} />
      <button type="button" aria-label={label + (visible ? ' 숨기기' : ' 보기')}
        aria-controls={id} disabled={disabled} onClick={() => setVisible(!visible)}>
        <img src={visible ? visibilityIcon : visibilityOffIcon} alt="" width={20} height={20} />
      </button>
    </div>
  );
}
