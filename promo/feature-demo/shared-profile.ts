let profile = { nickname: '통크크 체험', avatarUrl: '', school: '', department: '컴퓨터공학', darkMode: false, notificationsEnabled: true, hideSummaryNotice: false };
export const loadUserProfile = async () => ({ ...profile });
export const saveUserProfile = async (next: typeof profile) => (profile = { ...next });
export const updateNotificationsEnabled = async (enabled: boolean) => { profile.notificationsEnabled = enabled; };
export const updateHideSummaryNotice = async (hide: boolean) => { profile.hideSummaryNotice = hide; };
export const uploadAvatar = async () => '';
export const deleteOwnAppData = async () => {};
