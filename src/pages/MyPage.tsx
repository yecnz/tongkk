import BrandLogo from "../components/BrandLogo";
import SourceConnections from '../features/integrations/SourceConnections';
import CalendarConnections from '../features/integrations/CalendarConnections';
import LearningPreferences from '../features/review/LearningPreferences';
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import ModalDialog from '../components/ModalDialog';
import { Button, InlineAlert, PageHeading, TextField } from '../components/ui';
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card, useSidebarOpen } from "../common";
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

type ToggleProps = { label: string; on: boolean; onToggle: () => void; disabled?: boolean };
type ProfileEditModalProps = {
  nickname: string;
  avatarUrl: string | null;
  school: string | null;
  department: string | null;
  onSave: (nickname: string, school: string | null, department: string | null, avatarFile: File | null) => Promise<void>;
  onClose: () => void;
};
type SettingsDialog = "notice" | "contact" | "deleteAccount" | "changeEmail" | null;

const Toggle = ({ label, on, onToggle, disabled }: ToggleProps) => (
  <button type="button" role="switch" aria-label={label} aria-checked={on} disabled={disabled} onClick={onToggle} style={{
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
  const id = useId();
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
    <ModalDialog labelledBy={`${id}-title`} onClose={() => { if (!saving) onClose(); }} width={380}>
      <form onSubmit={event => { event.preventDefault(); void handleSave(); }} style={{ padding: 28 }} aria-busy={saving}>
        <h2 id={`${id}-title`} style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700 }}>프로필 편집</h2>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <button type="button" disabled={saving} aria-label="프로필 사진 변경" style={{ position: "relative", cursor: "pointer", border: 0, padding: 0, background: 'transparent', borderRadius: '50%' }} onClick={() => fileRef.current?.click()}>
            <span style={{
              width: 80, height: 80, borderRadius: "50%", overflow: "hidden",
              background: preview ? "none" : 'var(--color-tint-cyan)',
              display: "flex", alignItems: "center", justifyContent: "center",
              color: 'var(--color-cyan-deep)', fontWeight: 800
            }}>
              {preview ? (
                <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : name.slice(0, 2).toUpperCase()}
            </span>
            <span aria-hidden="true" style={{
              position: "absolute", bottom: 0, right: 0, width: 26, height: 26,
              borderRadius: "50%", background: PINK, display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid var(--color-card)", color: "var(--color-on-accent)", fontSize: 13
            }}>✎</span>
          </button>
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" onChange={handleFile} style={{ display: "none" }} />
        </div>
        <div style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
          <TextField label="닉네임" id={`${id}-name`} disabled={saving} value={name} onChange={event => setName(event.target.value)} placeholder="닉네임 입력" />
          <TextField label="학교" id={`${id}-school`} disabled={saving} value={schoolInput} onChange={event => setSchoolInput(event.target.value)} placeholder="학교 (선택)" />
          <TextField label="학과" id={`${id}-department`} disabled={saving} value={departmentInput} onChange={event => setDepartmentInput(event.target.value)} placeholder="학과 (선택)" />
        </div>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button onClick={onClose} disabled={saving}>취소</Button>
          <Button type="submit" variant="primary" busy={saving}>{saving ? "저장 중" : "저장"}</Button>
        </div>
      </form>
    </ModalDialog>
  );
};

