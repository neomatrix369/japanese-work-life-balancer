import React, { useState } from 'react';
import { getStoredTheme, setTheme, type Theme } from '../theme';

const OPTIONS: { value: Theme; icon: string; label: string }[] = [
  { value: 'light', icon: '☀', label: 'Light' },
  { value: 'dark', icon: '☾', label: 'Dark' },
  { value: 'system', icon: '🖥', label: 'System' },
];

/**
 * Compact icon toggle (Light / Dark / System) that reads/writes via theme.ts.
 * Small enough to sit on the top bar's first row next to the title.
 */
export function ThemeControl() {
  const [theme, setLocalTheme] = useState<Theme>(getStoredTheme);

  function handleChange(t: Theme) {
    setLocalTheme(t);
    setTheme(t);
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className="theme-toggle-btn"
          aria-pressed={theme === o.value}
          aria-label={`${o.label} theme`}
          title={`${o.label} theme`}
          onClick={() => handleChange(o.value)}
        >
          <span aria-hidden="true">{o.icon}</span>
        </button>
      ))}
    </div>
  );
}
