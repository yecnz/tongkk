// 데모는 실제 외부 권한 팝업을 띄우지 않는다(테스트 환경엔 BroadcastChannel도 없다).
export const openOAuthPopup = (): Window | null => null;
export const goToOAuth = () => {};
export const listenOAuthResult = () => () => {};
export const reportOAuthResult = () => {};
