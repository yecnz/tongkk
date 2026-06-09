// 다크모드 적용 — 색상은 src/index.css의 [data-theme="dark"] 토큰이 책임진다.
// 여기서는 <html>의 data-theme 속성만 토글하면 토큰이 라이트/다크로 전환된다.
export function applyTheme(darkMode: boolean) {
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
}
