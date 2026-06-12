import { useState } from "react";
import { Navigate } from "react-router-dom";
import { PINK, CARD_BACKGROUND, PAGE_BACKGROUND, BORDER_COLOR, SOFT_SHADOW } from "../common";
import { useAuth } from "../AuthContext";
import LoginModal, { type AuthMode } from "../components/LoginModal";

export default function Auth() {
  const { user, loading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signIn");

  if (!loading && user) return <Navigate to="/" replace />;

  const openModal = (nextMode: AuthMode = "signIn") => {
    setMode(nextMode);
    setShowLoginModal(true);
  };

  return (
    <div style={{
      minHeight: "100vh",
      fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: PAGE_BACKGROUND,
      padding: 24,
      boxSizing: "border-box",
    }}>
      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} initialMode={mode} />
      )}

      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 36,
            fontWeight: 800,
            color: PINK,
            letterSpacing: 0,
          }}>
            Tongkk
          </div>
        </div>
        <div style={{
          background: CARD_BACKGROUND,
          borderRadius: 20,
          padding: "40px 36px",
          width: "min(340px, calc(100vw - 48px))",
          border: `1px solid ${BORDER_COLOR}`,
          boxShadow: SOFT_SHADOW,
          boxSizing: "border-box",
        }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 500, color: "var(--color-text-strong)" }}>
            로그인이 필요합니다
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 28px" }}>
            Tongkk를 이용하려면 로그인해주세요
          </p>
          <button
            type="button"
            onClick={() => openModal("signIn")}
            style={{
              width: "100%",
              padding: "14px 0",
              borderRadius: 14,
              background: PINK,
              border: "none",
              color: "var(--color-on-brand)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 8px 18px rgba(240,112,174,0.16)",
            }}
          >
            로그인
          </button>
        </div>
      </div>
    </div>
  );
}
