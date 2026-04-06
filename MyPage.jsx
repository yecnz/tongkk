import { useState } from "react";

const PINK = "#F070AE";
const CYAN = "#00C0E8";

const Card = ({ children, style }) => (
  <div style={{
    background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)", ...style
  }}>{children}</div>
);

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

const PostListView = ({ title, posts, onBack }) => (
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
        <Card key={i} style={{ padding: "16px 20px", marginBottom: 10 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#222" }}>{p.title}</h4>
          <div style={{ fontSize: 12, color: "#aaa" }}>
            좋아요 {p.likes} · 댓글 {p.comments} · {p.time}
          </div>
        </Card>
      ))
    )}
  </div>
);

export default function MyPage() {
  const [dark, setDark] = useState(false);
  const [notif, setNotif] = useState(true);
  const [view, setView] = useState("main"); // main, myPosts, liked, commented, saved
  const [loggedIn, setLoggedIn] = useState(true);

  const myPosts = [
    { title: "알고리즘 3주차 정리 공유합니다", likes: 12, comments: 5, time: "2일 전" },
    { title: "빅데이터 프로젝트 질문", likes: 3, comments: 8, time: "5일 전" },
  ];
  const likedPosts = [
    { title: "중간고사 예상문제 50선", likes: 45, comments: 23, time: "1일 전" },
    { title: "DP 완전 정복 가이드", likes: 38, comments: 15, time: "3일 전" },
  ];
  const commentedPosts = [
    { title: "그래프 이론 질문있습니다", likes: 7, comments: 12, time: "3시간 전" },
  ];
  const savedPosts = [
    { title: "자료구조 핵심 요약", likes: 55, comments: 20, time: "1주 전" },
    { title: "코테 대비 알고리즘 패턴 정리", likes: 89, comments: 34, time: "2주 전" },
    { title: "운영체제 기말 족보", likes: 120, comments: 45, time: "3주 전" },
  ];

  const postViews = {
    myPosts: { title: "내가 쓴 글", posts: myPosts },
    liked: { title: "좋아요한 글", posts: likedPosts },
    commented: { title: "댓글 단 글", posts: commentedPosts },
    saved: { title: "스크랩한 글", posts: savedPosts },
  };

  if (!loggedIn) {
    return (
      <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Card style={{ padding: 40, width: 360, textAlign: "center" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: `${CYAN}33`, margin: "0 auto 20px" }}/>
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>로그인이 필요합니다</h2>
          <p style={{ fontSize: 14, color: "#999", margin: "0 0 24px" }}>StudyMate를 이용하려면 로그인해주세요</p>
          <button onClick={() => setLoggedIn(true)} style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: PINK, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer"
          }}>로그인</button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0" }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
        <span style={{ marginLeft: 12, color: "#bbb", fontSize: 14 }}>/ 마이페이지</span>
      </div>

      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        {view !== "main" && postViews[view] ? (
          <PostListView title={postViews[view].title} posts={postViews[view].posts} onBack={() => setView("main")} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
            {/* Left column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Profile */}
              <Card style={{ padding: 28 }}>
                <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "#222" }}>프로필</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 20 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%", background: `${CYAN}40`,
                    flexShrink: 0
                  }}/>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#222", marginBottom: 4 }}>학생닉네임</div>
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

              {/* App settings */}
              <Card style={{ padding: 24 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#222" }}>앱 설정</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
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

            {/* Right column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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