// A browser preview must never call the native desktop bridge.
export const isTauri = () => false;
export async function invoke() { throw new Error('Mac 앱에서 사용할 수 있는 기능입니다. 체험 화면에서는 시스템 설정을 변경하지 않습니다.'); }
export async function hasNewWebBuild() { return false; }
