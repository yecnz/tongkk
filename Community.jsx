import { useState } from "react";

const PINK = "#F070AE";
const CYAN = "#00C0E8";

const Card = ({ children, style, ...props }) => (
  <div style={{
    background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)", ...style
  }} {...props}>{children}</div>
);

const samplePosts = [
  { id: 1, author: "YJ", title: "3주차 요약 공유합니다", likes: 12, comments: 5, saves: 8, time: "2시간 전" },
  { id: 2, author: "HN", title: "2주차 퀴즈 20문제 만들었어요", likes: 22, comments: 17, saves: 20, time: "4시간 전" },
  { id: 3, author: "SJ", title: "중간고사 내용 정리 + 예상문제", likes: 15, comments: 7, saves: 12, time: "6시간 전" },
  { id: 4, author: "MK", title: "그래프 탐색 BFS/DFS 비교 정리", likes: 9, comments: 3, saves: 6, time: "1일 전" },
  { id: 5, author: "JW", title: "힙 정렬 구현 코드 공유", likes: 18, comments: 11, saves: 14, time: "1일 전" },
  { id: 6, author: "EH", title: "과제 3번 질문 있습니다", likes: 4, comments: 8, saves: 1, time: "2일 전" },
];

const PostDetail = ({ post, onBack }) => {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState([
    { author: "JH", text: "좋은 자료 감사합니다!", time: "1시간 전" },
    { author: "DY", text: "이해하기 쉽게 정리해주셨네요", time: "3시간 전" },
  ]);

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 16, padding: 0
      }}>← 목록으로</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%", background: "#E8FAFE",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: CYAN
          }}>{post.author}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>{post.author}</div>
            <div style={{ fontSize: 12, color: "#aaa" }}>{post.time}</div>
          </div>
        </div>
        <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#222" }}>{post.title}</h2>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.8, margin: "0 0 20px" }}>
          안녕하세요! {post.title}에 대한 내용입니다. 이번 주차에서 배운 핵심 개념들을 정리해봤습니다. 도움이 되셨으면 좋겠습니다.
        </p>
        <div style={{ display: "flex", gap: 20, padding: "16px 0", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0" }}>
          <button onClick={() => setLiked(!liked)} style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 14,
            color: liked ? PINK : "#999", display: "flex", alignItems: "center", gap: 6
          }}>♥ {post.likes + (liked ? 1 : 0)}</button>
          <span style={{ fontSize: 14, color: "#999" }}>💬 {comments.length}</span>
          <button onClick={() => setSaved(!saved)} style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 14,
            color: saved ? CYAN : "#999", display: "flex", alignItems: "center", gap: 6
          }}>🔖 {post.saves + (saved ? 1 : 0)}</button>
        </div>
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600 }}>댓글 {comments.length}</h4>
          {comments.map((c, i) => (
            <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", background: "#f0f0f0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 600, color: "#888"
                }}>{c.author}</div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>{c.author}</span>
                <span style={{ fontSize: 11, color: "#bbb" }}>{c.time}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#555", paddingLeft: 36 }}>{c.text}</p>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="댓글을 입력하세요"
              style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none" }}
            />
            <button onClick={() => {
              if (comment.trim()) {
                setComments([...comments, { author: "나", text: comment.trim(), time: "방금" }]);
                setComment("");
              }
            }} style={{
              padding: "10px 18px", borderRadius: 10, border: "none",
              background: PINK, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer"
            }}>등록</button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default function Community() {
  const [search, setSearch] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);

  const filtered = samplePosts.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0" }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: PINK }}>Tongkk</span>
        <span style={{ marginLeft: 12, color: "#bbb", fontSize: 14 }}>/ 커뮤니티</span>
      </div>

      <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
        {selectedPost ? (
          <PostDetail post={selectedPost} onBack={() => setSelectedPost(null)} />
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#222" }}>
                <span style={{ color: "#999", fontWeight: 400 }}>제주대 &gt;</span> 컴공 게시판
              </h2>
            </div>

            <div style={{ position: "relative", marginBottom: 20 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="검색"
                style={{
                  width: "100%", padding: "12px 16px 12px 40px", borderRadius: 12,
                  border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box"
                }}
              />
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#bbb", fontSize: 16 }}>🔍</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map(post => (
                <Card key={post.id} style={{ padding: "18px 20px", cursor: "pointer", transition: "box-shadow 0.2s" }}
                  onClick={() => setSelectedPost(post)}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: "50%", background: "#f5f5f5", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, color: "#888"
                    }}>{post.author}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "#222" }}>{post.title}</h3>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#aaa" }}>
                        <span>좋아요 {post.likes}</span>
                        <span>댓글 {post.comments}</span>
                        <span>저장 {post.saves}</span>
                        <span style={{ marginLeft: "auto" }}>{post.time}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}