import { useState } from "react";
import { Navigate } from "react-router-dom";
import { PINK, CYAN, Card } from "../common";
import { useAuth } from "../AuthContext";

type AuthMode = "signIn" | "signUp";

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signIn") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: 24,
    }}>
      <Card style={{ width: "100%", maxWidth: 380, padding: 28 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: PINK, marginBottom: 6 }}>Tongkk</div>
          <h1 style={{ margin: 0, fontSize: 20, color: "#222" }}>
            {mode === "signIn" ? "로그인" : "회원가입"}
          </h1>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="이메일"
            autoComplete="email"
            required
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              fontSize: 14,
              outline: "none",
            }}
          />
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="비밀번호"
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            minLength={6}
            required
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              fontSize: 14,
              outline: "none",
            }}
          />

          {error && <p style={{ margin: 0, color: "#E53E3E", fontSize: 13, lineHeight: 1.5 }}>{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 4,
              padding: "12px 14px",
              borderRadius: 10,
              border: "none",
              background: submitting ? "#ddd" : PINK,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: submitting ? "default" : "pointer",
            }}
          >
            {submitting ? "처리 중..." : mode === "signIn" ? "로그인" : "회원가입"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setError("");
          }}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #e8e8e8",
            background: "#fff",
            color: CYAN,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {mode === "signIn" ? "계정 만들기" : "이미 계정이 있어요"}
        </button>
      </Card>
    </div>
  );
}
