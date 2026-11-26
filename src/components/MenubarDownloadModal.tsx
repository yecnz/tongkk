import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CARD_BACKGROUND, BORDER_COLOR, MENUBAR_DMG_URL, PINK } from "../common";

const STEPS = ["Tongkk.dmg 열기", "Tongkk를 응용 프로그램 폴더로 끌어다 놓기", "메뉴바의 통크크 아이콘을 눌러 로그인"];
// 앱이 Apple 공증 전이라 첫 실행 때 macOS가 막는다. 15부터는 우클릭 → 열기가 통하지 않는다.
const UNBLOCK = [
  ["macOS 15 이상", "시스템 설정 > 개인정보 보호 및 보안 > 그래도 열기"],
  ["macOS 14 이하", "앱 우클릭 > 열기"],
];

// 사이드바 "메뉴바 앱 받기"를 누르면 다운로드와 함께 뜨는 설치 안내. ✕·바깥 클릭·Esc로 닫는다.
export const MenubarDownloadModal = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="menubar-download-title"
        onClick={event => event.stopPropagation()}
        style={{ width: "min(440px, 100%)", padding: "32px 32px 28px", borderRadius: 20, background: CARD_BACKGROUND, boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h3 id="menubar-download-title" style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--color-text-strong)" }}>다운로드를 시작했어요</h3>
          <button type="button" onClick={onClose} aria-label="닫기" className="tongkk-hover-dim" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 16, color: "var(--color-muted)" }}>✕</button>
        </div>
        <p style={{ margin: "6px 0 20px", fontSize: 14, fontWeight: 500, color: "var(--color-muted)" }}>
          Tongkk.dmg 다운로드가 끝나면 아래 순서대로 설치해 주세요.
        </p>

        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
          {STEPS.map((step, i) => (
            <li key={step} style={{ display: "flex", gap: 8, fontSize: 14, fontWeight: 500, color: "var(--color-text-strong)" }}>
              <span style={{ color: PINK, fontWeight: 700 }}>{i + 1}.</span>{step}
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${BORDER_COLOR}` }}>
          <p style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "var(--color-text-strong)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={PINK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 9v4m0 3.5v.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            앱이 열리지 않는다면
          </p>
          {UNBLOCK.map(([os, how]) => (
            <p key={os} style={{ margin: "6px 0 0", display: "flex", gap: 10, fontSize: 13, fontWeight: 500, color: "var(--color-text-strong)" }}>
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>{os}</span>{how}
            </p>
          ))}
        </div>

        <p style={{ margin: "20px 0 0", textAlign: "center", fontSize: 13, color: "var(--color-muted)" }}>
          다운로드가 안 되나요?{" "}
          <a href={MENUBAR_DMG_URL} download style={{ marginLeft: 4, fontWeight: 700, color: "var(--color-text-strong)", textDecoration: "none" }}>다시 받기</a>
        </p>
      </div>
    </div>,
    document.body,
  );
};
