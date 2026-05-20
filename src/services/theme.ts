const THEME_STYLE_ID = "tongkk-theme-style";

const ensureThemeStyle = () => {
  if (document.getElementById(THEME_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = THEME_STYLE_ID;
  style.textContent = `
    html[data-theme="dark"] body,
    html[data-theme="dark"] #root {
      background: #101820 !important;
      color: #E8EDF3 !important;
    }

    html[data-theme="dark"] #root > div {
      background: #101820 !important;
      color: #E8EDF3 !important;
    }

    html[data-theme="dark"] #root h1,
    html[data-theme="dark"] #root h2,
    html[data-theme="dark"] #root h3,
    html[data-theme="dark"] #root h4 {
      color: #F8FAFC !important;
    }

    html[data-theme="dark"] #root p {
      color: #CBD5E1 !important;
    }

    html[data-theme="dark"] .tongkk-card,
    html[data-theme="dark"] .tongkk-sidebar {
      background: #151F2A !important;
      border-color: #263241 !important;
      box-shadow: 0 1px 8px rgba(0,0,0,0.28) !important;
    }

    html[data-theme="dark"] .tongkk-card,
    html[data-theme="dark"] .tongkk-card div,
    html[data-theme="dark"] .tongkk-card button {
      border-color: #2B3A4B !important;
    }

    html[data-theme="dark"] .tongkk-card h1,
    html[data-theme="dark"] .tongkk-card h2,
    html[data-theme="dark"] .tongkk-card h3,
    html[data-theme="dark"] .tongkk-card h4,
    html[data-theme="dark"] .tongkk-card p,
    html[data-theme="dark"] .tongkk-card span,
    html[data-theme="dark"] .tongkk-card div,
    html[data-theme="dark"] .tongkk-sidebar button {
      color: #E8EDF3 !important;
    }

    html[data-theme="dark"] input,
    html[data-theme="dark"] textarea {
      background: #101820 !important;
      border-color: #2B3A4B !important;
      color: #E8EDF3 !important;
    }

    html[data-theme="dark"] input::placeholder,
    html[data-theme="dark"] textarea::placeholder {
      color: #748295 !important;
    }
  `;
  document.head.appendChild(style);
};

export function applyTheme(darkMode: boolean) {
  ensureThemeStyle();
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
}
