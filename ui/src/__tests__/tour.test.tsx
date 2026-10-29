/**
 * Author: Japanese Work-Life Balancer team
 * Created: 2026-10-29
 * Scope: guided tour — live-with-recorded-fallback runner (tour/runs.ts), the TourOverlay
 *        callout (render, controls, viewport placement) and the App-level fallback path when
 *        the model is unreachable.
 */
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import React from 'react';
import type { ScheduleResponse } from '../api';
import { App } from '../App';
import { TourOverlay, clampToViewport, placeCallout } from '../components/TourOverlay';
import { loadRecording, playRecording, recordingFrames, solveWithFallback } from '../tour/runs';
import { useTour, type TourController } from '../tour/useTour';
import type { TourStep, TourTarget } from '../tour/steps';

const LIVE = { score: '0hard/0medium/-1soft' } as unknown as ScheduleResponse;
const RECORDED = { score: 'recorded' } as unknown as ScheduleResponse;

describe('solveWithFallback', () => {
  it('uses the live result when the solve succeeds', async () => {
    /**
     * Scenario: the model is up.
     * Slice: tour reliability.
     * Given a live solve that resolves, when we run with fallback, then the live response
     * is used and no fallback is reported.
     */
    // -- Given --
    const onFallback = vi.fn();
    // -- When --
    const out = await solveWithFallback(async () => LIVE, async () => RECORDED, 1000, onFallback);
    // -- Then --
    expect(out).toEqual({ response: LIVE, recorded: false });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('falls back to the recording when the solve fails', async () => {
    /**
     * Scenario: the model is unreachable.
     * Slice: tour reliability.
     * Given a live solve that rejects, when we run with fallback, then the recorded response
     * is used and the fallback reason is "error".
     */
    // -- Given --
    const onFallback = vi.fn();
    // -- When --
    const out = await solveWithFallback(
      () => Promise.reject(new Error('ECONNREFUSED')),
      async () => RECORDED,
      1000,
      onFallback,
    );
    // -- Then --
    expect(out).toEqual({ response: RECORDED, recorded: true });
    expect(onFallback).toHaveBeenCalledWith('error');
  });

  it('falls back to the recording when the solve takes too long', async () => {
    /**
     * Scenario: the model hangs (machine overloaded).
     * Slice: tour reliability.
     * Given a live solve that never settles, when the timeout passes, then the recorded
     * response is used and the reason is "timeout".
     */
    // -- Given --
    const onFallback = vi.fn();
    // -- When --
    const out = await solveWithFallback(() => new Promise(() => undefined), async () => RECORDED, 20, onFallback);
    // -- Then --
    expect(out.recorded).toBe(true);
    expect(onFallback).toHaveBeenCalledWith('timeout');
  });
});

describe('recorded playback', () => {
  it('plays intermediate frames then the final plan, and stops when cancelled', async () => {
    /**
     * Scenario: the recorded run still shows the numbers changing.
     * Slice: tour reliability.
     * Given a recorded fixture, when we play it, then each intermediate KPI frame is applied
     * before the final one; when cancelled, nothing more is applied.
     */
    // -- Given --
    const rec = await loadRecording('cost');
    const applied: boolean[] = [];
    // -- When --
    const final = await playRecording(rec, (_r, isFinal) => applied.push(isFinal), () => false, 0);
    let calls = 0;
    await playRecording(rec, () => calls++, () => true, 0);
    // -- Then --
    expect(applied).toHaveLength(recordingFrames(rec).length);
    expect(applied.at(-1)).toBe(true);
    expect(final).toBe(rec.final);
    expect(calls).toBe(0);
  });
});

describe('placeCallout', () => {
  it('keeps the callout inside the viewport', () => {
    /**
     * Scenario: callouts never leave the screen at 1280 or 390 px.
     * Slice: tour overlay layout.
     * Given targets near the top, the bottom and a huge one, when we place a 360×200 callout,
     * then it goes below / above / inside, always within the viewport.
     */
    // -- Given --
    const size = { width: 360, height: 200 };
    const vp = { width: 1280, height: 800 };
    // -- When --
    const below = placeCallout({ top: 50, left: 1200, width: 60, height: 40 }, size, vp);
    const above = placeCallout({ top: 600, left: 10, width: 300, height: 150 }, size, vp);
    const inside = placeCallout({ top: 0, left: 0, width: 1280, height: 2000 }, size, vp);
    const narrow = placeCallout({ top: 50, left: 0, width: 390, height: 40 }, size, { width: 390, height: 844 });
    // -- Then --
    expect(below.side).toBe('below');
    expect(below.left + size.width).toBeLessThanOrEqual(vp.width);
    expect(above.side).toBe('above');
    expect(inside.side).toBe('inside');
    expect(inside.top + size.height).toBeLessThanOrEqual(vp.height);
    expect(narrow.left).toBeGreaterThanOrEqual(0);
    // and the spotlight box never sticks out past the screen edge (mobile layout viewport)
    const spot = clampToViewport({ top: -20, left: 0, width: 390, height: 2000 }, 390, 844);
    expect(spot).toEqual({ top: 0, left: 0, width: 390, height: 844 });
  });
});

describe('TourOverlay', () => {
  const base = {
    target: null,
    stepId: 'compare',
    title: 'Side by side',
    text: 'At-risk employees: 29 → 24.',
    index: 7,
    total: 19,
    paused: false,
    running: false,
    recorded: false,
    isLast: false,
    onNext: () => undefined,
    onBack: () => undefined,
    onTogglePause: () => undefined,
    onExit: () => undefined,
    onReplay: () => undefined,
  };

  it('renders an accessible dialog with step indicator and working controls', () => {
    /**
     * Scenario: a presenter steps through the tour.
     * Slice: tour overlay.
     * Given step 8 of 19, when rendered, then it is a dialog with a live text region and the
     * step indicator, and Next / Pause / Skip call their handlers.
     */
    // -- Given --
    const onNext = vi.fn();
    const onTogglePause = vi.fn();
    const onExit = vi.fn();
    render(<TourOverlay {...base} onNext={onNext} onTogglePause={onTogglePause} onExit={onExit} />);
    // -- When --
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    // -- Then --
    const dialog = screen.getByRole('dialog', { name: 'Side by side' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('8 / 19')).toBeInTheDocument();
    expect(screen.getByText(/29 → 24/)).toHaveAttribute('aria-live', 'polite');
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('disables Next while solving and shows the recorded-run note', () => {
    /**
     * Scenario: the solver is still running on a recorded fallback.
     * Slice: tour overlay.
     * Given running and recorded, when rendered, then Next is disabled and the note shows.
     */
    // -- Given / When --
    render(<TourOverlay {...base} running recorded />);
    // -- Then --
    expect(screen.getByRole('button', { name: /Solving/ })).toBeDisabled();
    expect(screen.getByText(/recorded run/)).toBeInTheDocument();
  });

  it('offers Replay tour and Close on the last step', () => {
    /**
     * Scenario: the tour reaches the wrap-up.
     * Slice: tour overlay.
     * Given the last step, when rendered, then Replay tour and Close are offered.
     */
    // -- Given --
    const onReplay = vi.fn();
    render(<TourOverlay {...base} isLast onReplay={onReplay} />);
    // -- When --
    fireEvent.click(screen.getByRole('button', { name: /Replay tour/ }));
    // -- Then --
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(onReplay).toHaveBeenCalled();
  });
});

describe('tour opens closed collapsible panels', () => {
  const ctrl: TourController = {
    solveLive: vi.fn().mockResolvedValue({}),
    stopLive: vi.fn(),
    applyFrame: vi.fn(),
    show: vi.fn(),
    keep: vi.fn(),
  };

  afterEach(() => {
    document.querySelectorAll('[data-tour]').forEach((el) => el.remove());
  });

  it('opens a closed <details data-tour> when the tour navigates to its step', async () => {
    /**
     * Scenario: user collapsed the week-grid panel before starting the tour.
     * Slice: tour panel integration.
     * Given a <details data-tour="week-grid"> that is closed, when the tour advances to a
     * step targeting "week-grid", then the panel is opened automatically.
     */
    // -- Given --
    const panel = document.createElement('details');
    panel.setAttribute('data-tour', 'week-grid');
    panel.open = false;
    document.body.appendChild(panel);

    const steps: TourStep[] = [
      { id: 'intro', title: 'Intro', target: null, text: () => 'Welcome' },
      { id: 'grid', title: 'Grid', target: 'week-grid' as TourTarget, text: () => 'Look at the grid' },
    ];

    // -- When --
    const { result } = renderHook(() =>
      useTour(ctrl, { current: null, currency: 'JPY' }, steps),
    );
    act(() => { result.current.start(); });
    expect(panel.open).toBe(false); // intro step — not targeted yet

    act(() => { result.current.next(); });
    // -- Then --
    await waitFor(() => expect(panel.open).toBe(true));
  });

  it('restores panel to closed when the tour exits', async () => {
    /**
     * Scenario: the tour opened a panel; on exit the user's previous preference is restored.
     * Slice: tour panel integration.
     * Given a closed panel that the tour opens, when exit() is called, then the panel
     * returns to closed.
     */
    // -- Given --
    const panel = document.createElement('details');
    panel.setAttribute('data-tour', 'longevity');
    panel.open = false;
    document.body.appendChild(panel);

    const steps: TourStep[] = [
      { id: 'view', title: 'View', target: 'longevity' as TourTarget, text: () => 'HR view' },
    ];

    const { result } = renderHook(() =>
      useTour(ctrl, { current: null, currency: 'JPY' }, steps),
    );
    // -- When --
    act(() => { result.current.start(); });
    await waitFor(() => expect(panel.open).toBe(true));

    act(() => { result.current.exit(); });
    // -- Then --
    expect(panel.open).toBe(false);
  });
});

describe('App tour with the model down', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the recorded run and still shows real numbers', async () => {
    /**
     * Scenario: the demo laptop loses the model mid-pitch.
     * Slice: tour reliability, end to end in the App.
     * Given every API call fails, when the presenter plays the demo and moves to the first
     * solve step, then the callout says "(recorded run)" and the KPI cards show the recording.
     */
    // -- Given --
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    // jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rec = await loadRecording('cost');
    render(<App />);
    // -- When --
    fireEvent.click(screen.getByRole('button', { name: /Play demo/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Next/ }));
    // -- Then --
    expect(await screen.findByText(/recorded run/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Healthy share')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toHaveTextContent('Plan 1: the cheapest week');
    expect(rec.final.kpis.atRiskCount).toBeGreaterThan(0);
    // -- And Esc exits and focus returns to the Play button --
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: /Play demo/ })).toHaveFocus());
  });
});
