import { useId, type ComponentProps, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  tone?: 'pink' | 'cyan';
  size?: 'sm' | 'md';
  busy?: boolean;
};

export function Button({ variant = 'secondary', tone = 'pink', size = 'md', busy = false, disabled, className = '', children, type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type === 'submit' ? 'submit' : type === 'reset' ? 'reset' : 'button'} disabled={disabled || busy} aria-busy={busy || props['aria-busy']}
    className={`ui-button ui-button--${variant} ui-button--${tone} ui-button--${size} ${className}`.trim()}>{children}</button>;
}

type FieldProps = { label: string; hint?: string; error?: string };

export function TextField({ label, hint, error, id: providedId, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const description = [props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="ui-field"><label htmlFor={id}>{label}</label>
    <input {...props} id={id} className={`ui-input ${className}`} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={description} />
    {hint && <p id={`${id}-hint`} className="ui-field-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="ui-field-error" role="alert">{error}</p>}
  </div>;
}

export function TextAreaField({ label, hint, error, id: providedId, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const description = [props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="ui-field"><label htmlFor={id}>{label}</label>
    <textarea {...props} id={id} className={`ui-input ${className}`} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={description} />
    {hint && <p id={`${id}-hint`} className="ui-field-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="ui-field-error" role="alert">{error}</p>}
  </div>;
}

const alertLabels = { error: '오류', success: '완료', info: '안내' } as const;
export function InlineAlert({ tone = 'info', children, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof alertLabels }) {
  return <div {...props} role={tone === 'error' ? 'alert' : 'status'} className={`ui-alert ui-alert--${tone} ${className}`.trim()}>
    <strong className="ui-alert-label">{alertLabels[tone]}</strong><div className="ui-alert-content">{children}</div>
  </div>;
}

export function PageHeading({ title, description, actions, className = '', ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { title: string; description?: ReactNode; actions?: ReactNode }) {
  return <div {...props} className={`ui-page-heading ${className}`.trim()}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="ui-actions">{actions}</div>}</div>;
}
