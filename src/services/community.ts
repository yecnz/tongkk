import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type CommunityPost = {
  id: string;
  author: string;
  title: string;
  content: string;
  likes: number;
  comments: number;
  saves: number;
  time: string;
  createdAt: number;
  liked: boolean;
  saved: boolean;
  isMine: boolean;
};

export type CommunityComment = {
  id: string;
  author: string;
  text: string;
  time: string;
  createdAt: number;
  isMine: boolean;
};

export type CommunityActivity = {
  myPosts: CommunityPost[];
  likedPosts: CommunityPost[];
  commentedPosts: CommunityPost[];
  savedPosts: CommunityPost[];
};

type PostRow = {
  id: string;
  user_id: string;
  author_name: string;
  title: string;
  content: string;
  created_at: string;
};

type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  text: string;
  created_at: string;
};

type ReactionRow = {
  post_id: string;
  user_id: string;
  type: 'like' | 'save';
};

const relativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(timestamp).toLocaleDateString('ko-KR');
};

const countByPost = <T extends { post_id: string }>(rows: T[], predicate?: (row: T) => boolean) => {
  const counts = new Map<string, number>();
  rows.forEach(row => {
    if (predicate && !predicate(row)) return;
    counts.set(row.post_id, (counts.get(row.post_id) || 0) + 1);
  });
  return counts;
};

async function loadPostSupportRows() {
  const [commentsResult, reactionsResult] = await Promise.all([
    supabase.from('community_comments').select('post_id, user_id'),
    supabase.from('community_reactions').select('post_id, user_id, type'),
  ]);

  if (commentsResult.error) throw new Error(formatSupabaseError(commentsResult.error));
  if (reactionsResult.error) throw new Error(formatSupabaseError(reactionsResult.error));

  return {
    commentRows: (commentsResult.data || []) as Array<Pick<CommentRow, 'post_id' | 'user_id'>>,
    reactionRows: (reactionsResult.data || []) as ReactionRow[],
  };
}

function mapPosts(
  rows: PostRow[],
  userId: string,
  commentRows: Array<Pick<CommentRow, 'post_id' | 'user_id'>>,
  reactionRows: ReactionRow[],
): CommunityPost[] {
  const comments = countByPost(commentRows);
  const likes = countByPost(reactionRows, row => row.type === 'like');
  const saves = countByPost(reactionRows, row => row.type === 'save');
  const liked = new Set(reactionRows.filter(row => row.user_id === userId && row.type === 'like').map(row => row.post_id));
  const saved = new Set(reactionRows.filter(row => row.user_id === userId && row.type === 'save').map(row => row.post_id));

  return rows.map(row => {
    const createdAt = new Date(row.created_at).getTime();
    return {
      id: row.id,
      author: row.author_name,
      title: row.title,
      content: row.content,
      likes: likes.get(row.id) || 0,
      comments: comments.get(row.id) || 0,
      saves: saves.get(row.id) || 0,
      time: relativeTime(createdAt),
      createdAt,
      liked: liked.has(row.id),
      saved: saved.has(row.id),
      isMine: row.user_id === userId,
    };
  });
}

export async function fetchCommunityPosts(search = ''): Promise<CommunityPost[]> {
  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('community_posts')
    .select('id, user_id, author_name, title, content, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(formatSupabaseError(error));

  const { commentRows, reactionRows } = await loadPostSupportRows();
  const posts = mapPosts((data || []) as PostRow[], user.id, commentRows, reactionRows);
  const query = search.trim().toLowerCase();
  if (!query) return posts;
  return posts.filter(post =>
    post.title.toLowerCase().includes(query) ||
    post.content.toLowerCase().includes(query) ||
    post.author.toLowerCase().includes(query)
  );
}

export async function createCommunityPost(
  title: string,
  content: string,
  authorName: string,
): Promise<void> {
  const user = await requireSupabaseUser();
  const { error } = await supabase
    .from('community_posts')
    .insert({
      user_id: user.id,
      author_name: authorName,
      title,
      content,
    });

  if (error) throw new Error(formatSupabaseError(error));
}

export async function updateCommunityPost(
  postId: string,
  title: string,
  content: string,
): Promise<void> {
  const { error } = await supabase
    .from('community_posts')
    .update({ title, content })
    .eq('id', postId);

  if (error) throw new Error(formatSupabaseError(error));
}

export async function deleteCommunityPost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', postId);

  if (error) throw new Error(formatSupabaseError(error));
}

export async function fetchCommunityComments(postId: string): Promise<CommunityComment[]> {
  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('community_comments')
    .select('id, post_id, user_id, author_name, text, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(formatSupabaseError(error));

  return ((data || []) as CommentRow[]).map(row => {
    const createdAt = new Date(row.created_at).getTime();
    return {
      id: row.id,
      author: row.author_name,
      text: row.text,
      time: relativeTime(createdAt),
      createdAt,
      isMine: row.user_id === user.id,
    };
  });
}

export async function addCommunityComment(
  postId: string,
  text: string,
  authorName: string,
): Promise<void> {
  const user = await requireSupabaseUser();
  const { error } = await supabase
    .from('community_comments')
    .insert({
      post_id: postId,
      user_id: user.id,
      author_name: authorName,
      text,
    });

  if (error) throw new Error(formatSupabaseError(error));
}

export async function deleteCommunityComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('community_comments')
    .delete()
    .eq('id', commentId);

  if (error) throw new Error(formatSupabaseError(error));
}

export async function setCommunityReaction(
  postId: string,
  type: 'like' | 'save',
  enabled: boolean,
): Promise<void> {
  const user = await requireSupabaseUser();
  if (enabled) {
    const { error } = await supabase
      .from('community_reactions')
      .upsert({
        post_id: postId,
        user_id: user.id,
        type,
      }, {
        onConflict: 'post_id,user_id,type',
      });
    if (error) throw new Error(formatSupabaseError(error));
    return;
  }

  const { error } = await supabase
    .from('community_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .eq('type', type);

  if (error) throw new Error(formatSupabaseError(error));
}

export async function fetchCommunityActivity(): Promise<CommunityActivity> {
  const user = await requireSupabaseUser();
  const posts = await fetchCommunityPosts();
  const { data, error } = await supabase
    .from('community_comments')
    .select('post_id')
    .eq('user_id', user.id);

  if (error) throw new Error(formatSupabaseError(error));

  const commentedPostIds = new Set(((data || []) as Array<Pick<CommentRow, 'post_id'>>).map(row => row.post_id));
  return {
    myPosts: posts.filter(post => post.isMine),
    likedPosts: posts.filter(post => post.liked),
    commentedPosts: posts.filter(post => commentedPostIds.has(post.id)),
    savedPosts: posts.filter(post => post.saved),
  };
}
