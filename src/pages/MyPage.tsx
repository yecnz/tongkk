import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PINK, CYAN, PAGE_BACKGROUND, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { useAuth } from "../AuthContext";
import {
  deleteOwnAppData,
  loadUserProfile,
  saveUserProfile,
  uploadAvatar,
  type UserProfile,
} from "../services/profile";
import { applyTheme } from "../services/theme";
import { loadLearningStats, type LearningStats } from "../services/learningStats";

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
            <p style={{ margin: "0 0 10px" }}>Tongkk는 현재 캡스톤 시연용 MVP 단계입니다.</p>
            <p style={{ margin: "0 0 10px" }}>자료 변환, 요약, 퀴즈, 마이페이지 데이터는 Supabase에 사용자별로 저장됩니다.</p>
            <p style={{ margin: 0 }}>시연 전에는 Supabase SQL 스키마 적용과 환경변수 설정을 먼저 확인하세요.</p>
          </div>
        )}

        {type === "contact" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#555" }}>
            <p style={{ margin: "0 0 12px" }}>오류 제보나 개선 요청은 팀 관리자에게 전달하세요.</p>
            <a
              href="mailto:team-1-learning-platform@example.com?subject=Tongkk%20문의"
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
  const { courses } = useCourses();
  const { user, signOut } = useAuth();
  const [sidebar, setSidebar] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState<SettingsDialog>(null);
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
  const [learningStatsLoading, setLearningStatsLoading] = useState(true);
  const [learningStatsError, setLearningStatsError] = useState("");
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

  useEffect(() => {
    let ignore = false;

    Promise.resolve()
      .then(() => {
        if (ignore) return null;
        setLearningStatsLoading(true);
        setLearningStatsError("");
        return loadLearningStats();
      })
      .then(stats => {
        if (!ignore && stats) setLearningStats(stats);
      })
      .catch(err => {
        if (!ignore) setLearningStatsError(err instanceof Error ? err.message : "학습 통계를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setLearningStatsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [courses.length]);

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

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
    }).format(new Date(timestamp));

  const scoreTone = (score: number) => {
    if (score >= 80) return { background: "#E8FAFE", color: CYAN };
    if (score >= 60) return { background: "#FFF8E8", color: "#B7791F" };
    return { background: "#FFF0F6", color: PINK };
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

      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 20 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                    background: profile.avatarUrl ? "none" : `${CYAN}40`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: CYAN, fontWeight: 800
                  }}>
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : profile.nickname.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#222", marginBottom: 4 }}>{profile.nickname}</div>
                    <div style={{ fontSize: 13, color: "#888", marginBottom: 2 }}>제주대학교 / 컴퓨터공학과</div>
                    <div style={{ fontSize: 13, color: "#aaa" }}>{user?.email}</div>
                  </div>
                </div>
                {error && <div style={{ marginBottom: 12, color: "#E53E3E", fontSize: 12 }}>{error}</div>}
                <button onClick={() => signOut().then(() => navigate("/auth", { replace: true }))} style={{
                  width: "100%", padding: "10px 0", borderRadius: 10,
                  border: "1px solid #e0e0e0", background: "#fff", color: "#999",
                  fontSize: 13, cursor: "pointer"
                }}>로그아웃</button>
              </Card>

              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#222" }}>앱 설정</h3>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontSize: 14, color: "#444" }}>다크모드</span>
                    <Toggle on={profile.darkMode} onToggle={() => updateProfile({ ...profile, darkMode: !profile.darkMode })} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontSize: 14, color: "#444" }}>알림 설정</span>
                    <Toggle on={profile.notificationsEnabled} onToggle={() => updateProfile({ ...profile, notificationsEnabled: !profile.notificationsEnabled })} />
                  </div>
                  {[
                    { label: "공지사항", type: "notice" as const },
                    { label: "문의하기", type: "contact" as const },
                    { label: "회원 탈퇴", type: "deleteAccount" as const },
                  ].map((item, index) => (
                    <button key={item.label} onClick={() => setSettingsDialog(item.type)} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "14px 0", border: "none", background: "none", cursor: "pointer",
                      borderBottom: index < 2 ? "1px solid #f5f5f5" : "none", width: "100%", textAlign: "left"
                    }}>
                      <span style={{ fontSize: 14, color: item.type === "deleteAccount" ? "#E53E3E" : "#444" }}>{item.label}</span>
                      <span style={{ color: "#ddd", fontSize: 14 }}>›</span>
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Card style={{ padding: "20px 22px", marginBottom: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 16 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#222" }}>학습 요약</h4>
                  {learningStats?.averageScore !== null && learningStats?.averageScore !== undefined && (
                    <span style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: scoreTone(learningStats.averageScore).background,
                      color: scoreTone(learningStats.averageScore).color,
                      fontSize: 12,
                      fontWeight: 850,
                    }}>
                      평균 {learningStats.averageScore}점
                    </span>
                  )}
                </div>
                {learningStatsLoading ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>학습 현황을 불러오는 중입니다.</p>
                ) : learningStatsError ? (
                  <p style={{ margin: 0, fontSize: 12, color: "#E53E3E", lineHeight: 1.55 }}>{learningStatsError}</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[
                      { label: "과목", value: learningStats?.courseCount ?? courses.length },
                      { label: "자료", value: learningStats?.materialCount ?? 0 },
                      { label: "요약", value: learningStats?.summaryCount ?? 0 },
                      { label: "퀴즈 풀이", value: learningStats?.attemptCount ?? 0 },
                    ].map(item => (
                      <div key={item.label} style={{ padding: 12, borderRadius: 12, border: "1px solid #eeeeee", background: "#fafafa" }}>
                        <div style={{ marginBottom: 5, fontSize: 11, fontWeight: 800, color: "#aaa" }}>{item.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "#222" }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card style={{ padding: "20px 22px", marginBottom: 4 }}>
                <h4 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#222" }}>최근 퀴즈 성과</h4>
                {learningStatsLoading ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>최근 풀이 기록을 불러오는 중입니다.</p>
                ) : learningStatsError ? (
                  <p style={{ margin: 0, fontSize: 12, color: "#E53E3E", lineHeight: 1.55 }}>퀴즈 성과를 표시하려면 Supabase 스키마가 최신이어야 합니다.</p>
                ) : !learningStats || learningStats.recentAttempts.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#bbb", lineHeight: 1.6 }}>아직 풀이 기록이 없습니다. 퀴즈를 한 번 풀면 최근 점수와 약점이 표시됩니다.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {learningStats.recentAttempts.map((attempt, index) => {
                      const tone = scoreTone(attempt.scorePercent);
                      return (
                        <div key={`${attempt.courseName}-${attempt.createdAt}-${index}`} style={{ padding: 12, borderRadius: 12, border: "1px solid #eeeeee", background: "#fff" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 7 }}>
                            <strong style={{ fontSize: 13, color: "#222", wordBreak: "break-word" }}>{attempt.courseName}</strong>
                            <span style={{ flexShrink: 0, padding: "4px 8px", borderRadius: 999, background: tone.background, color: tone.color, fontSize: 12, fontWeight: 850 }}>
                              {attempt.scorePercent}점
                            </span>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 8px", fontSize: 11, color: "#999", fontWeight: 700 }}>
                            <span>{attempt.correctCount}/{attempt.count}문항</span>
                            <span>{attempt.difficulty}</span>
                            <span>{attempt.questionType}</span>
                            <span>{formatDate(attempt.createdAt)}</span>
                          </div>
                          {attempt.weakTopics.length > 0 && (
                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {attempt.weakTopics.slice(0, 3).map(topic => (
                                <span key={topic} style={{ padding: "4px 8px", borderRadius: 999, background: "#FFF0F6", color: PINK, fontSize: 11, fontWeight: 800 }}>
                                  {topic}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card style={{ padding: "18px 22px", marginBottom: 4 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#222" }}>수강 중인 강의</h4>
                {courses.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#bbb" }}>등록된 강의가 없습니다</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {courses.map((course, index) => (
                      <span key={`${course}-${index}`} style={{
                        padding: "5px 14px", borderRadius: 20,
                        background: "#FFF0F6", color: PINK, fontSize: 13, fontWeight: 600
                      }}>{course}</span>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
      </div>
    </div>
  );
}
