import { Card } from "../common";

type MaterialDeleteConfirmModalProps = {
  // 단일 삭제는 materialName, 선택(일괄) 삭제는 materialCount를 넘긴다(materialCount가 있으면 일괄 모드).
  materialName?: string;
  materialCount?: number;
  summaryCount: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

// 자료 삭제 확인 모달. 요약 페이지(자료 목록·자료 상세)와 대시보드 강의자료 목록이 공유한다.
// Storage 원본까지 지워져 되돌릴 수 없으므로 토스트 되돌리기 대신 사전 확인을 받는다.
export const MaterialDeleteConfirmModal = ({ materialName, materialCount, summaryCount, busy, error, onCancel, onConfirm }: MaterialDeleteConfirmModalProps) => {
  const isBulk = typeof materialCount === "number";
  const summaryPhrase = summaryCount > 0 ? `요약 ${summaryCount}개, ` : "";
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div onClick={event => event.stopPropagation()} style={{ width: "min(380px, 100%)" }}>
        <Card style={{ padding: 28 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text-strong)" }}>
            {isBulk ? "선택한 자료를 삭제할까요?" : "자료를 삭제할까요?"}
          </h3>
          <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
            {isBulk
              ? `선택한 자료 ${materialCount}개와 이 자료들로 만든 ${summaryPhrase}AI 튜터 대화가 함께 삭제됩니다. 퀴즈와 풀이 기록은 남습니다. 삭제 후에는 되돌릴 수 없습니다.`
              : `'${materialName}' 자료와 이 자료로 만든 ${summaryPhrase}AI 튜터 대화가 함께 삭제됩니다. 퀴즈와 풀이 기록은 남습니다. 삭제 후에는 되돌릴 수 없습니다.`}
          </p>
          {error && (
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-danger)", fontWeight: 700, lineHeight: 1.5 }}>{error}</p>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-text)", cursor: busy ? "default" : "pointer", fontSize: 14 }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: busy ? "var(--color-muted-surface)" : "light-dark(#4b5563, #5b6473)", color: "var(--color-on-brand)", cursor: busy ? "default" : "pointer", fontSize: 14, fontWeight: 700 }}
            >
              {busy ? "삭제 중" : "삭제"}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};
