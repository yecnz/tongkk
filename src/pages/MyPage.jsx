import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import { useCourses } from "../CourseContext";
import { samplePosts } from "../data/posts";

const Toggle = ({ on, onToggle }) => (
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

const PostListView = ({ title, posts, onBack, onSelect }) => (
  <div>
    <button onClick={onBack} style={{
      background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 16, padding: 0
    }}>← 돌아가기</button>
    <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#222" }}>{title}</h2>
    {posts.length === 0 ? (
      <Card style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "#bbb", fontSize: 14 }}>아직 글이 없습니다</p>
      </Card>
    ) : (
      posts.map((p, i) => (
        <Card key={i}
          onClick={() => onSelect(p)}
          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"}
          style={{ padding: "16px 20px", marginBottom: 10, cursor: "pointer", transition: "box-shadow 0.2s" }}
        >
          <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#222" }}>{p.title}</h4>
          <div style={{ fontSize: 12, color: "#aaa" }}>
            좋아요 {p.likes} · 댓글 {p.comments} · {p.time}
          </div>
        </Card>
      ))
    )}
  </div>
);

/* 로그인 모달 */
const LoginModal = ({ onClose, onLogin }) => {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [idFocus, setIdFocus] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);

  const inputStyle = (focused) => ({
    width: "100%", padding: "13px 16px", borderRadius: 12,
    border: `1.5px solid ${focused ? CYAN : "#e8e8e8"}`,
    fontSize: 14, outline: "none", boxSizing: "border-box",
    background: focused ? "rgba(0,192,232,0.04)" : "#fafafa",
    transition: "border 0.2s, background 0.2s", color: "#222",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.18)", backdropFilter: "blur(6px)"
    }}>
      <div style={{
        width: 380, background: "#ffffff",
        borderRadius: 24, padding: "36px 32px",
        boxShadow: "0 12px 48px rgba(0,0,0,0.14)"
      }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 500, color: "#222" }}>로그인</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>계정에 로그인하세요</p>
          </div>
          <button onClick={onClose} style={{
            background: "#f4f4f4", border: "none", borderRadius: "50%",
            width: 34, height: 34, cursor: "pointer", fontSize: 16, color: "#999",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>✕</button>
        </div>

        {/* 아이디 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>아이디</label>
          <input
            value={id} onChange={e => setId(e.target.value)}
            onFocus={() => setIdFocus(true)} onBlur={() => setIdFocus(false)}
            placeholder="아이디를 입력하세요"
            style={inputStyle(idFocus)}
          />
        </div>

        {/* 비밀번호 */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 6, display: "block", letterSpacing: 0.3 }}>비밀번호</label>
          <input
            type="password"
            value={pw} onChange={e => setPw(e.target.value)}
            onFocus={() => setPwFocus(true)} onBlur={() => setPwFocus(false)}
            placeholder="비밀번호를 입력하세요"
            style={inputStyle(pwFocus)}
          />
        </div>

        {/* 로그인 버튼 */}
        <button onClick={onLogin} style={{
          width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
          background: "#e8e8e8",
          color: "#555", fontSize: 15, fontWeight: 600, cursor: "pointer",
          boxShadow: "none", marginBottom: 16
        }}>로그인</button>

        {/* 하단 링크 */}
        <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
          {["아이디 찾기", "비밀번호 찾기", "회원가입"].map((t, i) => (
            <button key={i} style={{
              background: "none", border: "none", fontSize: 12,
              color: "#bbb", cursor: "pointer", padding: 0
            }}>{t}</button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* 프로필 편집 모달 */
const ProfileEditModal = ({ nickname, avatarUrl, onSave, onClose }) => {
  const [name, setName] = useState(nickname);
  const [preview, setPreview] = useState(avatarUrl);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card style={{ padding: 28, width: 360 }}>
        <h3 style={{ margin: "0 0 24px", fontSize: 17, fontWeight: 700 }}>프로필 편집</h3>

        {/* 프로필 사진 */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ position: "relative", cursor: "pointer" }} onClick={() => fileRef.current?.click()}>
            <div style={{
              width: 80, height: 80, borderRadius: "50%", overflow: "hidden",
              background: preview ? "none" : `${CYAN}40`,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              {preview ? (
                <img src={preview} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
            </div>
            <div style={{
              position: "absolute", bottom: 0, right: 0, width: 26, height: 26,
              borderRadius: "50%", background: PINK, display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid #fff"
            }}>
              <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>✎</span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          </div>
        </div>

        {/* 닉네임 */}
        <label style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 6, display: "block" }}>닉네임</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="닉네임 입력" style={{
          width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0",
          fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 20
        }} />

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
          <button onClick={() => { onSave(name.trim() || nickname, preview); onClose(); }} style={{
            padding: "8px 18px", borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600
          }}>저장</button>
        </div>
      </Card>
    </div>
  );
};

export default function MyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { courses } = useCourses();
  const [sidebar, setSidebar] = useState(false);
  const [dark, setDark] = useState(false);
  const [notif, setNotif] = useState(true);
  const [view, setView] = useState(location.state?.view || "main");
  const [loggedIn, setLoggedIn] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [nickname, setNickname] = useState("학생닉네임");
  const [avatarUrl, setAvatarUrl] = useState(null);

  const handleProfileSave = (newName, newAvatar) => {
    setNickname(newName);
    setAvatarUrl(newAvatar);
  };

  const getPostsById = (ids) => ids.map(id => samplePosts.find(p => p.id === id)).filter(Boolean);
  const myPosts = getPostsById([1, 3]);
  const likedPosts = getPostsById([2, 4]);
  const commentedPosts = getPostsById([5]);
  const savedPosts = getPostsById([3, 4, 6]);

  const postViews = {
    myPosts: { title: "내가 쓴 글", posts: myPosts },
    liked: { title: "좋아요한 글", posts: likedPosts },
    commented: { title: "댓글 단 글", posts: commentedPosts },
    saved: { title: "스크랩한 글", posts: savedPosts },
  };

  if (!loggedIn) {
    return (
      <div style={{
        minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#ffffff"
      }}>
        {showLoginModal && (
          <LoginModal onClose={() => setShowLoginModal(false)} onLogin={() => { setLoggedIn(true); setShowLoginModal(false); }} />
        )}
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 32 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: PINK, letterSpacing: -1 }}>Tongkk</span>
          </div>
          <div style={{
            background: "#ffffff", borderRadius: 24, padding: "40px 36px", width: 340,
            boxShadow: "0 8px 40px rgba(0,192,232,0.12)"
          }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 500, color: "#222" }}>로그인이 필요합니다</h2>
            <p style={{ fontSize: 14, color: "#aaa", margin: "0 0 28px" }}>Tongkk를 이용하려면 로그인해주세요</p>
            <button onClick={() => setShowLoginModal(true)} style={{
              width: "100%", padding: "14px 0", borderRadius: 14,
              background: "#e8e8e8", border: "none",
              color: "#555", fontSize: 15, fontWeight: 600, cursor: "pointer",
              boxShadow: "0 2px 12px rgba(0,0,0,0.08)"
            }}>로그인</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="마이페이지" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {showEdit && <ProfileEditModal nickname={nickname} avatarUrl={avatarUrl} onSave={handleProfileSave} onClose={() => setShowEdit(false)} />}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 마이페이지</span>
      </div>

      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        {view !== "main" && postViews[view] ? (
          <PostListView
            title={postViews[view].title}
            posts={postViews[view].posts}
            onBack={() => setView("main")}
            onSelect={(post) => navigate("/community", { state: { post, from: "/mypage", view } })}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 20 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                    background: avatarUrl ? "none" : `${CYAN}40`,
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : null}
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#222", marginBottom: 4 }}>{nickname}</div>
                    <div style={{ fontSize: 13, color: "#888", marginBottom: 2 }}>제주대학교 / 컴퓨터공학과</div>
                    <div style={{ fontSize: 13, color: "#aaa" }}>student@jejunu.ac.kr</div>
                  </div>
                </div>
                <button onClick={() => setLoggedIn(false)} style={{
                  width: "100%", padding: "10px 0", borderRadius: 10,
                  border: "1px solid #e0e0e0", background: "#fff", color: "#999",
                  fontSize: 13, cursor: "pointer"
                }}>로그아웃</button>
              </Card>

              {/* 앱 설정 */}
              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#222" }}>앱 설정</h3>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontSize: 14, color: "#444" }}>다크모드</span>
                    <Toggle on={dark} onToggle={() => setDark(!dark)} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontSize: 14, color: "#444" }}>알림 설정</span>
                    <Toggle on={notif} onToggle={() => setNotif(!notif)} />
                  </div>
                  {["공지사항", "문의하기", "회원 탈퇴"].map((item, i) => (
                    <button key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "14px 0", border: "none", background: "none", cursor: "pointer",
                      borderBottom: i < 2 ? "1px solid #f5f5f5" : "none", width: "100%", textAlign: "left"
                    }}>
                      <span style={{ fontSize: 14, color: item === "회원 탈퇴" ? "#ccc" : "#444" }}>{item}</span>
                      <span style={{ color: "#ddd", fontSize: 14 }}>›</span>
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            {/* 오른쪽 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* 수강 중인 강의 */}
              <Card style={{ padding: "18px 22px", marginBottom: 4 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#222" }}>수강 중인 강의</h4>
                {courses.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#bbb" }}>등록된 강의가 없습니다</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {courses.map((c, i) => (
                      <span key={i} style={{
                        padding: "5px 14px", borderRadius: 20,
                        background: "#FFF0F6", color: PINK, fontSize: 13, fontWeight: 600
                      }}>{c}</span>
                    ))}
                  </div>
                )}
              </Card>

              {[
                { key: "myPosts", label: "내가 쓴 글", count: myPosts.length },
                { key: "liked", label: "좋아요한 글", count: likedPosts.length },
                { key: "commented", label: "댓글 단 글", count: commentedPosts.length },
                { key: "saved", label: "스크랩한 글", count: savedPosts.length },
              ].map(item => (
                <Card key={item.key} style={{ padding: "18px 22px", cursor: "pointer", transition: "box-shadow 0.2s" }}
                  onClick={() => setView(item.key)}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#333" }}>{item.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, color: CYAN, fontWeight: 600 }}>{item.count}</span>
                      <span style={{ color: "#ddd", fontSize: 16 }}>›</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}