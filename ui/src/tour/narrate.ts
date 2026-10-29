/**
 * Pure story facts for the guided tour, computed from a ScheduleResponse.
 * Every number in the tour narration comes from here — nothing is hard-coded,
 * so the same sentences work for a live solve and for a recorded fallback run.
 */
import { normalizePerEmployee, scoreHardCount } from '../api';
import type { Employee, PerEmployeeKpi, ScheduleResponse } from '../api';
import type { Currency } from '../fx';
import { formatMoney } from '../fx';
import { REASON_LABELS } from '../components/UnassignedTable';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Small formatting primitives ─────────────────────────────────────────────

/** ISO yyyy-MM-dd + n days (UTC arithmetic, so the result never depends on the browser zone). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

export function weekDates(resp: ScheduleResponse): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(resp.schedule.weekStart, i));
}

export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Money in ¥, plus the selected currency in brackets when it is not JPY. */
export function moneyBoth(amountJpy: number, currency: Currency): string {
  const jpy = formatMoney(amountJpy, 'JPY');
  return currency === 'JPY' ? jpy : `${jpy} (${formatMoney(amountJpy, currency)})`;
}

/**
 * Japanese honorific form: family name (first token in the data) + "-san".
 * Falls back to the full name when two employees share a family name.
 */
export function sanName(fullName: string, roster: string[] = []): string {
  const family = fullName.split(' ')[0] ?? fullName;
  const shared = roster.filter((n) => n.split(' ')[0] === family).length > 1;
  return `${shared ? fullName : family}-san`;
}

// ── Joined employee view ────────────────────────────────────────────────────

export interface EmployeeView {
  id: string;
  san: string;
  employee: Employee;
  kpi: PerEmployeeKpi;
  /** run position per worked date, including days worked before the week */
  runByDate: Record<string, number>;
}

function computeRuns(hours: Record<string, number>, dates: string[], carryIn: number) {
  const out: Record<string, number> = {};
  let run = carryIn;
  for (const d of dates) {
    if ((hours[d] ?? 0) > 0) out[d] = ++run;
    else run = 0;
  }
  return out;
}

export function employeeViews(resp: ScheduleResponse): EmployeeView[] {
  const per = normalizePerEmployee(resp.perEmployee ?? []);
  const dates = weekDates(resp);
  const roster = resp.schedule.employees.map((e) => e.name);
  return resp.schedule.employees
    .filter((e) => per[e.id])
    .map((e) => {
      const kpi = per[e.id];
      return {
        id: e.id,
        san: sanName(e.name, roster),
        employee: e,
        kpi,
        runByDate:
          kpi.runDayPerDate ??
          computeRuns(kpi.hoursPerDay ?? {}, dates, e.consecutiveDaysBeforeWeek ?? 0),
      };
    });
}

// ── Story facts ─────────────────────────────────────────────────────────────

export interface LongestRun {
  san: string;
  run: number;
  date: string;
  weekday: string;
  carryIn: number;
}

/** The employee with the longest run of consecutive work days (ties → more hours). */
export function longestRun(resp: ScheduleResponse): LongestRun | null {
  let best: { v: EmployeeView; run: number; date: string } | null = null;
  for (const v of employeeViews(resp)) {
    for (const [date, run] of Object.entries(v.runByDate)) {
      const better =
        !best ||
        run > best.run ||
        (run === best.run && (v.kpi.totalHours ?? 0) > (best.v.kpi.totalHours ?? 0));
      if (better) best = { v, run, date };
    }
  }
  if (!best) return null;
  return {
    san: best.v.san,
    run: best.run,
    date: best.date,
    weekday: weekdayName(best.date),
    carryIn: best.v.employee.consecutiveDaysBeforeWeek ?? 0,
  };
}

export function longestRunSentence(resp: ScheduleResponse): string {
  const lr = longestRun(resp);
  if (!lr) return 'Nobody works more than one day in a row.';
  const carry =
    lr.carryIn > 0 ? `, counting ${plural(lr.carryIn, 'day')} worked before Monday` : '';
  return `${lr.san} (fictional) is on day ${lr.run} in a row by ${lr.weekday}${carry}.`;
}

