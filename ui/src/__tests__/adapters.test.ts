/**
 * Adapter / normalisation tests against the real API sample response.
 * These run without a backend — the fixture is a copy of the actual GET /schedules/{jobId} payload.
 */
import { normalizePerEmployee } from '../api';
import type { ScheduleResponse } from '../api';
import sampleRaw from './fixtures/api-sample-response.json';

const sample = sampleRaw as unknown as ScheduleResponse;

// ---------- helpers ----------

/** Parse "yyyy-MM-ddTHH:mm:ss" OR "yyyy-MM-ddTHH:mm" without throwing. */
function parseTaskStart(iso: string): Date {
  // Pad to full ISO 8601 so Date.parse handles both variants.
  const padded = iso.length === 16 ? `${iso}:00` : iso;
  return new Date(padded);
}

// ---------- top-level shape ----------

describe('ScheduleResponse top-level fields', () => {
  it('has a string score', () => {
    expect(typeof sample.score).toBe('string');
    expect(sample.score).toMatch(/hard/);
  });

  it('status is a known solver status', () => {
    expect(['NOT_SOLVING', 'SOLVING_ACTIVE', 'SOLVING_SCHEDULED']).toContain(sample.status);
  });

  it('preset is present', () => {
    expect(sample.preset).toBe('health-first');
  });
});

// ---------- KPIs ----------

describe('kpis', () => {
  it('atRiskCount is a number', () => {
    expect(typeof sample.kpis.atRiskCount).toBe('number');
    expect(sample.kpis.atRiskCount).toBeGreaterThan(0);
  });

  it('employeesWorking is 8', () => {
    expect(sample.kpis.employeesWorking).toBe(8);
  });

  it('unassignedCount matches actual unassigned array length', () => {
    expect(sample.kpis.unassignedCount).toBe(sample.unassigned.length);
  });
});

// ---------- perEmployee ----------

describe('normalizePerEmployee', () => {
  const normalized = normalizePerEmployee(sample.perEmployee);

  it('contains 8 employees', () => {
    expect(Object.keys(normalized).length).toBe(8);
  });

  it('is keyed by employeeId', () => {
    expect(normalized['E-001']).toBeDefined();
    expect(normalized['E-008']).toBeDefined();
  });

  it('exposes name on each entry', () => {
    expect(normalized['E-001'].name).toBe('Aoki Haruto');
  });

  it('exposes runDayPerDate', () => {
    expect(normalized['E-002'].runDayPerDate).toBeDefined();
    const run = normalized['E-002'].runDayPerDate!;
    const values = Object.values(run);
    expect(values.length).toBeGreaterThan(0);
    // all values must be positive integers
    for (const v of values) expect(v).toBeGreaterThan(0);
  });

  it('exposes maxHoursPerWeek', () => {
    expect(normalized['E-001'].maxHoursPerWeek).toBe(40);
  });

  it('exposes tenureYears and unplannedAbsenceDays3m', () => {
    expect(normalized['E-005'].tenureYears).toBe(21.3);
    expect(normalized['E-005'].unplannedAbsenceDays3m).toBe(4);
  });
});

// ---------- unassigned ----------

describe('unassigned tasks', () => {
  it('has at least one entry', () => {
    expect(sample.unassigned.length).toBeGreaterThan(0);
  });

  it('every entry has name (not taskName)', () => {
    for (const t of sample.unassigned) {
      expect((t as unknown as Record<string, unknown>)['taskName']).toBeUndefined();
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it('every entry has message (not reasonDetail)', () => {
    for (const t of sample.unassigned) {
      expect((t as unknown as Record<string, unknown>)['reasonDetail']).toBeUndefined();
      expect(typeof t.message).toBe('string');
      expect(t.message.length).toBeGreaterThan(0);
    }
  });

  it('parseTaskStart handles "yyyy-MM-ddTHH:mm:ss" (long) format', () => {
    // Explicitly verify the long format used by both schedule.tasks and unassigned
    const d = parseTaskStart('2026-11-09T13:30:00');
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('parseTaskStart handles "yyyy-MM-ddTHH:mm" (short) format', () => {
    // The API may return the short format; parseTaskStart must normalise it
    const d = parseTaskStart('2026-11-09T13:30');
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('all unassigned start fields are parseable', () => {
    for (const t of sample.unassigned) {
      const d = parseTaskStart(t.start);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  it('all schedule task start fields are parseable', () => {
    for (const t of sample.schedule.tasks) {
      const d = parseTaskStart(t.start);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });
});

// ---------- brokenConstraints ----------

describe('brokenConstraints', () => {
  it('has entries', () => {
    expect(sample.brokenConstraints.length).toBeGreaterThan(0);
  });

  it('matchCount fields are all null in the sample', () => {
    for (const c of sample.brokenConstraints) {
      expect(c.matchCount).toBeNull();
    }
  });

  it('score fields are numbers', () => {
    for (const c of sample.brokenConstraints) {
      expect(typeof c.score).toBe('number');
    }
  });
});

// ---------- longevity ----------

describe('longevity', () => {
  it('has avgTenureYears', () => {
    expect(typeof sample.longevity.avgTenureYears).toBe('number');
  });

  it('does NOT have a perEmployee sub-object', () => {
    const lon = sample.longevity as unknown as Record<string, unknown>;
    expect(lon['perEmployee']).toBeUndefined();
  });

  it('has retention rates', () => {
    expect(sample.longevity.retention?.year1).toBeCloseTo(0.909);
    expect(sample.longevity.retention?.year3).toBeCloseTo(0.795);
    expect(sample.longevity.retention?.year5).toBeCloseTo(0.795);
  });
});

// ---------- schedule.tasks ----------

describe('schedule', () => {
  it('contains publicHolidays array', () => {
    expect(Array.isArray(sample.schedule.publicHolidays)).toBe(true);
  });

  it('each employee has approvedHolidays array', () => {
    for (const emp of sample.schedule.employees) {
      expect(Array.isArray(emp.approvedHolidays)).toBe(true);
    }
  });

  it('score in schedule matches top-level score', () => {
    expect(sample.schedule.score).toBe(sample.score);
  });
});