const SettingsModal = ({
  type,
  onClose,
  onDeleteData,
  currentEmail,
  onChangeEmail,
}: {
  type: Exclude<SettingsDialog, null>;
  onClose: () => void;
  onDeleteData: () => Promise<void>;
  currentEmail?: string | null;
  onChangeEmail: (newEmail: string) => Promise<void>;
}) => {
  const id = useId();
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

  const title = type === "notice" ? "공지사항"
    : type === "contact" ? "문의하기"
    : type === "changeEmail" ? "이메일 변경"
    : "학습 데이터 삭제";

  const handleDelete = async () => {
    if (!deleteReady || loading) return;
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
      setError(err instanceof Error ? err.message : "이메일 변경에 실패했어요. 이미 사용 중인 이메일일 수 있습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalDialog labelledBy={`${id}-title`} onClose={() => { if (!loading) onClose(); }} width={430}>
      <div style={{ padding: 26 }} aria-busy={loading}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 id={`${id}-title`} style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-strong)" }}>{title}</h2>
          <Button variant="ghost" size="sm" disabled={loading} aria-label="닫기" onClick={onClose}>×</Button>
        </div>

        {type === "notice" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            <p style={{ margin: "0 0 10px" }}>Tongkk는 현재 캡스톤 시연용 MVP 단계입니다. 일부 기능이 불완전하거나 오류가 있을 수 있습니다.</p>
            <p style={{ margin: "0 0 10px" }}>오류나 개선 의견을 보내 주세요.</p>
            <p style={{ margin: 0 }}>문의 메일: tongkk.team@gmail.com</p>
          </div>
        )}

        {type === "contact" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            <p style={{ margin: "0 0 12px" }}>오류 제보나 개선 요청은 팀 관리자에게 전달해 주세요.</p>
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
            <p style={{ margin: "0 0 14px", color: "var(--color-text-secondary)" }}>
              로그인 계정은 유지됩니다. 삭제한 학습 데이터는 복구할 수 없습니다.
            </p>
            {error && <InlineAlert tone="error">{error}</InlineAlert>}
            <div style={{ marginBottom: 14 }}><TextField
              label={'계속하려면 "삭제"를 입력해 주세요'} id={`${id}-confirmation`} disabled={loading}
              value={confirmText}
              onChange={event => setConfirmText(event.target.value)}
              placeholder="삭제"
            /></div>
            <Button variant="danger" busy={loading}
              onClick={handleDelete}
              disabled={!deleteReady}
              style={{ width: '100%' }}
            >
              {loading ? "삭제 중" : "학습 데이터 삭제"}
            </Button>
          </div>
        )}

        {type === "changeEmail" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text)" }}>
            {emailDone ? (
              <>
                <InlineAlert tone="success">
                  이메일을 <strong>{trimmedEmail}</strong>(으)로 변경했어요. 과목·자료·요약·퀴즈 기록은 그대로 유지됩니다.
                </InlineAlert>
                <Button variant="primary" tone="cyan" onClick={onClose} style={{ width: '100%' }}>닫기</Button>
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
                {error && <InlineAlert tone="error">{error}</InlineAlert>}
                <div style={{ marginBottom: 14 }}><TextField
                  label="새 이메일" id={`${id}-email`} disabled={loading}
                  type="email"
                  value={emailInput}
                  onChange={event => setEmailInput(event.target.value)}
                  placeholder="new@email.com"
                /></div>
                <Button variant="primary" tone="cyan" busy={loading}
                  onClick={handleChangeEmail}
                  disabled={!emailValid}
                  style={{ width: '100%' }}
                >
                  {loading ? "변경 중" : "이메일 변경"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
};

export default function MyPage() {
  const navigate = useNavigate();
  const { user, signOut, updateEmail } = useAuth();
  const userId = user?.id;
  const { requireAuth, openLogin } = useAuthGate();
  const { showToast } = useToast();

  const handleReopenTutorials = () => {
    resetAllTutorials();
    showToast("튜토리얼을 초기화했습니다. 화면을 열면 사용법이 표시됩니다.");
  };
  const [sidebar, setSidebar] = useSidebarOpen();
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
  const [profileReady, setProfileReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [profileSaving, setProfileSaving] = useState(false);
  const savingProfile = useRef(false);
  const [signingOut, setSigningOut] = useState(false);

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

  useEffect(() => {
    let ignore = false;
    setProfileReady(false);
    setError('');
    setShowEdit(false);
    setSettingsDialog(null);
    // 게스트는 프로필 조회 없이 기본값 유지 — 로그인하면(user 갱신) 자동 재로딩.
    if (!userId) {
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
        setProfileReady(true);
        setError("");
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "마이페이지 정보 불러오기 실패");
      }
    };
    void loadInitialProfile();
    return () => {
      ignore = true;
    };
  }, [userId, loadAttempt]);

  const updateProfile = async (nextProfile: UserProfile) => {
    if (!requireAuth("설정을 저장하려면 로그인이 필요해요")) throw new Error('로그인 후 다시 저장해 주세요.');
    if (savingProfile.current || !profileReady) throw new Error('설정을 불러오거나 저장하는 중이에요. 잠시 후 다시 시도해 주세요.');
    const previous = profile;
    savingProfile.current = true;
    setProfileSaving(true);
    setError('');
    setProfile(nextProfile);
    applyTheme(nextProfile.darkMode);
    try {
      const savedProfile = await saveUserProfile(nextProfile);
      setProfile(savedProfile);
      applyTheme(savedProfile.darkMode);
    } catch (err) {
      setProfile(previous);
      applyTheme(previous.darkMode);
      setError(err instanceof Error ? err.message : "설정 저장 실패");
      throw err;
    } finally {
      savingProfile.current = false;
      setProfileSaving(false);
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

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch {
      setError('로그아웃하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div style={{ background: PAGE_BACKGROUND, minHeight: "100vh", fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="마이페이지" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {user && showEdit && <ProfileEditModal key={user.id} nickname={profile.nickname} avatarUrl={profile.avatarUrl} school={profile.school} department={profile.department} onSave={handleProfileSave} onClose={() => setShowEdit(false)} />}
      {settingsDialog && <SettingsModal key={`${user?.id}-${settingsDialog}`} type={settingsDialog} onClose={() => setSettingsDialog(null)} onDeleteData={handleDeleteData} currentEmail={user?.email} onChangeEmail={updateEmail} />}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-border-soft)", display: "flex", alignItems: "center", gap: 16 }}>
        <button type="button" className="tongkk-hover-dim" onClick={() => setSidebar(!sidebar)} aria-label={sidebar ? "메뉴 닫기" : "메뉴 열기"} style={{ background: "none", border: "none", borderRadius: 8, cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button type="button" className="brand-home tongkk-hover-fade" onClick={() => navigate("/")}><BrandLogo /></button>
        <span style={{ color: "var(--color-muted)", fontSize: 14 }}>/ 마이페이지</span>
      </div>

      <div className="app-container narrow">
        <PageHeading title="마이페이지" description="프로필과 학습 환경을 설정하세요." />
        {user && !profileReady && !error && <p role="status">프로필을 불러오는 중이에요…</p>}
        {error && !showEdit && <InlineAlert tone="error">{error}{!profileReady && <Button size="sm" onClick={() => setLoadAttempt(attempt => attempt + 1)}>다시 불러오기</Button>}</InlineAlert>}
        {/* 상단: 프로필 (왼) + 앱 설정 (오) */}
        <div className="mypage-grid" style={{ marginBottom: 20 }}>
          {/* 프로필 */}
          <Card style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>프로필</h2>
              {user && (
                <Button variant="ghost" size="sm" disabled={!profileReady || profileSaving} onClick={() => { setError(''); setShowEdit(true); }}>
                  <span style={{ fontSize: 14 }}>✎</span> 편집
                </Button>
              )}
            </div>
            {user ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                    background: profile.avatarUrl ? "none" : 'var(--color-tint-cyan)',
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: 'var(--color-cyan-deep)', fontWeight: 800, fontSize: 18
                  }}>
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                <Button disabled={profileSaving || signingOut} onClick={() => { if (!requireAuth("이메일을 변경하려면 로그인이 필요해요")) return; setSettingsDialog("changeEmail"); }} style={{ width: '100%', marginBottom: 8 }}>이메일 변경</Button>
                <Button busy={signingOut} disabled={profileSaving} onClick={handleSignOut} style={{ width: '100%' }}>로그아웃</Button>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6 }}>
                  로그인해 학습 기록을 저장하세요.
                </p>
                <Button variant="primary" onClick={() => openLogin()} style={{ width: '100%' }}>로그인</Button>
              </>
            )}
          </Card>

          {/* 앱 설정 */}
          <Card style={{ padding: 24 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>앱 설정</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>다크모드</span>
                <Toggle label="다크모드" on={profile.darkMode} disabled={Boolean(user) && (!profileReady || profileSaving)} onToggle={() => { void updateProfile({ ...profile, darkMode: !profile.darkMode }).catch(() => {}); }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "14px 0", borderBottom: "1px solid var(--color-border-soft)" }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>화면 크기</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {[{ label: "작게", value: 0.8 }, { label: "보통", value: 0.9 }, { label: "크게", value: 1 }].map(opt => {
                    const selected = uiScale === opt.value;
                    return (
                      <Button key={opt.label} size="sm" variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} onClick={() => changeUiScale(opt.value)}>{opt.label}</Button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>알림 설정</span>
                <Toggle label="알림 설정" on={profile.notificationsEnabled} disabled={Boolean(user) && (!profileReady || profileSaving)} onToggle={() => { void updateProfile({ ...profile, notificationsEnabled: !profile.notificationsEnabled }).catch(() => {}); }} />
              </div>
            </div>
          </Card>
        </div>

        {user && <div className="workflow-settings"><LearningPreferences key={user.id} />
        <CalendarConnections key={`calendar-${user.id}`} /><SourceConnections key={`sources-${user.id}`} /></div>}
        {/* 하단: 데이터 관리 (왼) + 지원 및 정보 (오) */}
        <div className="mypage-grid">
          {/* 데이터 관리 */}
          <Card style={{ padding: 24 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>데이터 관리</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6 }}>
              과목, 자료, 요약, 퀴즈 기록은 계정별로 저장됩니다.
            </p>
            <Button variant="danger" disabled={profileSaving || signingOut} onClick={() => { if (!requireAuth("데이터를 관리하려면 로그인이 필요해요")) return; setSettingsDialog("deleteAccount"); }} style={{ width: '100%' }}>학습 데이터 삭제</Button>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-muted)", lineHeight: 1.5 }}>
              삭제 후에는 복구할 수 없습니다.
            </p>
          </Card>

          {/* 지원 및 정보 */}
          <Card style={{ padding: 24 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--color-text-strong)" }}>지원 및 정보</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {[
                { label: "공지사항", type: "notice" as const },
                { label: "문의하기", type: "contact" as const },
              ].map((item, index) => (
                <Button variant="ghost" key={item.label} className="tongkk-hover-row" onClick={() => setSettingsDialog(item.type)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "14px 0", border: "none", background: "none", cursor: "pointer",
                  borderBottom: index === 0 ? "1px solid var(--color-border-soft)" : "none", width: "100%", textAlign: "left"
                }}>
                  <span style={{ fontSize: 14, color: "var(--color-text)" }}>{item.label}</span>
                  <span style={{ color: "var(--color-muted)", fontSize: 14 }}>›</span>
                </Button>
              ))}
              <Button variant="ghost" className="tongkk-hover-row" onClick={handleReopenTutorials} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 0", border: "none", borderTop: "1px solid var(--color-border-soft)",
                background: "none", cursor: "pointer", width: "100%", textAlign: "left"
              }}>
                <span style={{ fontSize: 14, color: "var(--color-text)" }}>튜토리얼 다시 보기</span>
                <span style={{ color: "var(--color-muted)", fontSize: 14 }}>›</span>
              </Button>
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
