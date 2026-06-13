import { useState } from "react";
import { CARD_BACKGROUND, BORDER_COLOR, MUTED_SURFACE, PINK } from "../common";
import type { TutorialConfig } from "../tutorialContent";

// 튜토리얼 표현 컴포넌트. STEP n/N 페이저로 한 장씩 보여준다.
// 규칙: 흰 배경 + 사방 중립 테두리(왼쪽 색상 띠 금지), 색은 var(--color-*) 토큰만.
// placement=modal은 중앙 카드(welcome), sheet는 화면을 가리지 않는 우하단 안내 시트(기본).
type SheetAction = { label: string; onClick: () => void };

export function TutorialSheet({
  config,
  primaryAction,
  secondaryAction,
  onClose,
}: {
  config: TutorialConfig;
  primaryAction?: SheetAction;
  secondaryAction?: SheetAction;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const total = config.steps.length;
  const isLast = step === total - 1;
  const current = config.steps[step];
  const isModal = config.placement === "modal";

  const advance = () => {
    if (!isLast) {
      setStep(s => s + 1);
    } else if (primaryAction) {
      primaryAction.onClick();
    } else {
      onClose();
    }
  };

  const card = (
    <div
      role={isModal ? "dialog" : "region"}
      aria-modal={isModal ? true : undefined}
      aria-label={`${config.title} 사용법`}
      onClick={e => e.stopPropagation()}
      style={{
        width: isModal ? "min(380px, 100%)" : "min(360px, calc(100vw - 40px))",
        background: CARD_BACKGROUND,
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: isModal ? 20 : 16,
        padding: isModal ? "30px 30px 26px" : "18px 18px 16px",
        boxShadow: "0 18px 48px rgba(15, 23, 42, 0.14)",
        boxSizing: "border-box",
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-muted)", letterSpacing: 0.4 }}>
          {total > 1 ? `STEP ${step + 1}/${total}` : config.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="튜토리얼 닫기"
          style={{ background: "none", border: "none", fontSize: 12, color: "var(--color-muted)", cursor: "pointer", padding: 0 }}
        >
          {isModal ? "건너뛰기" : "✕"}
        </button>
      </div>

      <h2 style={{ margin: "0 0 8px", fontSize: isModal ? 19 : 16, fontWeight: 700, color: "var(--color-text-strong)" }}>
        {current.title}
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.65, color: "var(--color-text-secondary)" }}>
        {current.body}
      </p>

      {total > 1 && (
        <div style={{ display: "flex", justifyContent: isModal ? "center" : "flex-start", gap: 6, marginBottom: 16 }}>
          {config.steps.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === step ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: i === step ? PINK : "var(--color-border)",
                transition: "width 0.2s, background 0.2s",
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 12,
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
          onClick={advance}
          style={{
            flex: 2,
            padding: "11px 0",
            borderRadius: 12,
            border: "none",
            background: PINK,
            color: "var(--color-on-brand)",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {isLast ? (primaryAction ? primaryAction.label : "완료") : "다음"}
        </button>
      </div>

      {secondaryAction && (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          style={{
            display: "block",
            width: "100%",
            marginTop: 12,
            background: "none",
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-muted)",
            cursor: "pointer",
            padding: 0,
            textAlign: "center",
          }}
        >
          {secondaryAction.label}
        </button>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 350,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(15, 23, 42, 0.2)",
          backdropFilter: "blur(6px)",
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        {card}
      </div>
    );
  }

  // 비강압 시트 — 백드롭 없이 우하단 고정. body로 portal되어 #root의 zoom 좌표 영향을 받지 않는다.
  return <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 350 }}>{card}</div>;
}
