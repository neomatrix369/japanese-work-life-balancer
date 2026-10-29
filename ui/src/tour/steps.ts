/**
 * Guided "Play demo" tour — pure step definitions.
 * Each step names the panel it points at (a `data-tour` anchor), what it does on entry
 * (solve / show / keep a run, switch role, highlight a day) and builds its text from data.
 */
import type { Role, ScheduleResponse } from '../api';
import type { Currency } from '../fx';
import type { RunKey } from './runs';
import {
  compareSentence,
  daySentence,
  hardSentence,
  longestRunSentence,
  longevitySentence,
  moneyBoth,
  pct,
  progressSentence,
  resultSentence,
  unassignedSentence,
  weekWalk,
} from './narrate';

export type TourTarget =
  | 'controls'
  | 'kpis'
  | 'kpi-health'
  | 'kpi-business'
  | 'week-grid'
  | 'compare'
  | 'unassigned'
  | 'longevity';

export interface NarrationCtx {
  /** what the panels show right now (live polling frame while solving) */
  current: ScheduleResponse | null;
  results: Partial<Record<RunKey, ScheduleResponse>>;
  currency: Currency;
  /** true while this step's solve is still running */
  running: boolean;
  teamSize: number | null;
}

export interface TourStep {
  id: string;
  title: string;
  /** panel to spotlight; null = centred callout */
  target: TourTarget | null;
  /** run this solve on entry (or re-show it when already done) */
  solve?: RunKey;
  /** show this run's result in the panels on entry */
  show?: RunKey;
  /** keep this run for comparison on entry */
  keep?: RunKey;
  /** role the app shows while on this step */
  role?: Role;
  /** week-grid column (0 = Monday) to highlight */
  highlightDay?: number;
  text: (ctx: NarrationCtx) => string;
}

/** The run a step's numbers come from (used for the "(recorded run)" note). */
export function stepRunKey(step: TourStep): RunKey | undefined {
  return step.solve ?? step.show;
}

const solving = (key: RunKey, intro: string) => (ctx: NarrationCtx) => {
  const done = ctx.results[key];
  if (done && !ctx.running) return `${intro} ${resultSentence(done, ctx.currency)}`;
  return `${intro} Every 2 s the solver finds a better plan. Watch the numbers move. ${progressSentence(ctx.current, ctx.currency)}`;
};

const withRun = (key: RunKey, build: (r: ScheduleResponse, ctx: NarrationCtx) => string) =>
  (ctx: NarrationCtx) => {
    const r = ctx.results[key];
    return r ? build(r, ctx) : 'Waiting for the plan…';
  };

const DAY_STEPS: TourStep[] = Array.from({ length: 7 }, (_, i) => ({
  id: `day-${i}`,
  title: '',
  target: 'week-grid' as const,
  show: 'health' as const,
  highlightDay: i,
  text: withRun('health', (r) => {
    const d = weekWalk(r)[i];
    return `${d.weekday} on the health-first plan. ${daySentence(d)}`;
  }),
})).map((s, i) => ({
  ...s,
  title: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i],
}));

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'intro',
    title: 'A week at a Tokyo company',
    target: 'controls',
    text: (ctx) =>
      `Meet a Tokyo company with ${ctx.teamSize ?? 'its'} employees. Every name and number is fictional. In Japan, long runs of work days are linked to burnout and karoshi (death from overwork). Let's plan next week with these controls.`,
  },
  {
    id: 'solve-cost',
    title: 'Plan 1: the cheapest week',
    target: 'kpis',
    solve: 'cost',
    text: solving('cost', 'We ask for the cheapest plan (cost-first) for the “burnout” week.'),
  },
  {
    id: 'grid-cost',
    title: 'Who works when',
    target: 'week-grid',
    show: 'cost',
    text: withRun('cost', (r) =>
      `Each row is a person, each column a day. Amber = 3rd day in a row, red = 4th or more. ${longestRunSentence(r)}`,
    ),
  },
  {
    id: 'health-cost',
    title: 'Health check',
    target: 'kpi-health',
    show: 'cost',
    text: withRun('cost', (r) =>
      `The cheap plan leans on the same people day after day. ${r.kpis.atRiskCount} people are on a run of 3+ days; only ${pct(r.kpis.healthyShare)} stay healthy (at most 2 days in a row).`,
    ),
  },
  {
    id: 'business-cost',
    title: 'What it costs',
    target: 'kpi-business',
    show: 'cost',
    text: withRun('cost', (r, ctx) =>
      `Labor cost this week: ${moneyBoth(r.kpis.totalLaborCost, ctx.currency)}. ${hardSentence(r)}`,
    ),
  },
  {
    id: 'keep-cost',
    title: 'Keep it for later',
    target: 'compare',
    show: 'cost',
    keep: 'cost',
    text: withRun('cost', () =>
      'We pin this cheap plan here, so we can put the next plan right next to it.',
    ),
  },
  {
    id: 'solve-health',
    title: 'Plan 2: health first',
    target: 'kpis',
    solve: 'health',
    text: solving('health', 'Same week, same people. Now the solver puts health first.'),
  },
  {
    id: 'compare',
    title: 'Side by side',
    target: 'compare',
    show: 'health',
    text: (ctx) => {
      const a = ctx.results.cost;
      const b = ctx.results.health;
      if (!a || !b) return 'Waiting for both plans…';
      return `Health-first versus cost-first. ${compareSentence(a, b, ctx.currency)}`;
    },
  },
  ...DAY_STEPS,
  {
    id: 'solve-overloaded',
    title: 'Plan 3: too much work',
    target: 'kpis',
    solve: 'overloaded',
    text: solving('overloaded', 'A harder week: more work than people. Health-first again.'),
  },
  {
    id: 'unassigned',
    title: 'Nobody is overworked to fit it in',
    target: 'unassigned',
    show: 'overloaded',
    text: withRun('overloaded', (r) =>
      `There's more work than people. Instead of overworking anyone, some tasks wait. ${unassignedSentence(r)}`,
    ),
  },
  {
    id: 'hr',
    title: 'The HR view',
    target: 'longevity',
    show: 'overloaded',
    role: 'HR',
    text: withRun('overloaded', (r) =>
      `HR sees tenure and unplanned absences per person: the long-term signs of overwork. ${longevitySentence(r)}`,
    ),
  },
  {
    id: 'wrap',
    title: 'That’s the idea',
    target: null,
    text: () =>
      'Hard rules are never broken. Health comes before cost, and the cost is visible, in yen and pounds, before anyone signs off the week.',
  },
];

/** Auto-advance dwell time, scaled to text length (6–9.5 s). */
export function dwellMs(text: string): number {
  return Math.min(9500, Math.max(6000, 2500 + text.length * 30));
}
