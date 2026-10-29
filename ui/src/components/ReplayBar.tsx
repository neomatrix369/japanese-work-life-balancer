import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplaySnapshot } from '../replay';

interface ReplayBarProps {
  snapshots: ReplaySnapshot[];
  /** null = live (show the final/latest result); number = replay frame index */
  replayIndex: number | null;
  onSeek: (index: number | null) => void;
}

type Speed = 1 | 2 | 4;
const SPEED_OPTIONS: Speed[] = [1, 2, 4];

export function ReplayBar({ snapshots, replayIndex, onSeek }: ReplayBarProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Mutable playhead so the interval doesn't go stale when user seeks. */
  const playheadRef = useRef(0);

  const count = snapshots.length;
  // When in live mode, show the last snapshot position in the slider.
  const displayIdx = replayIndex ?? count - 1;
  const isLive = replayIndex === null;
  const current = snapshots[displayIdx] ?? null;

  // ── Interval management ───────────────────────────────────────────────────

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Keep the ref in sync when parent seeks externally.
  useEffect(() => {
    if (replayIndex !== null) playheadRef.current = replayIndex;
  }, [replayIndex]);

  // Start/stop interval when `playing` or `speed` changes.
  useEffect(() => {
    stopInterval();
    if (!playing) return;

    intervalRef.current = setInterval(() => {
      const next = playheadRef.current + 1;
      if (next >= count) {
        // Reached the end → return to live.
        setPlaying(false);
        onSeek(null);
      } else {
        playheadRef.current = next;
        onSeek(next);
      }
    }, Math.round(1000 / speed));

    return stopInterval;
  }, [playing, speed, count, onSeek, stopInterval]);

  // Cleanup on unmount.
  useEffect(() => () => stopInterval(), [stopInterval]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePlayPause = useCallback(() => {
    if (playing) {
      setPlaying(false);
      stopInterval();
      return;
    }
    // Restart from frame 0 if we're at the end or currently live.
    const startIdx = isLive || displayIdx >= count - 1 ? 0 : displayIdx;
    playheadRef.current = startIdx;
    onSeek(startIdx);
    setPlaying(true);
  }, [playing, isLive, displayIdx, count, onSeek, stopInterval]);

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const idx = Number(e.target.value);
      setPlaying(false);
      stopInterval();
      playheadRef.current = idx;
      onSeek(idx);
    },
    [onSeek, stopInterval],
  );

  const handleLive = useCallback(() => {
    setPlaying(false);
    stopInterval();
    onSeek(null);
  }, [onSeek, stopInterval]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (count === 0) return null;

  const stepLabel = current
    ? `Step ${displayIdx + 1}/${count} · ${current.elapsed} s · ${current.score}`
    : `${count} steps`;

  return (
    <div className="replay-bar">
      <div className="replay-hint">
        Replay how the solver improved this week&rsquo;s plan
      </div>
      <div className="replay-controls">
        <button
          className="btn replay-playpause"
          onClick={handlePlayPause}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        <input
          type="range"
          className="replay-slider"
          min={0}
          max={Math.max(0, count - 1)}
          value={displayIdx}
          onChange={handleSlider}
          aria-label="Replay position"
        />

        <span className="replay-label replay-score">{stepLabel}</span>

        <div className="replay-speed-group">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={`btn replay-speed-btn${speed === s ? ' active' : ''}`}
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              aria-label={`Speed ${s}×`}
            >
              {s}×
            </button>
          ))}
        </div>

        {!isLive && (
          <button className="btn btn-primary replay-live" onClick={handleLive}>
            Live
          </button>
        )}
      </div>
    </div>
  );
}
