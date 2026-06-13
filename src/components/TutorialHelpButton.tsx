import type { CSSProperties } from "react";
import { BORDER_COLOR } from "../common";
import { useTutorial } from "../TutorialContext";
import type { TutorialKey } from "../tutorialContent";

// 페이지 헤더의 상시 '?' 재열람 버튼. 이 화면의 튜토리얼을 처음부터 다시 연다('본 적 있음'은 유지).
export function TutorialHelpButton({ tutorialKey, style }: { tutorialKey: TutorialKey; style?: CSSProperties }) {
  const { open } = useTutorial();
  return (
    <button
      type="button"
      className="tongkk-hover-dim"
      onClick={() => open(tutorialKey)}
      aria-label="이 화면 사용법 보기"
      title="사용법 보기"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: `1px solid ${BORDER_COLOR}`,
        background: "var(--color-card)",
        color: "var(--color-text-secondary)",
        fontSize: 15,
        fontWeight: 800,
        cursor: "pointer",
        flexShrink: 0,
        ...style,
      }}
    >
      ?
    </button>
  );
}
