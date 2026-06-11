import { useEffect, useState } from "react";
import { PINK } from "./common";

// 배포 후 새 버전 감지: /version.json을 주기적으로 받아 현재 번들(__BUILD_ID__)과 비교한다.
// 다르면 "새 버전이 있어요" 배너를 띄우고, 사용자가 직접 새로고침하도록 한다(작업 중 데이터 보호를 위해 자동 리로드는 하지 않음).
const POLL_INTERVAL_MS = 60_000; // 1분마다 확인

export default function UpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    // 개발 모드에는 version.json이 없으므로 동작하지 않는다(배포 환경에서만).
    if (!import.meta.env.PROD) return;
    let stopped = false;

    const check = async () => {
      try {
        // 캐시를 우회해 항상 최신 버전을 받는다(쿼리 무력화 + no-store).
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (!stopped && data.buildId && data.buildId !== __BUILD_ID__) {
          setUpdateAvailable(true);
        }
      } catch {
        // 네트워크 일시 오류는 무시하고 다음 주기에 다시 확인한다.
      }
    };

    const interval = window.setInterval(check, POLL_INTERVAL_MS);
    // 탭을 다시 보거나 포커스할 때도 즉시 확인(오래 열어둔 탭 대응).
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    void check(); // 마운트 직후 1회

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        gap: 14,
        maxWidth: "calc(100vw - 32px)",
        padding: "12px 14px 12px 18px",
        borderRadius: 12,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
        color: "var(--color-text-strong)",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      <span>새 버전이 있어요.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 16px",
          borderRadius: 9,
          border: "none",
          background: PINK,
          color: "var(--color-on-brand)",
          fontSize: 13,
          fontWeight: 800,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        새로고침
      </button>
    </div>
  );
}
