import { createClient } from '@supabase/supabase-js';

// 클라이언트를 모듈 로드 시점이 아니라 첫 사용 시점에 만든다(지연 초기화). 예전에는 top-level에서
// 환경변수가 없으면 곧장 throw 했는데, 그러면 supabase를 간접 import만 하는 순수 로직 테스트
// (예: summaryStream → backend → supabase 경로로 끌려오는 splitMarkdownIntoChunks 테스트)까지
// 환경변수 없는 CI의 import 단계에서 스위트째로 깨졌다. 지연 초기화하면 실제로 클라이언트를
// 건드릴 때만 환경변수를 검사하므로, 순수 로직 테스트는 환경변수 없이도 import된다.
function createSupabaseClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 환경변수 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY가 필요합니다.');
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

// 호출부가 기대하는 클라이언트 타입은 createClient(url, key) "호출 결과"에서 그대로 끌어온다.
// (ReturnType<typeof createClient>처럼 제네릭 함수 자체에서 뽑으면 스키마가 never로 붕괴한다.)
type SupabaseClient = ReturnType<typeof createSupabaseClient>;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) client = createSupabaseClient();
  return client;
}

// 기존 `import { supabase }` 호출부(11개 파일·25곳)를 그대로 두기 위해 Proxy로 감싼다.
// 속성에 처음 접근하는 순간 getClient()로 실제 클라이언트를 만들어 위임한다.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getClient();
    const value = Reflect.get(c, prop);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});

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
