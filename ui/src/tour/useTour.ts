/**
 * Guided tour state machine. Drives the real app through a small controller
 * (solve / show / keep) so the tour never duplicates panels or solve logic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScheduleResponse } from '../api';
import type { Currency } from '../fx';
import {
  LIVE_TIMEOUT_MS,
  RUNS,
  TOUR_LIMIT_SECONDS,
  loadRecording,
  playRecording,
  solveWithFallback,
  type RunKey,
  type RunSpec,
} from './runs';
import { TOUR_STEPS, dwellMs, stepRunKey, type TourStep } from './steps';
import { SPEECH_TAIL_MS, useTourVoice, type TourVoice } from './useTourVoice'; // voice narration
import { SILENT_NARRATOR, type Narrator } from './voice';

export interface TourController {
  /** start a real solve; resolves with the final response, rejects on failure/stop */
  solveLive: (spec: RunSpec, limitSeconds: number) => Promise<ScheduleResponse>;
  /** stop a live solve silently (no state update from the stop response) */
  stopLive: () => void;
  /** show one frame of a recorded run (first frame resets replay snapshots) */
  applyFrame: (resp: ScheduleResponse, first: boolean, final: boolean) => void;
  /** show a finished result in the panels */
  show: (resp: ScheduleResponse, spec: RunSpec) => void;
  /** keep a result for comparison */
  keep: (resp: ScheduleResponse, spec: RunSpec) => void;
}

export interface TourView {
  current: ScheduleResponse | null;
  currency: Currency;
}

export interface Tour {
  active: boolean;
  index: number;
  total: number;
  step: TourStep;
  text: string;
  paused: boolean;
  running: boolean;
  recorded: boolean;
  isLast: boolean;
  start: () => void;
  next: () => void;
  back: () => void;
  togglePause: () => void;
  exit: () => void;
  /** voice narration: mute toggle + "browser voice" note */
  voice: TourVoice;
}

const PLAY_BUTTON_SELECTOR = '[data-tour="play"]';

