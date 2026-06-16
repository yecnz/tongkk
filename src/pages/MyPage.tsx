import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useAuth } from "../AuthContext";
import { useAuthGate } from "../AuthGateContext";
import { useToast } from "../ToastContext";
import { resetAllTutorials } from "../services/tutorialStorage";
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
  school: string | null;
  department: string | null;
  onSave: (nickname: string, school: string | null, department: string | null, avatarFile: File | null) => Promise<void>;
  onClose: () => void;
};
type SettingsDialog = "notice" | "contact" | "deleteAccount" | "changeEmail" | null;

const Toggle = ({ on, onToggle }: ToggleProps) => (
  <button type="button" onClick={onToggle} style={{
    width: 46, height: 26, borderRadius: 13, border: "none", padding: 2,
    background: on ? CYAN : "var(--color-border-soft)", cursor: "pointer", transition: "background 0.2s",
    display: "flex", alignItems: "center"
  }}>
    <div style={{
      width: 22, height: 22, borderRadius: "50%", background: "var(--color-card)",
      transform: on ? "translateX(20px)" : "translateX(0)", transition: "transform 0.2s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.15)"
    }}/>
  </button>
);

const ProfileEditModal = ({ nickname, avatarUrl, school, department, onSave, onClose }: ProfileEditModalProps) => {
  const [name, setName] = useState(nickname);
  const [schoolInput, setSchoolInput] = useState(school ?? "");
  const [departmentInput, setDepartmentInput] = useState(department ?? "");
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
      await onSave(name.trim() || nickname, schoolInput.trim() || null, departmentInput.trim() || null, avatarFile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로필 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Card style={{ padding: 28, width: "min(360px, 100%)" }}>
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
              border: "2px solid var(--color-on-brand)", color: "var(--color-on-brand)", fontSize: 13
            }}>✎</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          </div>
        </div>
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 6, display: "block" }}>닉네임</label>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="닉네임 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12
        }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 6, display: "block" }}>학교</label>
        <input value={schoolInput} onChange={event => setSchoolInput(event.target.value)} placeholder="학교 (선택)" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12
        }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 6, display: "block" }}>학과</label>
        <input value={departmentInput} onChange={event => setDepartmentInput(event.target.value)} placeholder="학과 (선택)" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12
        }} />
        {error && <div style={{ marginBottom: 12, color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--color-border-soft)", background: "var(--color-card)", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button type="button" onClick={handleSave} disabled={saving} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: saving ? "var(--color-muted)" : PINK,
            color: "var(--color-on-brand)", cursor: saving ? "default" : "pointer", fontSize: 14, fontWeight: 600
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
  currentEmail,
  onChangeEmail,
}: {
  type: SettingsDialog;
  onClose: () => void;
  onDeleteData: () => Promise<void>;
  currentEmail?: string | null;
  onChangeEmail: (newEmail: string) => Promise<void>;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 전체 데이터 파기는 되돌릴 수 없어, "삭제"를 직접 입력해야 버튼이 활성화된다.
  const [confirmText, setConfirmText] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailDone, setEmailDone] = useState(false);
  const deleteReady = confirmText.trim() === "삭제";
  const trimmedEmail = emailInput.trim();
  const emailValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) &&
    trimmedEmail.toLowerCase() !== (currentEmail ?? "").toLowerCase();
  if (!type) return null;

  const title = type === "notice" ? "공지사항"
    : type === "contact" ? "문의하기"
    : type === "changeEmail" ? "이메일 변경"
    : "회원 데이터 삭제";

  const handleDelete = async () => {
    if (!deleteReady) return;
    setLoading(true);
    setError("");
    try {
      await onDeleteData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 삭제 실패");
      setLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!emailValid || loading) return;
    setLoading(true);
    setError("");
    try {
      await onChangeEmail(trimmedEmail);
      setEmailDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이메일 변경에 실패했어요. 이미 사용 중인 이메일일 수 있어요.");
    } finally {
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
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--color-text-strong)" }}>{title}</h3>
          <button type="button" className="tongkk-hover-dim" onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--color-surface)",
            color: "var(--color-muted)", cursor: "pointer", fontSize: 18, lineHeight: "30px"
          }}>×</button>
        </div>

        {type === "notice" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            <p style={{ margin: "0 0 10px" }}>Tongkk는 현재 캡스톤 시연용 MVP 단계입니다. 일부 기능이 불완전하거나 오류가 있을 수 있습니다.</p>
            <p style={{ margin: "0 0 10px" }}>사용하시다 불편한 점이나 "이런 기능이 있으면 좋겠다" 싶은 아이디어가 있다면 언제든 알려주세요. 여러분의 피드백이 Tongkk을 더 좋게 만듭니다..</p>
            <p style={{ margin: 0 }}>문의 메일: tongkk.team@gmail.com</p>
          </div>
        )}

        {type === "contact" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
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
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            <p style={{ margin: "0 0 10px" }}>
              이 작업은 현재 계정의 과목, 자료, 요약, 퀴즈, 프로필 데이터를 삭제합니다.
            </p>
            <p style={{ margin: "0 0 14px", color: "var(--color-danger)", fontWeight: 700 }}>
              Supabase Auth 계정 자체 삭제는 관리자 권한이 필요한 별도 서버 기능입니다.
            </p>
            {error && <div style={{ marginBottom: 12, color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}
            <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700, color: "var(--color-text-secondary)" }}>
              계속하려면 <strong style={{ color: "var(--color-danger)" }}>삭제</strong>를 입력하세요
            </label>
            <input
              value={confirmText}
              onChange={event => setConfirmText(event.target.value)}
              placeholder="삭제"
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12,
              }}
            />
            <button type="button"
              onClick={handleDelete}
              disabled={loading || !deleteReady}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                background: loading || !deleteReady ? "var(--color-muted-surface)" : "var(--color-danger)", color: "var(--color-on-brand)",
                fontWeight: 800, cursor: loading || !deleteReady ? "default" : "pointer"
              }}
            >
              {loading ? "삭제 중" : "내 앱 데이터 삭제"}
            </button>
          </div>
        )}

        {type === "changeEmail" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            {emailDone ? (
              <>
                <p style={{ margin: "0 0 16px" }}>
                  이메일을 <strong>{trimmedEmail}</strong>(으)로 변경했어요. 과목·자료·요약·퀴즈 기록은 그대로 유지됩니다.
                </p>
                <button type="button" onClick={onClose} style={{
                  width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                  background: CYAN, color: "var(--color-on-brand)", fontWeight: 800, cursor: "pointer"
                }}>닫기</button>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  로그인에 쓰는 이메일을 바꿉니다.<br />
                  <strong>과목·자료·요약·퀴즈 기록은 그대로 유지</strong>됩니다.
                </p>
                <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--color-muted)", wordBreak: "break-all" }}>
                  현재 이메일: {currentEmail || "-"}
                </p>
                {error && <div style={{ marginBottom: 12, color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}
                <label style={{ display: "block", marginBottom: 6, fontSize: 12.5, fontWeight: 700, color: "var(--color-text-secondary)" }}>
                  새 이메일
                </label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={event => setEmailInput(event.target.value)}
                  placeholder="new@email.com"
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border-soft)",
                    fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12,
                  }}
                />
                <button type="button"
                  onClick={handleChangeEmail}
                  disabled={loading || !emailValid}
                  style={{
                    width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                    background: loading || !emailValid ? "var(--color-muted-surface)" : CYAN, color: "var(--color-on-brand)",
                    fontWeight: 800, cursor: loading || !emailValid ? "default" : "pointer"
                  }}
                >
                  {loading ? "변경 중" : "이메일 변경"}
                </button>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default function MyPage() {
  const navigate = useNavigate();
  const { user, signOut, updateEmail } = useAuth();
  const { requireAuth, openLogin } = useAuthGate();
  const { showToast } = useToast();

  const handleReopenTutorials = () => {
    resetAllTutorials();
    showToast("튜토리얼을 초기화했어요. 각 화면에 다시 들어가면 사용법이 다시 떠요.");
  };
  const [sidebar, setSidebar] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState<SettingsDialog>(null);
  const [profile, setProfile] = useState<UserProfile>({
    nickname: user?.email?.split("@")[0] || "학생",
    avatarUrl: null,
    school: null,
    department: null,
    darkMode: false,
    notificationsEnabled: true,
    hideSummaryNotice: false,
  });
  const [error, setError] = useState("");

  // 화면 크기(전역 스케일 --app-scale) — 기기·OS 배율이 제각각이라 사용자가 직접 고른다.
  // localStorage에 저장하며, 첫 페인트 적용은 index.html 인라인 스크립트가 담당한다.
  const [uiScale, setUiScale] = useState(() => {
    const saved = parseFloat(localStorage.getItem("tongkk-ui-scale") ?? "");
    return saved >= 0.7 && saved <= 1.2 ? saved : 0.9;
  });
  const changeUiScale = (value: number) => {
    setUiScale(value);
    localStorage.setItem("tongkk-ui-scale", String(value));
    document.documentElement.style.setProperty("--app-scale", String(value));
  };

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
    // 게스트는 프로필 조회 없이 기본값 유지 — 로그인하면(user 갱신) 자동 재로딩.
    if (!user) {
      setError("");
      return () => {
        ignore = true;
      };
    }
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
  }, [user]);

  const updateProfile = async (nextProfile: UserProfile) => {
    if (!requireAuth("설정을 저장하려면 로그인이 필요해요")) return;
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

  const handleProfileSave = async (nickname: string, school: string | null, department: string | null, avatarFile: File | null) => {
    const avatarUrl = avatarFile ? await uploadAvatar(avatarFile) : profile.avatarUrl;
    await updateProfile({ ...profile, nickname, school, department, avatarUrl });
  };

  const handleDeleteData = async () => {
    await deleteOwnAppData();
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="마이페이지" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {showEdit && <ProfileEditModal nickname={profile.nickname} avatarUrl={profile.avatarUrl} school={profile.school} department={profile.department} onSave={handleProfileSave} onClose={() => setShowEdit(false)} />}
      <SettingsModal type={settingsDialog} onClose={() => setSettingsDialog(null)} onDeleteData={handleDeleteData} currentEmail={user?.email} onChangeEmail={updateEmail} />

      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-border-soft)", display: "flex", alignItems: "center", gap: 16 }}>
        <button type="button" className="tongkk-hover-dim" onClick={() => setSidebar(true)} style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button type="button" className="tongkk-hover-fade" onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 마이페이지</span>
      </div>

      <div className="app-container narrow">
        {/* 상단: 프로필 (왼) + 앱 설정 (오) */}
        <div className="mypage-grid" style={{ marginBottom: 20 }}>
          {/* 프로필 */}
          <Card style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>프로필</h3>
              {user && (
                <button type="button" onClick={() => setShowEdit(true)} style={{
                  background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  color: PINK, fontSize: 13, fontWeight: 600
                }}>
                  <span style={{ fontSize: 14 }}>✎</span> 편집
                </button>
              )}
            </div>
            {user ? (
              <>
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
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-strong)", marginBottom: 3 }}>{profile.nickname}</div>
                    {[profile.school, profile.department].filter(Boolean).join(" / ") && (
                      <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 2 }}>{[profile.school, profile.department].filter(Boolean).join(" / ")}</div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--color-muted)", wordBreak: "break-all" }}>{user?.email}</div>
                  </div>
                </div>
                {error && <div style={{ marginBottom: 12, color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}
                <button type="button" onClick={() => { if (!requireAuth("이메일을 변경하려면 로그인이 필요해요")) return; setSettingsDialog("changeEmail"); }} style={{
                  width: "100%", padding: "9px 0", borderRadius: 10, marginBottom: 8,
                  border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-text)",
                  fontSize: 13, cursor: "pointer"
                }}>이메일 변경</button>
                <button type="button" onClick={() => signOut().then(() => navigate("/", { replace: true }))} style={{
                  width: "100%", padding: "9px 0", borderRadius: 10,
                  border: "1px solid var(--color-border-soft)", background: "var(--color-card)", color: "var(--color-muted)",
                  fontSize: 13, cursor: "pointer"
                }}>로그아웃</button>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6 }}>
                  로그인하고 과목·자료·요약·퀴즈 기록을 계정에 저장하세요.
                </p>
                <button type="button" onClick={() => openLogin()} style={{
                  width: "100%", padding: "11px 0", borderRadius: 10,
                  border: "none", background: PINK, color: "var(--color-on-brand)",
                  fontSize: 13, fontWeight: 700, cursor: "pointer"
                }}>로그인</button>
              </>
            )}
          </Card>

          {/* 앱 설정 */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>앱 설정</h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>다크모드</span>
                <Toggle on={profile.darkMode} onToggle={() => updateProfile({ ...profile, darkMode: !profile.darkMode })} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "14px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>화면 크기</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {[{ label: "작게", value: 0.8 }, { label: "보통", value: 0.9 }, { label: "크게", value: 1 }].map(opt => {
                    const selected = uiScale === opt.value;
                    return (
                      <button type="button" key={opt.label} onClick={() => changeUiScale(opt.value)} style={{
                        padding: "6px 12px", borderRadius: 8,
                        border: selected ? "1px solid color-mix(in srgb, var(--color-pink) 45%, transparent)" : "1px solid var(--color-border-soft)",
                        background: selected ? "var(--color-tint-pink)" : "var(--color-card)",
                        color: selected ? PINK : "var(--color-muted)",
                        fontSize: 13, fontWeight: selected ? 800 : 600, cursor: "pointer",
                      }}>{opt.label}</button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>알림 설정</span>
                <Toggle on={profile.notificationsEnabled} onToggle={() => updateProfile({ ...profile, notificationsEnabled: !profile.notificationsEnabled })} />
              </div>
            </div>
          </Card>
        </div>

        {/* 하단: 데이터 관리 (왼) + 지원 및 정보 (오) */}
        <div className="mypage-grid">
          {/* 데이터 관리 */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>데이터 관리</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6 }}>
              과목, 자료, 요약, 퀴즈 기록은 계정별로 저장됩니다.
            </p>
            <button type="button" onClick={() => { if (!requireAuth("데이터를 관리하려면 로그인이 필요해요")) return; setSettingsDialog("deleteAccount"); }} style={{
              width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--color-danger) 45%, transparent)",
              background: "var(--color-tint-pink)", color: "var(--color-danger)", fontSize: 13, fontWeight: 700, cursor: "pointer"
            }}>내 앱 데이터 삭제</button>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-muted)", lineHeight: 1.5 }}>
              삭제 후에는 복구할 수 없습니다.
            </p>
          </Card>

          {/* 지원 및 정보 */}
          <Card style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>지원 및 정보</h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {[
                { label: "공지사항", type: "notice" as const },
                { label: "문의하기", type: "contact" as const },
              ].map((item, index) => (
                <button type="button" key={item.label} className="tongkk-hover-row" onClick={() => setSettingsDialog(item.type)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "14px 0", border: "none", background: "none", cursor: "pointer",
                  borderBottom: index === 0 ? "1px solid var(--color-border-soft)" : "none", width: "100%", textAlign: "left"
                }}>
                  <span style={{ fontSize: 14, color: "var(--color-text)" }}>{item.label}</span>
                  <span style={{ color: "var(--color-muted)", fontSize: 14 }}>›</span>
                </button>
              ))}
              <button type="button" className="tongkk-hover-row" onClick={handleReopenTutorials} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 0", border: "none", borderTop: "1px solid var(--color-border-soft)",
                background: "none", cursor: "pointer", width: "100%", textAlign: "left"
              }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>튜토리얼 다시 보기</span>
                <span style={{ color: "var(--color-muted)", fontSize: 14 }}>›</span>
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderTop: "1px solid var(--color-border-soft)" }}>
                <span style={{ fontSize: 14, color: "var(--color-muted)" }}>앱 버전</span>
                <span style={{ fontSize: 13, color: "var(--color-muted)" }}>MVP v1.0</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
