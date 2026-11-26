// Fail closed: the embedded examples never read credentials or contact application services.
export const BACKEND_URL = '';
export const blocked = () => { throw new Error('예시 화면에서는 실제 계정이나 서버에 연결하지 않습니다.'); };
export const supabase = new Proxy({}, { get: blocked });
export const requireSupabaseUser = async () => ({ id: 'demo-user' });
export const formatSupabaseError = (error: { message?: string } | null) => error?.message || '예시 화면 오류';
export const getSupabaseAuthHeader = async () => ({});
export const deleteStoragePrefix = blocked;
export const fetchWithTunnelRetry = blocked;
export const parseApiError = async () => '예시 화면에서는 실제 서버에 연결하지 않습니다.';
export const getJsonRequestHeaders = async () => ({ 'Content-Type': 'application/json' });
export const getAuthRequestHeaders = async () => ({});
export const createPdfPreviewFromUrl = blocked;