export function useTour(
  controller: TourController,
  view: TourView,
  steps: TourStep[] = TOUR_STEPS,
  narrator: Narrator = SILENT_NARRATOR,
): Tour {
  const ctrlRef = useRef(controller);
  ctrlRef.current = controller;

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Partial<Record<RunKey, ScheduleResponse>>>({});
  const [recordedKeys, setRecordedKeys] = useState<Partial<Record<RunKey, boolean>>>({});
  const [teamSize, setTeamSize] = useState<number | null>(null);

  const tokenRef = useRef(0);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const runningRef = useRef(running);
  runningRef.current = running;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const ctx = { current: view.current, results, currency: view.currency, running, teamSize };
  const text = step.text(ctx);
  const textRef = useRef(text);
  textRef.current = text;
  const runKey = stepRunKey(step);
  const recorded = !!(runKey && recordedKeys[runKey]);
  // Declared before auto-advance so its speech is queued before the dwell waits on it.
  const voice = useTourVoice(narrator, { active, index, paused, steps, ctx });

  // ── Step entry: run the step's action ─────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const token = ++tokenRef.current;
    const isCurrent = () => token === tokenRef.current;
    const s = steps[index];
    const ctrl = ctrlRef.current;
    const done = resultsRef.current;

    if (s.solve && !done[s.solve]) {
      const key = s.solve;
      const spec = RUNS[key];
      setRunning(true);
      setRecordedKeys((k) => ({ ...k, [key]: false }));
      void solveWithFallback(
        () => ctrlRef.current.solveLive(spec, TOUR_LIMIT_SECONDS),
        async () => {
          const rec = await loadRecording(key);
          let first = true;
          return playRecording(
            rec,
            (resp, final) => {
              if (!isCurrent()) return;
              ctrlRef.current.applyFrame(resp, first, final);
              first = false;
            },
            () => !isCurrent(),
          );
        },
        LIVE_TIMEOUT_MS,
        () => {
          if (!isCurrent()) return;
          ctrlRef.current.stopLive();
          setRecordedKeys((k) => ({ ...k, [key]: true }));
        },
      ).then((outcome) => {
        if (!isCurrent()) return;
        setResults((r) => ({ ...r, [key]: outcome.response }));
        setRecordedKeys((k) => ({ ...k, [key]: outcome.recorded }));
        setRunning(false);
      });
      return;
    }

    setRunning(false);
    const key = stepRunKey(s);
    if (key && done[key]) ctrl.show(done[key]!, RUNS[key]);
    if (s.keep && done[s.keep]) ctrl.keep(done[s.keep]!, RUNS[s.keep]);
  }, [active, index, steps]);

  // ── Collapsible panels: open any closed <details> that is or contains the tour target ──
  // Tracks { element → previous open state } for all panels opened by the tour.
  const panelStateRef = useRef<Map<HTMLDetailsElement, boolean>>(new Map());

  useEffect(() => {
    if (!active || !step.target) return;
    const targetEl = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!targetEl) return;

    const openIfClosed = (el: HTMLDetailsElement) => {
      if (!el.open) {
        if (!panelStateRef.current.has(el)) panelStateRef.current.set(el, false);
        el.open = true;
      }
    };

    // Open the target itself if it is a <details>
    if (targetEl instanceof HTMLDetailsElement) openIfClosed(targetEl);

    // Open any closed <details> ancestors of the target
    let anc: Element | null = targetEl.parentElement;
    while (anc) {
      if (anc instanceof HTMLDetailsElement) openIfClosed(anc);
      anc = anc.parentElement;
    }

    // For non-details targets (e.g. data-tour="kpis"), also open any closed
    // descendant <details> panels so the KPI content is visible.
    if (!(targetEl instanceof HTMLDetailsElement)) {
      targetEl.querySelectorAll<HTMLDetailsElement>('details').forEach(openIfClosed);
    }
  }, [active, step.target, index]);

  const restoreAllPanels = useCallback(() => {
    panelStateRef.current.forEach((wasOpen, el) => { el.open = wasOpen; });
    panelStateRef.current.clear();
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────
  const leaveStep = useCallback(() => {
    if (runningRef.current) ctrlRef.current.stopLive();
  }, []);

  const next = useCallback(() => {
    if (runningRef.current) return; // wait for the solver
    setIndex((i) => Math.min(steps.length - 1, i + 1));
  }, [steps.length]);

  const back = useCallback(() => {
    leaveStep();
    setIndex((i) => Math.max(0, i - 1));
  }, [leaveStep]);

  const start = useCallback(() => {
    narrator.unlock(); // inside the Play click: lets the browser play narration later
    tokenRef.current++;
    setResults({});
    setRecordedKeys({});
    setPaused(false);
    setRunning(false);
    setIndex(0);
    setActive(true);
    loadRecording('cost')
      .then((r) => setTeamSize(r.final.schedule.employees.length))
      .catch(() => setTeamSize(null));
  }, [narrator]);

  const exit = useCallback(() => {
    leaveStep();
    restoreAllPanels();
    tokenRef.current++;
    setActive(false);
    setRunning(false);
    setPaused(false);
    setTimeout(() => document.querySelector<HTMLElement>(PLAY_BUTTON_SELECTOR)?.focus(), 0);
  }, [leaveStep, restoreAllPanels]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  // ── Auto-advance: after the dwell AND after the spoken line (+ a short tail) ──
  useEffect(() => {
    if (!active || paused || running || isLast) return;
    const until = Date.now() + dwellMs(textRef.current);
    let live = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    void voice.spoken().then(() => {
      if (live) t = setTimeout(next, Math.max(until - Date.now(), SPEECH_TAIL_MS));
    });
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [active, paused, running, isLast, index, next, voice.spoken]);

  // ── Keyboard: Space pause, ←/→ back/next, Esc exit ────────────────────────
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        exit();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      } else if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, exit, next, back, togglePause]);

  return {
    active,
    index,
    total: steps.length,
    step,
    text,
    paused,
    running,
    recorded,
    isLast,
    start,
    next,
    back,
    togglePause,
    exit,
    voice,
  };
}
