import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from './components/ui';

type ToastType = "success" | "error" | "info";
// action이 있으면 토스트 안에 버튼을 함께 보여준다(예: 삭제 직후 "되돌리기").
type ToastAction = { label: string; onAction: () => void };
type ToastOptions = { action?: ToastAction; duration?: number };
type Toast = { id: number; message: string; type: ToastType; action?: ToastAction };

type ToastContextValue = {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = "info", options?: ToastOptions) => {
    if (!message.trim()) return;
    const id = ++seq.current;
    setToasts(prev => [...prev, { id, message, type, action: options?.action }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, options?.duration ?? TOAST_DURATION);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "center",
          pointerEvents: "none",
          width: "min(420px, calc(100vw - 32px))",
        }}
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`ui-alert ui-alert--${toast.type}`}
            style={{
              pointerEvents: "auto",
              maxWidth: "100%",
              padding: "12px 18px",
              borderRadius: 12,
              boxShadow: "var(--shadow-card)",
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.5,
              wordBreak: "break-word",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <strong className="ui-alert-label">{toast.type === 'error' ? '오류' : toast.type === 'success' ? '완료' : '안내'}</strong>
            <span style={{ minWidth: 0 }}>{toast.message}</span>
            {toast.action && (
              <Button variant="ghost" size="sm"
                type="button"
                className="tongkk-hover-dim"
                onClick={() => {
                  toast.action?.onAction();
                  setToasts(prev => prev.filter(item => item.id !== toast.id));
                }}
                style={{
                  flexShrink: 0,
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
};
