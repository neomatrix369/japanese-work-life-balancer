import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TourOverlayProps {
  /** `data-tour` anchor of the panel to spotlight; null = centred callout */
  target: string | null;
  stepId: string;
  title: string;
  text: string;
  index: number;
  total: number;
  paused: boolean;
  running: boolean;
  recorded: boolean;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onTogglePause: () => void;
  onExit: () => void;
  onReplay: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const MARGIN = 8;
const PAD = 6;
const SHEET_BREAKPOINT = 600;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * Padded target box clipped to the viewport. A fixed element that sticks out past the
 * screen edge would widen the layout viewport on mobile and push the bottom sheet off-screen.
 */
export function clampToViewport(
  r: { top: number; left: number; width: number; height: number },
  vw: number,
  vh: number,
): Box {
  const left = Math.max(0, r.left - PAD);
  const top = Math.max(0, r.top - PAD);
  const right = Math.min(vw, r.left + r.width + PAD);
  const bottom = Math.min(vh, r.top + r.height + PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Position the callout below the target, else above, else pinned inside the viewport bottom. */
export function placeCallout(
  rect: Box | null,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; side: 'below' | 'above' | 'inside' | 'center' } {
  const { width: vw, height: vh } = viewport;
  if (!rect) {
    return {
      top: Math.max(MARGIN, (vh - size.height) / 2),
      left: Math.max(MARGIN, (vw - size.width) / 2),
      side: 'center',
    };
  }
  const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, vw - size.width - MARGIN));
  const below = rect.top + rect.height + GAP;
  if (below + size.height <= vh - MARGIN) return { top: below, left, side: 'below' };
  const above = rect.top - GAP - size.height;
  if (above >= MARGIN) return { top: above, left, side: 'above' };
  return { top: Math.max(MARGIN, vh - size.height - MARGIN), left, side: 'inside' };
}

export function TourOverlay(props: TourOverlayProps) {
  const {
    target, stepId, title, text, index, total, paused, running, recorded, isLast,
    onNext, onBack, onTogglePause, onExit, onReplay,
  } = props;
  const [rect, setRect] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState({ width: 360, height: 180 });
  // On mobile, when the browser UI chrome slides away, window.innerHeight grows and
  // position:fixed;bottom:0 would push the sheet below the visual viewport.
  // Tracking visualViewport.offsetTop lets us shift the sheet's bottom inline style
  // so it stays anchored to the visual viewport bottom, not the layout viewport bottom.
  const [sheetBottom, setSheetBottom] = useState(0);
  const calloutRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  // Track the target's box every frame (panels move while data loads and the page scrolls).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
      if (el && scrolledFor.current !== stepId) {
        scrolledFor.current = stepId;
        const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
        el.scrollIntoView?.({ block: tall ? 'start' : 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
      const r = el?.getBoundingClientRect();
      const next = r ? clampToViewport(r, document.documentElement.clientWidth, window.innerHeight) : null;
      setRect((prev) => (sameBox(prev, next) ? prev : next));
      setViewport((v) =>
        v.width === window.innerWidth && v.height === window.innerHeight
          ? v
          : { width: window.innerWidth, height: window.innerHeight },
      );
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [target, stepId]);

  useLayoutEffect(() => {
    const el = calloutRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth || 360, height: el.offsetHeight || 180 };
    setSize((s) => (s.width === next.width && s.height === next.height ? s : next));
  }, [text, stepId, viewport.width, running]);

  // Keep the sheet anchored to the visual viewport bottom.
  // On mobile, hiding the browser URL bar grows window.innerHeight without moving
  // the visual viewport; visualViewport.offsetTop records the gap. Setting
  // bottom = offsetTop keeps the sheet within the originally-configured viewport height.
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      setSheetBottom(vv ? Math.max(0, Math.round(vv.offsetTop)) : 0);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  // Move focus into the dialog when the tour opens.
  useEffect(() => {
    calloutRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  const sheet = viewport.width <= SHEET_BREAKPOINT;
  const pos = placeCallout(rect, size, viewport);
  // When sheet: pin bottom to visual viewport (sheetBottom = vv.offsetTop).
  // When callout: position by placeCallout coordinates.
  const style: React.CSSProperties = sheet
    ? { bottom: sheetBottom }
    : { top: pos.top, left: pos.left };

  return (
    <div className="tour-root">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={calloutRef}
        className={`tour-callout${sheet ? ' tour-sheet' : ` tour-${pos.side}`}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
      >
        {/* tour-sheet-body scrolls on mobile so the controls below are always pinned */}
        <div className="tour-sheet-body">
          <div className="tour-head">
            <span className="tour-step" aria-label={`Step ${index + 1} of ${total}`}>
              {index + 1} / {total}
            </span>
            <h2 id="tour-title" className="tour-title">{title}</h2>
            <button className="tour-x" onClick={onExit} aria-label="Exit tour" title="Exit (Esc)">×</button>
          </div>
          <p id="tour-text" className="tour-text" aria-live="polite">
            {text}
            {running && <span className="tour-running"> Solving…</span>}
          </p>
          {recorded && <div className="tour-recorded">(recorded run — the live model was not available)</div>}
          <div className="tour-progress" aria-hidden="true">
            <div className="tour-progress-fill" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        {/* controls + hint are always visible — never inside the scrollable body */}
        <div className="tour-controls">
          {isLast ? (
            <>
              <button className="btn" onClick={onBack}>← Back</button>
              <button className="btn" onClick={onReplay}>↺ Replay tour</button>
              <button className="btn btn-primary" onClick={onExit} data-autofocus>Close</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onBack} disabled={index === 0}>← Back</button>
              <button className="btn" onClick={onTogglePause} aria-pressed={paused}>
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="btn btn-primary" onClick={onNext} disabled={running} data-autofocus>
                {running ? 'Solving…' : 'Next →'}
              </button>
              <button className="btn tour-skip" onClick={onExit}>Skip</button>
            </>
          )}
        </div>
        <div className="tour-keys">Space pause · ←/→ back/next · Esc exit</div>
      </div>
    </div>
  );
}
