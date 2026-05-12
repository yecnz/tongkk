import type { User } from '@supabase/supabase-js';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export type UserProfile = {
  nickname: string;
  avatarUrl: string | null;
  darkMode: boolean;
  notificationsEnabled: boolean;
};

type ProfileRow = {
  nickname: string;
  avatar_url: string | null;
  dark_mode: boolean;
  notifications_enabled: boolean;
};

const defaultNickname = (user: User) =>
  user.user_metadata?.nickname ||
  user.email?.split('@')[0] ||
  '학생';

const toProfile = (row: ProfileRow): UserProfile => ({
  nickname: row.nickname,
  avatarUrl: row.avatar_url,
  darkMode: row.dark_mode,
  notificationsEnabled: row.notifications_enabled,
});

export async function loadUserProfile(): Promise<UserProfile> {
  const user = await requireSupabaseUser();
  const { data, error } = await supabase
    .from('profiles')
    .select('nickname, avatar_url, dark_mode, notifications_enabled')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(formatSupabaseError(error));
  if (data) return toProfile(data);

  return saveUserProfile({
    nickname: defaultNickname(user),
    avatarUrl: null,
    darkMode: false,
    notificationsEnabled: true,
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
    }, {
      onConflict: 'id',
    })
    .select('nickname, avatar_url, dark_mode, notifications_enabled')
    .single<ProfileRow>();

  if (error) throw new Error(formatSupabaseError(error));
  return toProfile(data);
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
  const deletes = [
    () => supabase.from('dashboard_state').delete().eq('user_id', user.id),
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

  const { data, error } = await supabase.storage
    .from('avatars')
    .list(user.id);
  if (error) {
    throw new Error(formatSupabaseError(error));
  }

  const paths = (data || []).map(item => `${user.id}/${item.name}`);
  if (paths.length > 0) {
    const removeResult = await supabase.storage.from('avatars').remove(paths);
    if (removeResult.error) throw new Error(formatSupabaseError(removeResult.error));
  }
}
