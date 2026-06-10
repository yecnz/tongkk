import type { User } from '@supabase/supabase-js';
import { invalidateCoursesCache } from './courses';
import { invalidateMaterialsCache } from './materials';
import { invalidateQuizSetsCache } from './quizSets';
import { invalidateSummariesCache } from './summaries';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type UserProfile = {
  nickname: string;
  avatarUrl: string | null;
  darkMode: boolean;
  notificationsEnabled: boolean;
  hideSummaryNotice: boolean;
};

type ProfileRow = {
  nickname: string;
  avatar_url: string | null;
  dark_mode: boolean;
  notifications_enabled: boolean;
  hide_summary_notice: boolean;
};

const PROFILE_COLUMNS = 'nickname, avatar_url, dark_mode, notifications_enabled, hide_summary_notice';

const defaultNickname = (user: User) =>
  user.user_metadata?.nickname ||
  user.email?.split('@')[0] ||
  '학생';

const toProfile = (row: ProfileRow): UserProfile => ({
  nickname: row.nickname,
  avatarUrl: row.avatar_url,
  darkMode: row.dark_mode,
  notificationsEnabled: row.notifications_enabled,
  hideSummaryNotice: row.hide_summary_notice,
});

const listStorageFilePaths = async (bucket: string, prefix: string): Promise<string[]> => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix);

  if (error) throw new Error(formatSupabaseError(error));

  const paths: string[] = [];
  for (const item of data || []) {
    const itemPath = `${prefix}/${item.name}`;
    if (item.metadata) {
      paths.push(itemPath);
      continue;
    }

    paths.push(...await listStorageFilePaths(bucket, itemPath));
  }

  return paths;
};

const deleteStoragePrefix = async (bucket: string, prefix: string): Promise<void> => {
  const paths = await listStorageFilePaths(bucket, prefix);
  if (paths.length === 0) return;

  const { error } = await supabase.storage
    .from(bucket)
    .remove(paths);

  if (error) throw new Error(formatSupabaseError(error));
};

export async function loadUserProfile(): Promise<UserProfile> {
  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(formatSupabaseError(error));
  if (data) return toProfile(data);

  return saveUserProfile({
    nickname: defaultNickname(user),
    avatarUrl: null,
    darkMode: false,
    notificationsEnabled: true,
    hideSummaryNotice: false,
  });
}

export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      nickname: profile.nickname,
      avatar_url: profile.avatarUrl,
      dark_mode: profile.darkMode,
      notifications_enabled: profile.notificationsEnabled,
      hide_summary_notice: profile.hideSummaryNotice,
    }, {
      onConflict: 'id',
    })
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (error) throw new Error(formatSupabaseError(error));
  return toProfile(data);
}

// '요약 안내 팝업 다시 보지 않기' 설정만 가볍게 갱신한다. (다른 프로필 필드는 건드리지 않음)
export async function updateHideSummaryNotice(hide: boolean): Promise<void> {
  const user = await requireSupabaseUser();
  const { error } = await supabase
    .from('profiles')
    .update({ hide_summary_notice: hide })
    .eq('id', user.id);

  if (error) throw new Error(formatSupabaseError(error));
}

export async function uploadAvatar(file: File): Promise<string> {
  const user = await requireSupabaseUser();
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${user.id}/avatar.${extension}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'image/png',
      upsert: true,
    });

  if (error) throw new Error(formatSupabaseError(error));

  const { data } = supabase.storage
    .from('avatars')
    .getPublicUrl(path);

  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function deleteOwnAppData(): Promise<void> {
  const user = await requireSupabaseUser();
  await deleteStoragePrefix('avatars', user.id);
  await deleteStoragePrefix('course-materials', user.id);

  const deletes = [
    () => supabase.from('dashboard_state').delete().eq('user_id', user.id),
    () => supabase.from('quiz_attempts').delete().eq('user_id', user.id),
    () => supabase.from('quiz_sets').delete().eq('user_id', user.id),
    () => supabase.from('summary_chat_messages').delete().eq('user_id', user.id),
    () => supabase.from('summaries').delete().eq('user_id', user.id),
    () => supabase.from('materials').delete().eq('user_id', user.id),
    () => supabase.from('courses').delete().eq('user_id', user.id),
    () => supabase.from('profiles').delete().eq('id', user.id),
  ];

  for (const request of deletes) {
    const result = await request();
    if (result.error) throw new Error(formatSupabaseError(result.error));
  }

  // 계정 데이터 전체 삭제 후 낡은 캐시가 남지 않도록 모두 비운다.
  invalidateCoursesCache();
  invalidateMaterialsCache();
  invalidateSummariesCache();
  invalidateQuizSetsCache();
}
