/**
 * Tour solve runs: which scenario/preset each run uses, the recorded fallback
 * fixtures, and a "live with recorded fallback" runner.
 *
 * Fixtures are recorded from a running model with `node scripts/record-tour-fixtures.mjs`
 * and loaded lazily (separate chunks), so they cost nothing unless the tour runs.
 */
import type { CompanyKpis, Preset, ScheduleResponse } from '../api';

export type RunKey = 'cost' | 'health' | 'overloaded';

export interface RunSpec {
  scenario: string;
  preset: Preset;
}

export const RUNS: Record<RunKey, RunSpec> = {
  cost: { scenario: 'burnout', preset: 'cost-first' },
  health: { scenario: 'burnout', preset: 'health-first' },
  overloaded: { scenario: 'overloaded', preset: 'health-first' },
};

export const TOUR_LIMIT_SECONDS = 10;
export const LIVE_TIMEOUT_MS = 25_000;

export interface Recording {
  scenario: string;
  preset: Preset;
  recordedAt: string;
  /** intermediate best scores seen while polling every 2 s */
  progress: { elapsed: number; score: string; kpis: CompanyKpis }[];
  final: ScheduleResponse;
}

const LOADERS: Record<RunKey, () => Promise<{ default: unknown }>> = {
  cost: () => import('./fixtures/burnout-cost-first.json'),
  health: () => import('./fixtures/burnout-health-first.json'),
  overloaded: () => import('./fixtures/overloaded-health-first.json'),
};

export async function loadRecording(key: RunKey): Promise<Recording> {
  const mod = await LOADERS[key]();
  return mod.default as Recording;
}

/** Frames to show while "replaying" a recording: intermediate KPIs on the final plan, then the final. */
export function recordingFrames(rec: Recording): ScheduleResponse[] {
  const frames = rec.progress
    .slice(0, -1)
    .map((p) => ({ ...rec.final, kpis: p.kpis, score: p.score, status: 'SOLVING_ACTIVE' as const }));
  return [...frames, rec.final];
}

export interface RunOutcome {
  response: ScheduleResponse;
  recorded: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `live`; if it rejects or exceeds `timeoutMs`, call `onFallback` and use `recorded` instead.
 * Never rejects unless the recorded run itself fails.
 */
export async function solveWithFallback(
  live: () => Promise<ScheduleResponse>,
  recorded: () => Promise<ScheduleResponse>,
  timeoutMs: number,
  onFallback?: (why: 'error' | 'timeout') => void,
): Promise<RunOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), timeoutMs);
  });
  let why: 'error' | 'timeout';
  try {
    const res = await Promise.race([live(), timeout]);
    if (res !== 'timeout') return { response: res, recorded: false };
    why = 'timeout';
  } catch {
    why = 'error';
  } finally {
    clearTimeout(timer);
  }
  onFallback?.(why);
  return { response: await recorded(), recorded: true };
}

/** Play a recording's frames through `apply`, stopping early when `cancelled()` turns true. */
export async function playRecording(
  rec: Recording,
  apply: (resp: ScheduleResponse, isFinal: boolean) => void,
  cancelled: () => boolean,
  frameMs = 1500,
): Promise<ScheduleResponse> {
  const frames = recordingFrames(rec);
  for (let i = 0; i < frames.length; i++) {
    if (cancelled()) break;
    const isFinal = i === frames.length - 1;
    apply(frames[i], isFinal);
    if (!isFinal) await sleep(frameMs);
  }
  return rec.final;
}
