import type { User } from '@supabase/supabase-js';
import { invalidateCoursesCache } from './courses';
import { invalidateMaterialsCache, MATERIAL_STORAGE_BUCKET } from './materials';
import { invalidateQuizSetsCache } from './quizSets';
import { invalidateSummariesCache } from './summaries';
import { deleteStoragePrefix, formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type UserProfile = {
  nickname: string;
  avatarUrl: string | null;
  school: string | null;
  department: string | null;
  darkMode: boolean;
  notificationsEnabled: boolean;
  hideSummaryNotice: boolean;
};

type ProfileRow = {
  nickname: string;
  avatar_url: string | null;
  school: string | null;
  department: string | null;
  dark_mode: boolean;
  notifications_enabled: boolean;
  hide_summary_notice: boolean;
};

const PROFILE_COLUMNS = 'nickname, avatar_url, school, department, dark_mode, notifications_enabled, hide_summary_notice';
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const validateAvatar = async (file: File): Promise<{ extension: string; contentType: string }> => {
  if (file.size <= 0) throw new Error('비어 있는 이미지는 업로드할 수 없습니다.');
  if (file.size > MAX_AVATAR_BYTES) throw new Error('프로필 이미지는 5MB 이하만 업로드할 수 있습니다.');

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...header);
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (header.length >= 8 && header.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
    return { extension: 'gif', contentType: 'image/gif' };
  }
  throw new Error('JPG, PNG, WEBP, GIF 이미지 파일만 업로드할 수 있습니다.');
};

const defaultNickname = (user: User) =>
  user.user_metadata?.nickname ||
  user.email?.split('@')[0] ||
  '학생';

const toProfile = (row: ProfileRow): UserProfile => ({
  nickname: row.nickname,
  avatarUrl: row.avatar_url,
  school: row.school,
  department: row.department,
  darkMode: row.dark_mode,
  notificationsEnabled: row.notifications_enabled,
  hideSummaryNotice: row.hide_summary_notice,
});

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
    school: null,
    department: null,
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
      school: profile.school,
      department: profile.department,
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
  const { extension, contentType } = await validateAvatar(file);
  const path = `${user.id}/avatar.${extension}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      cacheControl: '3600',
      contentType,
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
  await deleteStoragePrefix(MATERIAL_STORAGE_BUCKET, user.id);

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