export interface DayFacts {
  date: string;
  weekday: string;
  working: number;
  /** people working this day who are on day 3 or later of a run */
  longRun: number;
  hours: number;
  publicHoliday: boolean;
  story: string;
}

/** Pick one named, data-backed story for a day; avoids people already used. */
function dayStory(views: EmployeeView[], date: string, prev: string | null, used: Set<string>): string {
  const fresh = views.filter((v) => !used.has(v.id));
  const pool = fresh.length > 0 ? fresh : views;
  const worked = (v: EmployeeView, d: string) => (v.kpi.hoursPerDay?.[d] ?? 0) > 0;
  const take = (v: EmployeeView, text: string) => {
    used.add(v.id);
    return text;
  };

  // 1. Someone resting today right after a run of 2+ days.
  const resting = pool
    .map((v) => ({
      v,
      before: prev ? v.runByDate[prev] ?? 0 : v.employee.consecutiveDaysBeforeWeek ?? 0,
    }))
    .filter(({ v, before }) => before >= 2 && !worked(v, date))
    .sort((a, b) => b.before - a.before)[0];
  if (resting) {
    const { v, before } = resting;
    return take(
      v,
      prev
        ? `${v.san} worked ${before} days in a row up to ${weekdayName(prev)}, so today is a rest day.`
        : `${v.san} arrived having already worked ${before} days in a row before Monday, so the plan keeps them home today.`,
    );
  }

  // 2. Someone on an approved holiday.
  const holiday = pool.find((v) => (v.employee.approvedHolidays ?? []).includes(date));
  if (holiday) return take(holiday, `${holiday.san} is on approved holiday, and the plan works around it.`);

  // 3. The longest run still going today.
  const onRun = pool
    .filter((v) => worked(v, date))
    .sort((a, b) => (b.runByDate[date] ?? 0) - (a.runByDate[date] ?? 0))[0];
  if (onRun) {
    const n = onRun.runByDate[date] ?? 1;
    const h = onRun.kpi.hoursPerDay[date] ?? 0;
    return take(onRun, `${onRun.san} works ${h} h today, day ${n} in a row.`);
  }
  return 'Nobody is scheduled today.';
}

/** One fact block per day, Monday → Sunday, each with a different named employee. */
export function weekWalk(resp: ScheduleResponse): DayFacts[] {
  const views = employeeViews(resp);
  const dates = weekDates(resp);
  const publicHols = new Set(resp.schedule.publicHolidays ?? []);
  const used = new Set<string>();
  return dates.map((date, i) => {
    const workingViews = views.filter((v) => (v.kpi.hoursPerDay?.[date] ?? 0) > 0);
    return {
      date,
      weekday: weekdayName(date),
      working: resp.shifts?.[date]?.length ?? workingViews.length,
      longRun: workingViews.filter((v) => (v.runByDate[date] ?? 0) >= 3).length,
      hours: Math.round(workingViews.reduce((s, v) => s + (v.kpi.hoursPerDay[date] ?? 0), 0)),
      publicHoliday: publicHols.has(date),
      story: dayStory(views, date, i > 0 ? dates[i - 1] : null, used),
    };
  });
}

export function daySentence(d: DayFacts): string {
  const hol = d.publicHoliday ? ' It is a public holiday.' : '';
  return `${plural(d.working, 'person', 'people')} work ${d.hours} h in total; ${d.longRun} of them are on day 3+ of a run.${hol} ${d.story}`;
}

export interface CompareFacts {
  atRiskA: number;
  atRiskB: number;
  healthyA: number;
  healthyB: number;
  laborA: number;
  laborB: number;
  laborDelta: number;
  laborPct: number;
  profitDelta: number;
}

