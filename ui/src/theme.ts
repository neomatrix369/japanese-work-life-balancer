/**
 * Theme management — Light / Dark / System.
 * Wraps localStorage in try/catch so it works in private browsing and
 * environments where storage is blocked.
 */

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';
const VALID: ReadonlySet<string> = new Set<Theme>(['light', 'dark', 'system']);

/** Read the stored theme from localStorage; returns 'light' when absent or on error. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && VALID.has(stored)) return stored as Theme;
  } catch {
    // localStorage blocked (private window, storage quota, etc.)
  }
  return 'light';
}

/**
 * Persist the theme and apply it to the document root immediately by setting
 * `document.documentElement.dataset.theme`.  CSS uses this attribute to select
 * the right token overrides.
 */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // best-effort; the visual state below still applies
  }
  document.documentElement.dataset.theme = theme;
}
