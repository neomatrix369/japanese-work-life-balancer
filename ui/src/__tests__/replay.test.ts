/**
 * Unit tests for the snapshot-recording helper in src/replay.ts.
 *
 * Covers the four invariants:
 *  1. Null/empty score → skip
 *  2. First non-null score → always record
 *  3. Score unchanged + not final → dedup (skip)
 *  4. isFinal=true + score unchanged → replace last (keep count)
 *  5. isFinal=true + score changed → append
 */
import { recordSnapshot } from '../replay';
import type { ScheduleResponse } from '../api';

// ── helpers ──────────────────────────────────────────────────────────────────

function resp(score: string | null): ScheduleResponse {
  return { score } as unknown as ScheduleResponse;
}

const T0 = Date.now() - 10_000; // simulate a solve started 10 s ago

// ── tests ─────────────────────────────────────────────────────────────────────

describe('recordSnapshot — null/empty score', () => {
  it('skips null score', () => {
    expect(recordSnapshot([], resp(null), T0, false)).toHaveLength(0);
  });

  it('skips empty string score', () => {
    expect(recordSnapshot([], resp(''), T0, false)).toHaveLength(0);
  });

  it('does not add to existing snapshots when score is null', () => {
    const base = recordSnapshot([], resp('0hard/-3medium/-1000soft'), T0, false);
    const after = recordSnapshot(base, resp(null), T0, false);
    expect(after).toHaveLength(1);
    expect(after).toBe(base); // same reference — not mutated
  });
});

describe('recordSnapshot — first non-null score', () => {
  it('records the first non-null score', () => {
    const snaps = recordSnapshot([], resp('0hard/-5medium/-200soft'), T0, false);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].score).toBe('0hard/-5medium/-200soft');
  });

  it('snapshot has non-negative elapsed', () => {
    const snaps = recordSnapshot([], resp('0hard/-1medium/-50soft'), T0, false);
    expect(snaps[0].elapsed).toBeGreaterThanOrEqual(0);
  });
});

describe('recordSnapshot — deduplication', () => {
  it('skips when score is unchanged (not final)', () => {
    const s1 = recordSnapshot([], resp('0hard/-3medium/-1000soft'), T0, false);
    const s2 = recordSnapshot(s1, resp('0hard/-3medium/-1000soft'), T0, false);
    expect(s2).toHaveLength(1);
    expect(s2).toBe(s1); // same reference
  });

  it('appends when score changes', () => {
    const s1 = recordSnapshot([], resp('0hard/-5medium/-100soft'), T0, false);
    const s2 = recordSnapshot(s1, resp('0hard/-2medium/-800soft'), T0, false);
    expect(s2).toHaveLength(2);
    expect(s2[1].score).toBe('0hard/-2medium/-800soft');
  });

  it('preserves first snapshot across multiple improvements', () => {
    const s1 = recordSnapshot([], resp('0hard/-5medium/-100soft'), T0, false);
    const s2 = recordSnapshot(s1, resp('0hard/-3medium/-300soft'), T0, false);
    const s3 = recordSnapshot(s2, resp('0hard/-1medium/-600soft'), T0, false);
    expect(s3).toHaveLength(3);
    expect(s3[0].score).toBe('0hard/-5medium/-100soft');
  });
});

describe('recordSnapshot — isFinal', () => {
  it('replaces last entry when score is unchanged but isFinal=true', () => {
    const s1 = recordSnapshot([], resp('0hard/-3medium/-1000soft'), T0, false);
    const s2 = recordSnapshot(s1, resp('0hard/-3medium/-1000soft'), T0, true);
    expect(s2).toHaveLength(1); // still one entry
    expect(s2[0]).not.toBe(s1[0]); // new object (updated timestamp/elapsed)
    expect(s2[0].score).toBe('0hard/-3medium/-1000soft');
  });

  it('appends when score changed and isFinal=true', () => {
    const s1 = recordSnapshot([], resp('0hard/-2medium/-500soft'), T0, false);
    const s2 = recordSnapshot(s1, resp('0hard/-0medium/-1200soft'), T0, true);
    expect(s2).toHaveLength(2);
    expect(s2[1].score).toBe('0hard/-0medium/-1200soft');
  });

  it('records final as first entry when score is new', () => {
    const s1 = recordSnapshot([], resp('0hard/-0medium/-999soft'), T0, true);
    expect(s1).toHaveLength(1);
    expect(s1[0].score).toBe('0hard/-0medium/-999soft');
  });
});
