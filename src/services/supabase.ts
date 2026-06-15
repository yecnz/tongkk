import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase 환경변수 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY가 필요합니다.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 세션(로컬 저장소)에서 사용자를 읽는다. getUser()는 호출마다 인증 서버로 네트워크 검증을 보내
// (쓰기 동작마다 왕복 + AUTH 요청 급증) getSession()은 로컬에서 즉시 읽는다. 모든 테이블이
// RLS(user_id = auth.uid())로 보호되고, 실제 쿼리에 실리는 토큰을 서버가 다시 검증하므로
// 로컬 세션의 user.id만 써도 데이터 격리는 그대로 안전하다.
export const requireSupabaseUser = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) throw new Error('로그인이 필요합니다.');
  return user;
};

export const formatSupabaseError = (error: { message?: string } | null) =>
  error?.message || 'Supabase 요청 실패';

export const getSupabaseAuthHeader = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
