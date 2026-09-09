export const THEME_STORAGE_KEY = "create-templates-theme";

// Runs in the document head, before CSS/content paint and before React hydrates.
// Storage can be blocked in third-party iframes; the extension must still open.
export const themeBootstrap = `(() => {
  let theme;
  try { theme = localStorage.getItem('${THEME_STORAGE_KEY}'); } catch {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;
