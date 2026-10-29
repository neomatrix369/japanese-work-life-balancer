import React, { useState } from 'react';
import { getStoredTheme, setTheme, type Theme } from '../theme';

/**
 * Self-contained theme selector that reads/writes via theme.ts.
 * Rendered inside TopBar; keeps TopBar's prop interface unchanged.
 */
export function ThemeControl() {
  const [theme, setLocalTheme] = useState<Theme>(getStoredTheme);

  function handleChange(t: Theme) {
    setLocalTheme(t);
    setTheme(t);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <label htmlFor="theme-select" style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        Theme
      </label>
      <select
        id="theme-select"
        value={theme}
        onChange={(e) => handleChange(e.target.value as Theme)}
        aria-label="Colour theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </div>
  );
}
