import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; message: string; type: ToastType };

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    if (!message.trim()) return;
    const id = ++seq.current;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, TOAST_DURATION);
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
            role="status"
            style={{
              pointerEvents: "auto",
              maxWidth: "100%",
              padding: "12px 18px",
              borderRadius: 12,
              background: "var(--color-card)",
              border: "1px solid var(--color-border-soft)",
              boxShadow: "var(--shadow-card)",
              color: "var(--color-text-strong)",
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {toast.message}
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
