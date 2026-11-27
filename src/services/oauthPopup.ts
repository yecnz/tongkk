// 외부 서비스(구글 캘린더, 노션 등) 권한 화면을 팝업으로 띄우고 결과를 원래 창에 알린다.
// 팝업은 외부 로그인 페이지를 거치며 window.opener가 끊길 수 있어, 같은 사이트 창끼리 BroadcastChannel로 주고받는다.
const channelName = (provider: string) => `tongkk-oauth:${provider}`;

// 팝업 차단을 피하려면 클릭 직후, 서버 요청(await) 전에 호출해야 한다.
export const openOAuthPopup = () => window.open('', 'tongkk-oauth', 'popup,width=520,height=680');

// 팝업이 차단됐으면 지금 탭에서 이동한다.
export function goToOAuth(popup: Window | null, url: string) {
  if (popup) popup.location.href = url; else window.location.assign(url);
}

export function listenOAuthResult(provider: string, onResult: (error?: string) => void) {
  const channel = new BroadcastChannel(channelName(provider));
  channel.onmessage = (e: MessageEvent<{ error?: string }>) => onResult(e.data?.error);
  return () => channel.close();
}

// 팝업이 아닌 일반 탭이면 close()가 무시돼 콜백 화면이 그대로 남는다.
export function reportOAuthResult(provider: string, error?: string) {
  const channel = new BroadcastChannel(channelName(provider));
  channel.postMessage({ error }); channel.close();
  window.close();
}
