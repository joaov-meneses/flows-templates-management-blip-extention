import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "../lib/theme";

export function useTheme() {
  // Keep the server and hydration render identical. CSS uses the head bootstrap.
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  useEffect(() => {
    setIsDarkTheme(document.documentElement.dataset.theme === "dark");
    const sync = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const dark =
        event.newValue === "dark" ||
        (event.newValue !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      setIsDarkTheme(dark);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    setIsDarkTheme(theme === "dark");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* Private iframe. */
    }
  }
  return { isDarkTheme, toggleTheme };
}
