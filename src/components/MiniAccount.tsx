import { useEffect, useId, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { loadUserProfile, type UserProfile } from "../services/profile";
import switchIcon from "../assets/mini/account-switch.svg";
import exitIcon from "../assets/mini/account-exit.svg";

export default function MiniAccount({ user, onSwitchAccount }: { user: User; onSwitchAccount: () => void }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const menuId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const signingOut = useRef(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let refreshing = false;
    let refreshQueued = false;
    const refresh = async () => {
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      refreshQueued = false;
      try {
        const latest = await loadUserProfile();
        if (active) {
          setProfile(latest);
          setFailedAvatar(null);
        }
      } catch (err) {
        if (active) console.warn("메뉴바 프로필을 불러오지 못했어요.", err);
      } finally {
        refreshing = false;
        if (active && refreshQueued) void refresh();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("tongkk:mini-open", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("tongkk:mini-open", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user.id]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!signingOut.current && !anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (!signingOut.current) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const logout = async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setPending(true);
    setError("");
    try {
      await signOut({ scope: "local" });
      navigate("/mini", { replace: true });
    } catch {
      setError("로그아웃하지 못했어요. 다시 시도하세요.");
    } finally {
      signingOut.current = false;
      setPending(false);
    }
  };

  const nickname = profile?.nickname.trim() || user.email?.split("@")[0] || "학생";
  const initials = Array.from(nickname).slice(0, 2).join("");
  const avatarUrl = profile?.avatarUrl;
  const avatar = avatarUrl && avatarUrl !== failedAvatar
    ? <img src={avatarUrl} alt="" onError={() => setFailedAvatar(avatarUrl)} />
    : initials;

  return (
    <div ref={anchor} className="mini-account">
      <button ref={trigger} type="button" className="mini-account-trigger"
        aria-label="계정 메뉴" aria-expanded={open} aria-controls={open ? menuId : undefined}
        disabled={pending} onClick={() => { setOpen(value => !value); setError(""); }}>
        <span className="mini-account-avatar" aria-hidden="true">{avatar}</span>
      </button>
      {open && (
        <section id={menuId} className="mini-account-menu" aria-label="현재 계정" aria-busy={pending}>
          <div className="mini-account-current">
            <span className="mini-account-avatar" aria-hidden="true">{avatar}</span>
            <div className="mini-account-info">
              <p title={nickname}>{nickname}</p>
              {user.email && <p title={user.email}>{user.email}</p>}
            </div>
          </div>
          <div className="mini-account-divider" />
          <button type="button" disabled={pending} onClick={() => { setOpen(false); onSwitchAccount(); }}>
            <img src={switchIcon} alt="" />다른 계정으로 로그인
          </button>
          <button type="button" disabled={pending} onClick={() => void logout()}>
            <img src={exitIcon} alt="" />로그아웃
          </button>
          {error && <p className="mini-account-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
