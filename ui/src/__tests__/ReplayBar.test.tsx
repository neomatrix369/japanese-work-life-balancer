/**
 * Render tests for the ReplayBar component.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReplayBar } from '../components/ReplayBar';
import type { ReplaySnapshot } from '../replay';
import type { ScheduleResponse } from '../api';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSnap(score: string, elapsed: number): ReplaySnapshot {
  return {
    timestamp: Date.now(),
    elapsed,
    score,
    response: { score } as unknown as ScheduleResponse,
  };
}

const SNAPS: ReplaySnapshot[] = [
  makeSnap('0hard/-10medium/-1000soft', 2),
  makeSnap('0hard/-5medium/-2500soft', 5),
  makeSnap('0hard/-2medium/-4000soft', 9),
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ReplayBar', () => {
  it('renders nothing when snapshots array is empty', () => {
    const { container } = render(
      <ReplayBar snapshots={[]} replayIndex={null} onSeek={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders without crashing when snapshots exist', () => {
    const { container } = render(
      <ReplayBar snapshots={SNAPS} replayIndex={null} onSeek={() => undefined} />,
    );
    expect(container).toBeTruthy();
  });

  it('shows hint text', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={null} onSeek={() => undefined} />);
    expect(
      screen.getByText(/Replay how the solver improved/i),
    ).toBeTruthy();
  });

  it('shows correct step label in replay mode', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={1} onSeek={() => undefined} />);
    // Step 2/3 · 5 s · …
    expect(screen.getByText(/Step 2\/3/)).toBeTruthy();
  });

  it('shows Live button when replayIndex is set', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={0} onSeek={() => undefined} />);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('does not show Live button when in live mode (replayIndex null)', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={null} onSeek={() => undefined} />);
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('calls onSeek(null) when Live button is clicked', () => {
    const onSeek = vi.fn();
    render(<ReplayBar snapshots={SNAPS} replayIndex={0} onSeek={onSeek} />);
    fireEvent.click(screen.getByText('Live'));
    expect(onSeek).toHaveBeenCalledWith(null);
  });

  it('shows 1×, 2×, 4× speed buttons', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={null} onSeek={() => undefined} />);
    expect(screen.getByText('1×')).toBeTruthy();
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText('4×')).toBeTruthy();
  });

  it('shows Play button when not playing', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={null} onSeek={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Play replay' })).toHaveTextContent('Play');
  });

  it('slider has correct max value', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={1} onSeek={() => undefined} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('max', String(SNAPS.length - 1));
  });

  it('slider value matches replayIndex', () => {
    render(<ReplayBar snapshots={SNAPS} replayIndex={1} onSeek={() => undefined} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('value', '1');
  });
});
