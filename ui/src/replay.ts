/**
 * Solver replay — snapshot recording helpers.
 *
 * A snapshot is captured each time the UI polls the solver and the score
 * changes.  The first non-null score and the final result are always kept.
 * Null/empty scores (early in the solve) are skipped.
 */
import type { ScheduleResponse } from './api';

export interface ReplaySnapshot {
  /** ms since epoch when snapshot was taken */
  timestamp: number;
  /** whole seconds since the solve was started */
  elapsed: number;
  /** score string, e.g. "0hard/-3medium/-12345soft" */
  score: string;
  /** full server response frozen at this poll cycle */
  response: ScheduleResponse;
}

/**
 * Immutably append a new snapshot, applying these rules:
 *  1. Skip if `response.score` is null or empty.
 *  2. Always record the very first non-null score.
 *  3. Deduplicate: skip if score unchanged from the previous snapshot
 *     (unless `isFinal` is true).
 *  4. `isFinal = true`: always record; if score is unchanged, replace the
 *     last entry (so the final timestamp / elapsed is correct).
 */
export function recordSnapshot(
  snapshots: ReplaySnapshot[],
  response: ScheduleResponse,
  startTime: number,
  isFinal: boolean,
): ReplaySnapshot[] {
  const score = response.score;
  if (!score) return snapshots; // null or empty — skip

  const snap: ReplaySnapshot = {
    timestamp: Date.now(),
    elapsed: Math.max(0, Math.round((Date.now() - startTime) / 1000)),
    score,
    response,
  };

  if (snapshots.length === 0) return [snap]; // always record first

  const prev = snapshots[snapshots.length - 1];

  if (prev.score === score) {
    if (!isFinal) return snapshots; // dedup unchanged score
    return [...snapshots.slice(0, -1), snap]; // replace last with final
  }

  return [...snapshots, snap]; // score changed — append
}
