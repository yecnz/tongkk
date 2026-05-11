import { useCallback, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PINK, CYAN, pageRoutes, SidebarIcon, Sidebar, Card } from "../common";
import {
  addCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  fetchCommunityComments,
  fetchCommunityPosts,
  setCommunityReaction,
  updateCommunityPost,
  type CommunityComment,
  type CommunityPost,
} from "../services/community";
import { loadUserProfile } from "../services/profile";

type LocationState = { post?: CommunityPost; from?: string; view?: string } | null;
type PostDetailProps = {
  post: CommunityPost;
  authorName: string;
  onBack: () => void;
  onPostChange: (post: CommunityPost) => void;
  onPostDelete: () => Promise<void>;
};
type WritePostModalProps = {
  heading?: string;
  initialTitle?: string;
  initialContent?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (title: string, content: string) => Promise<void>;
};

const WritePostModal = ({
  heading = "글쓰기",
  initialTitle = "",
  initialContent = "",
  submitLabel = "등록",
  onClose,
  onSubmit,
}: WritePostModalProps) => {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (!nextTitle || !nextContent || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(nextTitle, nextContent);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "게시글 등록 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.22)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24
    }}>
      <Card style={{ width: "min(520px, 100%)", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#222" }}>{heading}</h3>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, border: "none", background: "#fafafa",
            color: "#999", cursor: "pointer", fontSize: 18, lineHeight: "30px"
          }}>×</button>
        </div>
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="제목"
          style={{
            width: "100%", boxSizing: "border-box", padding: "12px 14px",
            borderRadius: 10, border: "1px solid #e5e5e5", fontSize: 14,
            outline: "none", marginBottom: 12
          }}
        />
        <textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          placeholder="내용을 입력하세요"
          rows={8}
          style={{
            width: "100%", boxSizing: "border-box", padding: "12px 14px",
            borderRadius: 10, border: "1px solid #e5e5e5", fontSize: 14,
            outline: "none", resize: "vertical", lineHeight: 1.6
          }}
        />
        {error && <div style={{ marginTop: 10, color: "#E53E3E", fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{
            padding: "9px 18px", borderRadius: 10, border: "1px solid #e5e5e5",
            background: "#fff", color: "#666", cursor: "pointer"
          }}>취소</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim() || submitting}
            style={{
              padding: "9px 18px", borderRadius: 10, border: "none",
              background: submitting || !title.trim() || !content.trim() ? "#ddd" : PINK,
              color: "#fff", fontWeight: 700, cursor: submitting ? "default" : "pointer"
            }}
          >
            {submitting ? "저장 중" : submitLabel}
          </button>
        </div>
      </Card>
    </div>
  );
};

