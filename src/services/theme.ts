// 다크모드 적용 — 색상은 src/index.css의 [data-theme="dark"] 토큰이 책임진다.
// 여기서는 <html>의 data-theme 속성만 토글하면 토큰이 라이트/다크로 전환된다.
// localStorage 캐시는 index.html의 인라인 스크립트가 첫 페인트 전에 읽어
// 라이트 플래시(FOUC)를 막는 용도다. 진실 원천은 서버 프로필이며 로드 후 이 함수가 보정한다.
const THEME_CACHE_KEY = "tongkk:theme";

export function applyTheme(darkMode: boolean) {
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  try {
    localStorage.setItem(THEME_CACHE_KEY, darkMode ? "dark" : "light");
  } catch {
    // 저장 불가 환경(프라이빗 모드 등)에서는 캐시 없이 동작
  }
}
