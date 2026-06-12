import { useEffect, useState, type ReactNode } from "react";
import { PINK, CARD_BACKGROUND, BORDER_COLOR, MUTED_SURFACE } from "../common";
import { useAuth } from "../AuthContext";
import { useAuthGate } from "../AuthGateContext";

const ONBOARDING_SHOWN_KEY = "tongkk-onboarding-shown";

type Step = {
  title: string;
  description: string;
  icon: ReactNode;
};

const iconWrap = (children: ReactNode) => (
  <div style={{
    width: 64,
    height: 64,
    borderRadius: 20,
    background: MUTED_SURFACE,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 20px",
  }}>
    {children}
  </div>
);

const STEPS: Step[] = [
  {
    title: "강의 추가",
    description: "과목을 만들어 강의자료를 한곳에 모아요.",
    icon: iconWrap(
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-pink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M12 8h4M12 12h4" />
      </svg>
    ),
  },
  {
    title: "자료 업로드",
    description: "PDF·PPT·이미지·텍스트를 올리면 AI가 읽어요.",
    icon: iconWrap(
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-cyan)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    title: "AI 요약",
    description: "강의 노트·치트시트·마인드맵으로 자동 요약돼요.",
    icon: iconWrap(
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-pink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
        <path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z" />
      </svg>
    ),
  },
  {
    title: "퀴즈·복습",
    description: "퀴즈를 풀고 오답 노트와 학습 통계로 복습해요.",
    icon: iconWrap(
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-cyan)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3 8-8" />
        <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
];

function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { openLogin } = useAuthGate();
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 280,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(15,23,42,0.2)",
      backdropFilter: "blur(6px)",
      padding: 24,
      boxSizing: "border-box",
    }}>
      <div style={{
        width: "min(380px, 100%)",
        background: CARD_BACKGROUND,
        borderRadius: 20,
        padding: "32px 32px 28px",
        border: `1px solid ${BORDER_COLOR}`,
        boxShadow: "0 18px 48px rgba(15, 23, 42, 0.09)",
        boxSizing: "border-box",
        textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: PINK }}>Tongkk</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 12,
              color: "var(--color-muted)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            건너뛰기
          </button>
        </div>

        {current.icon}
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-muted)", letterSpacing: 0.5, marginBottom: 6 }}>
          STEP {step + 1}/{STEPS.length}
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 600, color: "var(--color-text-strong)" }}>
          {current.title}
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
          {current.description}
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24 }}>
          {STEPS.map((_, index) => (
            <span
              key={index}
              style={{
                width: index === step ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: index === step ? PINK : "var(--color-border)",
                transition: "width 0.2s, background 0.2s",
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              style={{
                flex: 1,
                padding: "13px 0",
                borderRadius: 14,
                border: `1px solid ${BORDER_COLOR}`,
                background: MUTED_SURFACE,
                color: "var(--color-text-secondary)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              이전
            </button>
          )}
          <button
            type="button"
            onClick={() => (isLast ? onClose() : setStep(step + 1))}
            style={{
              flex: 2,
              padding: "13px 0",
              borderRadius: 14,
              border: "none",
              background: PINK,
              color: "var(--color-on-brand)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isLast ? "시작하기" : "다음"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            openLogin("signIn");
          }}
          style={{
            background: "none",
            border: "none",
            fontSize: 12,
            color: "var(--color-muted)",
            cursor: "pointer",
            padding: 0,
            marginTop: 18,
          }}
        >
          이미 계정이 있나요? 로그인
        </button>
      </div>
    </div>
  );
}

// 비로그인 첫 방문자에게 온보딩을 1회 노출한다. 본 적 여부는 닫는 행동(시작하기/건너뛰기/로그인)
// 시점에 기록해 StrictMode 이중 마운트에도 안전하다.
export function OnboardingGate() {
  const { user, loading } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (loading || user) return;
    if (!localStorage.getItem(ONBOARDING_SHOWN_KEY)) setShow(true);
  }, [loading, user]);

  if (!show || user) return null;

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_SHOWN_KEY, "1");
    setShow(false);
  };

  return <OnboardingModal onClose={dismiss} />;
}
