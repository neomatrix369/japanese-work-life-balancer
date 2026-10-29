import React, { useRef } from 'react';

export interface CollapsiblePanelProps {
  /** Used as the `<details id>` and localStorage key (`jwlb.panel.<id>`). */
  id: string;
  title: React.ReactNode;
  /** Extra content rendered in the summary row, before the chevron. */
  summaryExtra?: React.ReactNode;
  /** Initial open state when localStorage has no saved preference. Defaults to true. */
  defaultOpen?: boolean;
  /** Sets `data-tour` on the `<details>` element for tour targeting. */
  dataTour?: string;
  /** Extra CSS classes appended to `panel-collapsible` on the `<details>` element. */
  className?: string;
  /** Inline styles on the `<details>` element (e.g. flex sizing for KPI groups). */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const LS_PREFIX = 'jwlb.panel.';

function readLS(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(LS_PREFIX + id);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    // localStorage unavailable (private browsing, SecurityError, etc.)
  }
  return fallback;
}

function writeLS(id: string, open: boolean): void {
  try {
    localStorage.setItem(LS_PREFIX + id, String(open));
  } catch {
    // QuotaExceededError or SecurityError — silently ignored
  }
}

/**
 * Reusable collapsible panel built on native `<details>`/`<summary>`.
 *
 * - Keyboard- and screen-reader-accessible via native HTML semantics.
 * - Remembers each panel's open/closed state in `localStorage` (key = `jwlb.panel.<id>`).
 * - Every localStorage access is try/caught so the component never throws in private mode.
 * - Reuses the shared `.panel-collapsible*` / `.panel-chevron` CSS tokens; does not add a
 *   parallel set of styles.
 */
export function CollapsiblePanel({
  id,
  title,
  summaryExtra,
  defaultOpen = true,
  dataTour,
  className,
  style,
  children,
}: CollapsiblePanelProps) {
  // Read localStorage exactly once (on the initial render of this mount).
  // Using a ref instead of state keeps the value stable across re-renders so React never
  // re-sets the native `open` attribute and fights with the browser's own toggle logic.
  const openRef = useRef<boolean | null>(null);
  if (openRef.current === null) {
    openRef.current = readLS(id, defaultOpen);
  }

  return (
    <details
      id={id}
      open={openRef.current}
      data-tour={dataTour}
      className={`panel-collapsible${className ? ' ' + className : ''}`}
      style={style}
      onToggle={(e) => {
        writeLS(id, (e.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="panel-collapsible-summary">
        {title}
        {summaryExtra}
        <span className="panel-chevron" aria-hidden="true">›</span>
      </summary>
      <div className="panel-collapsible-content">{children}</div>
    </details>
  );
}