export function compareFacts(a: ScheduleResponse, b: ScheduleResponse): CompareFacts {
  const laborA = a.kpis.totalLaborCost ?? 0;
  const laborB = b.kpis.totalLaborCost ?? 0;
  return {
    atRiskA: a.kpis.atRiskCount ?? 0,
    atRiskB: b.kpis.atRiskCount ?? 0,
    healthyA: a.kpis.healthyShare ?? 0,
    healthyB: b.kpis.healthyShare ?? 0,
    laborA,
    laborB,
    laborDelta: laborB - laborA,
    laborPct: laborA === 0 ? 0 : ((laborB - laborA) / laborA) * 100,
    profitDelta: (b.kpis.companyProfit ?? 0) - (a.kpis.companyProfit ?? 0),
  };
}

function signedPct(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
}

/** Truthful comparison sentence: labor cost first; profit only in the direction the data shows. */
export function compareSentence(a: ScheduleResponse, b: ScheduleResponse, currency: Currency): string {
  const f = compareFacts(a, b);
  const risk = `At-risk employees: ${f.atRiskA} → ${f.atRiskB}. Healthy share: ${pct(f.healthyA)} → ${pct(f.healthyB)}.`;
  const labor =
    f.laborDelta > 0
      ? `Extra labor cost: +${moneyBoth(f.laborDelta, currency)}, ${signedPct(f.laborPct)}.`
      : f.laborDelta < 0
        ? `Labor cost even went down by ${moneyBoth(-f.laborDelta, currency)} (${signedPct(f.laborPct)}).`
        : 'Labor cost is unchanged.';
  const profit =
    f.profitDelta > 0
      ? ` Profit went up by ${moneyBoth(f.profitDelta, currency)} too: different people, with different billing rates, did the work.`
      : f.profitDelta < 0
        ? ` Profit is ${moneyBoth(-f.profitDelta, currency)} lower. That is the visible price of protecting health.`
        : '';
  return `${risk} ${labor}${profit}`;
}

export interface ReasonCount {
  reason: string;
  label: string;
  count: number;
}

export function unassignedByReason(resp: ScheduleResponse): ReasonCount[] {
  const counts = new Map<string, number>();
  for (const t of resp.unassigned ?? []) counts.set(t.reason, (counts.get(t.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: REASON_LABELS[reason] ?? reason, count }))
    .sort((x, y) => y.count - x.count);
}

export function unassignedSentence(resp: ScheduleResponse): string {
  const total = resp.unassigned?.length ?? 0;
  if (total === 0) return 'Every task is assigned.';
  const parts = unassignedByReason(resp)
    .map((r) => `${r.count} × “${r.label.toLowerCase()}”`)
    .join(', ');
  return `${plural(total, 'task')} stay unassigned, each with a reason: ${parts}. Hard rules broken: ${scoreHardCount(resp.score ?? '')}.`;
}

export function hardSentence(resp: ScheduleResponse): string {
  const hard = scoreHardCount(resp.score ?? '');
  return hard === 0
    ? 'The score shows 0 hard: no legal rule (hours, rest, holidays) is broken.'
    : `The score shows ${hard} hard: some legal rules are still broken.`;
}

export function progressSentence(resp: ScheduleResponse | null, currency: Currency): string {
  if (!resp?.kpis || !resp.score) return 'Waiting for the first plan…';
  return `Right now: ${plural(resp.kpis.atRiskCount ?? 0, 'person', 'people')} at risk, labor cost ${formatMoney(resp.kpis.totalLaborCost ?? 0, currency)}, score ${resp.score}.`;
}

export function resultSentence(resp: ScheduleResponse, currency: Currency): string {
  const team = resp.schedule.employees.length;
  return `Finished: ${resp.kpis.atRiskCount ?? 0} of ${team} people at risk, labor cost ${formatMoney(resp.kpis.totalLaborCost ?? 0, currency)}, ${scoreHardCount(resp.score ?? '')} hard-rule breaks.`;
}

export function longevitySentence(resp: ScheduleResponse): string {
  const l = resp.longevity;
  if (!l) return 'No longevity data in this run.';
  return `Average tenure ${l.avgTenureYears.toFixed(1)} years, ${l.totalUnplannedAbsenceDays} unplanned absence days in 3 months, 1-year retention ${pct(l.retention?.year1 ?? 0)} (MOCK figures).`;
}
