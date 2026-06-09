import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useAuth } from "../AuthContext";
import {
  deleteOwnAppData,
  loadUserProfile,
  saveUserProfile,
  uploadAvatar,
  type UserProfile,
} from "../services/profile";
import { applyTheme } from "../services/theme";

type ToggleProps = { on: boolean; onToggle: () => void };
type ProfileEditModalProps = {
  nickname: string;
  avatarUrl: string | null;
  onSave: (nickname: string, avatarFile: File | null) => Promise<void>;
  onClose: () => void;
};
type SettingsDialog = "notice" | "contact" | "deleteAccount" | null;

const Toggle = ({ on, onToggle }: ToggleProps) => (
  <button onClick={onToggle} style={{
    width: 46, height: 26, borderRadius: 13, border: "none", padding: 2,
    background: on ? CYAN : "#ddd", cursor: "pointer", transition: "background 0.2s",
    display: "flex", alignItems: "center"
  }}>
    <div style={{
      width: 22, height: 22, borderRadius: "50%", background: "#fff",
      transform: on ? "translateX(20px)" : "translateX(0)", transition: "transform 0.2s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.15)"
    }}/>
  </button>
);

const ProfileEditModal = ({ nickname, avatarUrl, onSave, onClose }: ProfileEditModalProps) => {
  const [name, setName] = useState(nickname);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim() || nickname, avatarFile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로필 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 360 }}>
        <h3 style={{ margin: "0 0 24px", fontSize: 17, fontWeight: 700 }}>프로필 편집</h3>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ position: "relative", cursor: "pointer" }} onClick={() => fileRef.current?.click()}>
            <div style={{
              width: 80, height: 80, borderRadius: "50%", overflow: "hidden",
              background: preview ? "none" : `${CYAN}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: CYAN, fontWeight: 800
            }}>
              {preview ? (
                <img src={preview} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{
              position: "absolute", bottom: 0, right: 0, width: 26, height: 26,
              borderRadius: "50%", background: PINK, display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid #fff", color: "#fff", fontSize: 13
            }}>✎</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          </div>
        </div>
        <label style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 6, display: "block" }}>닉네임</label>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="닉네임 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12
        }} />
        {error && <div style={{ marginBottom: 12, color: "#E53E3E", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: saving ? "#ddd" : PINK,
            color: "#fff", cursor: saving ? "default" : "pointer", fontSize: 14, fontWeight: 600
          }}>{saving ? "저장 중" : "저장"}</button>
        </div>
      </Card>
    </div>
  );
};

const SettingsModal = ({
  type,
  onClose,
  onDeleteData,
}: {
  type: SettingsDialog;
  onClose: () => void;
  onDeleteData: () => Promise<void>;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (!type) return null;

  const title = type === "notice" ? "공지사항" : type === "contact" ? "문의하기" : "회원 데이터 삭제";

  const handleDelete = async () => {
    setLoading(true);
    setError("");
    try {
      await onDeleteData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 삭제 실패");
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,0.24)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24
    }}>
      <Card style={{ width: "min(430px, 100%)", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#222" }}>{title}</h3>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, border: "none", background: "#fafafa",
            color: "#999", cursor: "pointer", fontSize: 18, lineHeight: "30px"
          }}>×</button>
        </div>

        {type === "notice" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#555" }}>
            <p style={{ margin: "0 0 10px" }}>Tongkk는 현재 캡스톤 시연용 MVP 단계입니다. 일부 기능이 불완전하거나 오류가 있을 수 있습니다.</p>
            <p style={{ margin: "0 0 10px" }}>사용하시다 불편한 점이나 "이런 기능이 있으면 좋겠다" 싶은 아이디어가 있다면 언제든 알려주세요. 여러분의 피드백이 Tongkk을 더 좋게 만듭니다..</p>
            <p style={{ margin: 0 }}>문의 메일: tongkk.team@gmail.com</p>
          </div>
        )}

        {type === "contact" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#555" }}>
            <p style={{ margin: "0 0 12px" }}>오류 제보나 개선 요청은 팀 관리자에게 전달하세요.</p>
            <a
              href="mailto:tongkk.team@gmail.com?subject=Tongkk%20문의"
              style={{ color: CYAN, fontWeight: 800, textDecoration: "none" }}
            >
              문의 메일 작성하기
            </a>
          </div>
        )}

        {type === "deleteAccount" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#555" }}>
            <p style={{ margin: "0 0 10px" }}>
              이 작업은 현재 계정의 과목, 자료, 요약, 퀴즈, 프로필 데이터를 삭제합니다.
            </p>
            <p style={{ margin: "0 0 14px", color: "#E53E3E", fontWeight: 700 }}>
              Supabase Auth 계정 자체 삭제는 관리자 권한이 필요한 별도 서버 기능입니다.
            </p>
            {error && <div style={{ marginBottom: 12, color: "#E53E3E", fontSize: 12 }}>{error}</div>}
            <button
              onClick={handleDelete}
              disabled={loading}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                background: loading ? "#ddd" : "#E53E3E", color: "#fff",
                fontWeight: 800, cursor: loading ? "default" : "pointer"
              }}
            >
              {loading ? "삭제 중" : "내 앱 데이터 삭제"}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default function MyPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [sidebar, setSidebar] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState<SettingsDialog>(null);
  const [profile, setProfile] = useState<UserProfile>({
    nickname: user?.email?.split("@")[0] || "학생",
    avatarUrl: null,
    darkMode: false,
    notificationsEnabled: true,
  });
  const [error, setError] = useState("");

  const reload = async () => {
    try {
      const nextProfile = await loadUserProfile();
      setProfile(nextProfile);
      applyTheme(nextProfile.darkMode);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "마이페이지 정보 불러오기 실패");
    }
  };

  useEffect(() => {
    let ignore = false;
    const loadInitialProfile = async () => {
      try {
        const nextProfile = await loadUserProfile();
        if (ignore) return;
        setProfile(nextProfile);
        applyTheme(nextProfile.darkMode);
        setError("");
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "마이페이지 정보 불러오기 실패");
      }
    };
    void loadInitialProfile();
    return () => {
      ignore = true;
    };
  }, []);

  const updateProfile = async (nextProfile: UserProfile) => {
    setProfile(nextProfile);
    applyTheme(nextProfile.darkMode);
    try {
      const savedProfile = await saveUserProfile(nextProfile);
      setProfile(savedProfile);
      applyTheme(savedProfile.darkMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정 저장 실패");
      await reload();
    }
  };

  const handleProfileSave = async (nickname: string, avatarFile: File | null) => {
    const avatarUrl = avatarFile ? await uploadAvatar(avatarFile) : profile.avatarUrl;
    await updateProfile({ ...profile, nickname, avatarUrl });
  };

  const handleDeleteData = async () => {
    await deleteOwnAppData();
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="마이페이지" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {showEdit && <ProfileEditModal nickname={profile.nickname} avatarUrl={profile.avatarUrl} onSave={handleProfileSave} onClose={() => setShowEdit(false)} />}
      <SettingsModal type={settingsDialog} onClose={() => setSettingsDialog(null)} onDeleteData={handleDeleteData} />

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 마이페이지</span>
      </div>

      <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
        {/* 상단: 프로필 (왼) + 앱 설정 (오) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20, alignItems: "start" }}>
          {/* 프로필 */}
          <Card style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>프로필</h3>
              <button onClick={() => setShowEdit(true)} style={{
                background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                color: PINK, fontSize: 13, fontWeight: 600
              }}>
                <span style={{ fontSize: 14 }}>✎</span> 편집
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                background: profile.avatarUrl ? "none" : `${CYAN}40`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: CYAN, fontWeight: 800, fontSize: 18
              }}>
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : profile.nickname.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#222", marginBottom: 3 }}>{profile.nickname}</div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>제주대학교 / 컴퓨터공학과</div>
                <div style={{ fontSize: 12, color: "#aaa", wordBreak: "break-all" }}>{user?.email}</div>
              </div>
            </div>
            {error && <div style={{ marginBottom: 12, color: "#E53E3E", fontSize: 12 }}>{error}</div>}
            <button onClick={() => signOut().then(() => navigate("/auth", { replace: true }))} style={{
              width: "100%", padding: "9px 0", borderRadius: 10,
              border: "1px solid #e0e0e0", background: "#fff", color: "#999",
              fontSize: 13, cursor: "pointer"
            }}>로그아웃</button>
          </Card>

          {/* 앱 설정 */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#222" }}>앱 설정</h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
                <span style={{ fontSize: 14, color: "#444" }}>다크모드</span>
                <Toggle on={profile.darkMode} onToggle={() => updateProfile({ ...profile, darkMode: !profile.darkMode })} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
                <span style={{ fontSize: 14, color: "#444" }}>알림 설정</span>
                <Toggle on={profile.notificationsEnabled} onToggle={() => updateProfile({ ...profile, notificationsEnabled: !profile.notificationsEnabled })} />
              </div>
            </div>
          </Card>
        </div>

        {/* 하단: 데이터 관리 (왼) + 지원 및 정보 (오) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
          {/* 데이터 관리 */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#222" }}>데이터 관리</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#888", lineHeight: 1.6 }}>
              과목, 자료, 요약, 퀴즈 기록은 계정별로 저장됩니다.
            </p>
            <button onClick={() => setSettingsDialog("deleteAccount")} style={{
              width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid #fca5a5",
              background: "#FFF5F5", color: "#E53E3E", fontSize: 13, fontWeight: 700, cursor: "pointer"
            }}>내 앱 데이터 삭제</button>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#aaa", lineHeight: 1.5 }}>
              삭제 후에는 복구할 수 없습니다.
            </p>
          </Card>

          {/* 지원 및 정보 */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#222" }}>지원 및 정보</h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {[
                { label: "공지사항", type: "notice" as const },
                { label: "문의하기", type: "contact" as const },
              ].map((item, index) => (
                <button key={item.label} onClick={() => setSettingsDialog(item.type)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "14px 0", border: "none", background: "none", cursor: "pointer",
                  borderBottom: index === 0 ? "1px solid #f5f5f5" : "none", width: "100%", textAlign: "left"
                }}>
                  <span style={{ fontSize: 14, color: "#444" }}>{item.label}</span>
                  <span style={{ color: "#ddd", fontSize: 14 }}>›</span>
                </button>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderTop: "1px solid #f5f5f5" }}>
                <span style={{ fontSize: 14, color: "#aaa" }}>앱 버전</span>
                <span style={{ fontSize: 13, color: "#bbb" }}>MVP v1.0</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