const PostDetail = ({ post, authorName, onBack, onPostChange, onPostDelete }: PostDetailProps) => {
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reloadComments = useCallback(async () => {
    setLoadingComments(true);
    setError("");
    try {
      setComments(await fetchCommunityComments(post.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "댓글 불러오기 실패");
    } finally {
      setLoadingComments(false);
    }
  }, [post.id]);

  useEffect(() => {
    reloadComments();
  }, [reloadComments]);

  const toggleReaction = async (type: "like" | "save") => {
    const enabled = type === "like" ? !post.liked : !post.saved;
    const nextPost = {
      ...post,
      liked: type === "like" ? enabled : post.liked,
      saved: type === "save" ? enabled : post.saved,
      likes: type === "like" ? post.likes + (enabled ? 1 : -1) : post.likes,
      saves: type === "save" ? post.saves + (enabled ? 1 : -1) : post.saves,
    };
    onPostChange(nextPost);

    try {
      await setCommunityReaction(post.id, type, enabled);
    } catch (err) {
      onPostChange(post);
      setError(err instanceof Error ? err.message : "반응 저장 실패");
    }
  };

  const submitComment = async () => {
    const text = comment.trim();
    if (!text) return;

    setComment("");
    setError("");
    try {
      await addCommunityComment(post.id, text, authorName);
      onPostChange({ ...post, comments: post.comments + 1 });
      await reloadComments();
    } catch (err) {
      setComment(text);
      setError(err instanceof Error ? err.message : "댓글 등록 실패");
    }
  };

  const handleEditPost = async (title: string, content: string) => {
    await updateCommunityPost(post.id, title, content);
    onPostChange({ ...post, title, content });
  };

  const handleDeletePost = async () => {
    if (!window.confirm("이 게시글을 삭제할까요?")) return;
    setDeletingPost(true);
    setError("");
    try {
      await deleteCommunityPost(post.id);
      await onPostDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "게시글 삭제 실패");
    } finally {
      setDeletingPost(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm("이 댓글을 삭제할까요?")) return;
    setDeletingCommentId(commentId);
    setError("");
    try {
      await deleteCommunityComment(commentId);
      setComments(prev => prev.filter(item => item.id !== commentId));
      onPostChange({ ...post, comments: Math.max(0, post.comments - 1) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "댓글 삭제 실패");
    } finally {
      setDeletingCommentId(null);
    }
  };

  return (
    <div>
      {showEdit && (
        <WritePostModal
          heading="게시글 수정"
          initialTitle={post.title}
          initialContent={post.content}
          submitLabel="수정"
          onClose={() => setShowEdit(false)}
          onSubmit={handleEditPost}
        />
      )}
      <button onClick={onBack} style={{
        background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 14, marginBottom: 16, padding: 0
      }}>← 목록으로</button>
      <Card style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: "#E8FAFE",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: CYAN
            }}>{post.author.slice(0, 2).toUpperCase()}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>{post.author}</div>
              <div style={{ fontSize: 12, color: "#aaa" }}>{post.time}</div>
            </div>
          </div>
          {post.isMine && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowEdit(true)} style={{
                padding: "7px 12px", borderRadius: 9, border: "1px solid #e8e8e8",
                background: "#fff", color: "#666", fontSize: 12, fontWeight: 700, cursor: "pointer"
              }}>수정</button>
              <button onClick={handleDeletePost} disabled={deletingPost} style={{
                padding: "7px 12px", borderRadius: 9, border: "none",
                background: deletingPost ? "#ddd" : "#FFF5F5", color: deletingPost ? "#999" : "#E53E3E",
                fontSize: 12, fontWeight: 700, cursor: deletingPost ? "default" : "pointer"
              }}>{deletingPost ? "삭제 중" : "삭제"}</button>
            </div>
          )}
        </div>
        <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#222" }}>{post.title}</h2>
        <div style={{ fontSize: 14, color: "#555", lineHeight: 1.8, margin: "0 0 20px", whiteSpace: "pre-wrap" }}>
          {post.content}
        </div>
        <div style={{ display: "flex", gap: 20, padding: "16px 0", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0" }}>
          <button onClick={() => toggleReaction("like")} style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 14,
            color: post.liked ? PINK : "#999", display: "flex", alignItems: "center", gap: 6
          }}>♥ {post.likes}</button>
          <span style={{ fontSize: 14, color: "#999" }}>댓글 {post.comments}</span>
          <button onClick={() => toggleReaction("save")} style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 14,
            color: post.saved ? CYAN : "#999", display: "flex", alignItems: "center", gap: 6
          }}>저장 {post.saves}</button>
        </div>
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600 }}>댓글 {comments.length}</h4>
          {loadingComments ? (
            <div style={{ padding: "16px 0", color: "#aaa", fontSize: 13 }}>댓글을 불러오는 중...</div>
          ) : comments.length === 0 ? (
            <div style={{ padding: "16px 0", color: "#bbb", fontSize: 13 }}>아직 댓글이 없습니다</div>
          ) : comments.map(item => (
            <div key={item.id} style={{ padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", background: "#f0f0f0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 600, color: "#888"
                  }}>{item.author.slice(0, 2).toUpperCase()}</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>{item.author}</span>
                  <span style={{ fontSize: 11, color: "#bbb" }}>{item.time}</span>
                </div>
                {item.isMine && (
                  <button
                    onClick={() => handleDeleteComment(item.id)}
                    disabled={deletingCommentId === item.id}
                    style={{
                      border: "none", background: "none", color: "#bbb",
                      fontSize: 12, fontWeight: 700, cursor: deletingCommentId === item.id ? "default" : "pointer"
                    }}
                  >
                    {deletingCommentId === item.id ? "삭제 중" : "삭제"}
                  </button>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#555", paddingLeft: 36 }}>{item.text}</p>
            </div>
          ))}
          {error && <div style={{ marginTop: 10, color: "#E53E3E", fontSize: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <input
              value={comment}
              onChange={event => setComment(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") submitComment(); }}
              placeholder="댓글을 입력하세요"
              style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none" }}
            />
            <button onClick={submitComment} style={{
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
  const navigate = useNavigate();
  const location = useLocation();
  const initialState = location.state as LocationState;
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(initialState?.post || null);
  const [showWrite, setShowWrite] = useState(false);
  const [authorName, setAuthorName] = useState("학생");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reloadPosts = useCallback(async (nextSearch: string) => {
    setLoading(true);
    setError("");
    try {
      const nextPosts = await fetchCommunityPosts(nextSearch);
      setPosts(nextPosts);
      setSelectedPost(prev => prev ? nextPosts.find(post => post.id === prev.id) || prev : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "게시글 불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUserProfile()
      .then(profile => setAuthorName(profile.nickname))
      .catch(() => {
        setAuthorName("학생");
      });
    reloadPosts("");
  }, [reloadPosts]);

  useEffect(() => {
    const timer = window.setTimeout(() => reloadPosts(search), 250);
    return () => window.clearTimeout(timer);
  }, [reloadPosts, search]);

  const updatePost = (nextPost: CommunityPost) => {
    setSelectedPost(nextPost);
    setPosts(prev => prev.map(post => post.id === nextPost.id ? nextPost : post));
  };

  const handleCreatePost = async (title: string, content: string) => {
    await createCommunityPost(title, content, authorName);
    await reloadPosts("");
    setSearch("");
  };

  const handlePostDelete = async () => {
    setSelectedPost(null);
    await reloadPosts(search);
  };

  const handleBack = () => {
    const state = location.state as LocationState;
    if (state?.from === "/mypage") {
      navigate("/mypage", { state: { view: state.view } });
      return;
    }
    setSelectedPost(null);
  };

  return (
    <div style={{ background: "#fff", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {sidebar && <Sidebar active="커뮤니티" onNav={(item) => navigate(pageRoutes[item])} onClose={() => setSidebar(false)} />}
      {sidebar && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>}
      {showWrite && <WritePostModal onClose={() => setShowWrite(false)} onSubmit={handleCreatePost} />}

      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <SidebarIcon />
        </button>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 20, color: PINK, cursor: "pointer" }}>Tongkk</button>
        <span style={{ color: "#bbb", fontSize: 14 }}>/ 커뮤니티</span>
      </div>

      <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
        {selectedPost ? (
          <PostDetail
            post={selectedPost}
            authorName={authorName}
            onBack={handleBack}
            onPostChange={updatePost}
            onPostDelete={handlePostDelete}
          />
        ) : (
          <>
            <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#222" }}>
                  <span style={{ color: "#999", fontWeight: 400 }}>제주대 &gt;</span> 컴공 게시판
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>요약본, 퀴즈, 질문을 함께 모아보는 공간</p>
              </div>
              <button onClick={() => setShowWrite(true)} style={{
                padding: "10px 18px", borderRadius: 10, border: "none",
                background: PINK, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer"
              }}>글쓰기</button>
            </div>
            <div style={{ position: "relative", marginBottom: 20 }}>
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="검색"
                style={{
                  width: "100%", padding: "12px 16px 12px 40px", borderRadius: 12,
                  border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box"
                }}
              />
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#bbb", fontSize: 16 }}>⌕</span>
            </div>
            {error && (
              <Card style={{ padding: 18, marginBottom: 14, color: "#E53E3E", fontSize: 13 }}>
                {error}
              </Card>
            )}
            {loading ? (
              <Card style={{ padding: 36, textAlign: "center", color: "#aaa", fontSize: 14 }}>
                게시글을 불러오는 중...
              </Card>
            ) : posts.length === 0 ? (
              <Card style={{ padding: 40, textAlign: "center" }}>
                <p style={{ margin: "0 0 14px", color: "#aaa", fontSize: 14 }}>아직 게시글이 없습니다</p>
                <button onClick={() => setShowWrite(true)} style={{
                  padding: "9px 18px", borderRadius: 10, border: "none",
                  background: CYAN, color: "#fff", fontWeight: 700, cursor: "pointer"
                }}>첫 글 쓰기</button>
              </Card>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {posts.map(post => (
                  <Card key={post.id} style={{ padding: "18px 20px", cursor: "pointer", transition: "box-shadow 0.2s" }}
                    onClick={() => setSelectedPost(post)}
                    onMouseEnter={event => event.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
                    onMouseLeave={event => event.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%", background: "#f5f5f5", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, color: "#888"
                      }}>{post.author.slice(0, 2).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "#222" }}>{post.title}</h3>
                        <p style={{
                          margin: "0 0 10px", fontSize: 13, color: "#777", lineHeight: 1.5,
                          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                        }}>{post.content}</p>
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
            )}
          </>
        )}
      </div>
    </div>
  );
}
