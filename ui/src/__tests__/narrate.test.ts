/**
 * Author: Japanese Work-Life Balancer team
 * Created: 2026-10-29
 * Scope: tour/narrate.ts and tour/steps.ts — story facts and sentences computed from the
 *        recorded tour fixtures (real 10 s solves), so the tour never shows made-up numbers.
 */
import { normalizePerEmployee } from '../api';
import type { ScheduleResponse } from '../api';
import {
  compareFacts,
  compareSentence,
  longestRun,
  sanName,
  unassignedByReason,
  unassignedSentence,
  weekDates,
  weekWalk,
} from '../tour/narrate';
import { TOUR_STEPS, dwellMs, type NarrationCtx } from '../tour/steps';
import costRec from '../tour/fixtures/burnout-cost-first.json';
import healthRec from '../tour/fixtures/burnout-health-first.json';
import overRec from '../tour/fixtures/overloaded-health-first.json';

const cost = costRec.final as unknown as ScheduleResponse;
const health = healthRec.final as unknown as ScheduleResponse;
const over = overRec.final as unknown as ScheduleResponse;

const BAD_TEXT = /NaN|undefined|null|\[object/;

describe('longestRun', () => {
  it('names the employee whose run is the longest in the plan', () => {
    /**
     * Scenario: the grid callout names one real employee with the longest run.
     * Slice: tour narration.
     * Given the cost-first burnout plan, when we ask for the longest run, then its length
     * equals the largest maxConsecutiveDays the model reports and the name uses "-san".
     */
    // -- Given --
    const reported = Object.values(normalizePerEmployee(cost.perEmployee)).map((p) => p.maxConsecutiveDays);
    // -- When --
    const lr = longestRun(cost);
    // -- Then --
    expect(lr).not.toBeNull();
    expect(lr!.run).toBe(Math.max(...reported));
    expect(lr!.san).toMatch(/-san$/);
    expect(weekDates(cost)).toContain(lr!.date);
  });
});

describe('weekWalk', () => {
  it('counts people per day from the shifts and tells a different person each day', () => {
    /**
     * Scenario: the Monday → Sunday walk narrates each day from data.
     * Slice: tour day walk.
     * Given the health-first plan, when we build the walk, then there are 7 days starting
     * Monday, the working count matches the shifts, and the 7 stories name 7 different people.
     */
    // -- Given / When --
    const walk = weekWalk(health);
    // -- Then --
    expect(walk).toHaveLength(7);
    expect(walk[0].weekday).toBe('Monday');
    for (const d of walk) {
      expect(d.working).toBe(health.shifts[d.date]?.length ?? 0);
      expect(d.longRun).toBeLessThanOrEqual(d.working);
      expect(d.story).not.toMatch(BAD_TEXT);
    }
    const names = walk.map((d) => d.story.split('-san')[0]);
    expect(new Set(names).size).toBe(7);
  });
});

describe('compare', () => {
  it('reports real deltas and only claims a profit change in the direction the data shows', () => {
    /**
     * Scenario: the compare callout states at-risk A → B and the extra labor cost.
     * Slice: tour compare step.
     * Given cost-first and health-first plans, when we compare them, then the facts equal the
     * KPI differences and the sentence quotes those numbers with the right profit wording.
     */
    // -- Given / When --
    const f = compareFacts(cost, health);
    const s = compareSentence(cost, health, 'GBP');
    // -- Then --
    expect(f.atRiskA).toBe(cost.kpis.atRiskCount);
    expect(f.atRiskB).toBe(health.kpis.atRiskCount);
    expect(f.laborDelta).toBe(health.kpis.totalLaborCost - cost.kpis.totalLaborCost);
    expect(s).toContain(`${f.atRiskA} → ${f.atRiskB}`);
    expect(s).toContain(`¥${Math.abs(f.laborDelta).toLocaleString()}`);
    expect(s).toContain('£');
    if (f.profitDelta > 0) expect(s).toMatch(/Profit went up/);
    if (f.profitDelta < 0) expect(s).toMatch(/lower/);
    expect(s).not.toMatch(BAD_TEXT);
  });

  it('says profit is lower when the second plan earns less', () => {
    /**
     * Scenario: a run where health-first earns less must not say profit went up.
     * Slice: tour compare step.
     * Given the same plans in reverse order (profit falls), when we compare, then the
     * sentence says profit is lower and never "went up".
     */
    // -- Given --
    const fall = compareFacts(health, cost).profitDelta;
    // -- When --
    const s = compareSentence(health, cost, 'JPY');
    // -- Then --
    expect(fall).toBeLessThan(0);
    expect(s).toMatch(/Profit is ¥[\d,]+ lower/);
    expect(s).not.toMatch(/went up/);
  });
});

describe('unassigned', () => {
  it('groups unassigned tasks by reason and quotes the counts', () => {
    /**
     * Scenario: the overloaded week leaves tasks unassigned, each with a reason.
     * Slice: tour overloaded step.
     * Given the overloaded plan, when we group by reason, then the counts add up to the list
     * length and the sentence quotes the total.
     */
    // -- Given / When --
    const groups = unassignedByReason(over);
    const s = unassignedSentence(over);
    // -- Then --
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(over.unassigned.length);
    expect(s).toContain(`${over.unassigned.length} tasks`);
    expect(s).not.toMatch(BAD_TEXT);
  });
});

describe('sanName', () => {
  it('uses the family name, or the full name when the family name is shared', () => {
    /**
     * Scenario: honorifics stay unambiguous.
     * Slice: tour narration.
     * Given a roster with two Hasegawas, when we name them, then they get full names; a unique
     * family name gets the short form.
     */
    // -- Given --
    const roster = ['Hasegawa Yuri', 'Hasegawa Hiroshi', 'Aoki Mei'];
    // -- When / Then --
    expect(sanName('Aoki Mei', roster)).toBe('Aoki-san');
    expect(sanName('Hasegawa Yuri', roster)).toBe('Hasegawa Yuri-san');
  });
});

describe('TOUR_STEPS', () => {
  it('builds every step text from data with numbers and no NaN/undefined', () => {
    /**
     * Scenario: every callout reads cleanly for a finished tour.
     * Slice: tour steps.
     * Given all three results, when each step builds its text, then no text contains
     * NaN/undefined, data steps contain digits, and dwell times stay within 6–9.5 s.
     */
    // -- Given --
    const ctx: NarrationCtx = {
      current: over,
      results: { cost, health, overloaded: over },
      currency: 'USD',
      running: false,
      teamSize: cost.schedule.employees.length,
    };
    for (const step of TOUR_STEPS) {
      // -- When --
      const text = step.text(ctx);
      // -- Then --
      expect(text, step.id).not.toMatch(BAD_TEXT);
      if (step.id !== 'wrap' && step.id !== 'keep-cost') expect(text, step.id).toMatch(/\d/);
      expect(dwellMs(text)).toBeGreaterThanOrEqual(6000);
      expect(dwellMs(text)).toBeLessThanOrEqual(9500);
    }
  });
});
