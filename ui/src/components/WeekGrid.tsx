import React from 'react';
import type { WorkSchedule, PerEmployeeKpi } from '../api';
import type { Currency } from '../types';
import { formatMoney } from '../fx';

interface WeekGridProps {
  schedule: WorkSchedule;
  perEmployee: Record<string, PerEmployeeKpi>;
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string | null) => void;
  currency: Currency;
  /** ISO date of a column to highlight (guided tour day walk) */
  highlightDate?: string | null;
}

/** Return ISO yyyy-MM-dd for weekStart + offset days */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Short day label: Mon 10 Nov */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * For each worked day in the week, compute the consecutive-run position
 * (1 = first day of this run, 2 = second, …).
 * carryIn = consecutiveDaysBeforeWeek (days already worked before weekStart).
 */
function computeRunPositions(
  hoursPerDay: Record<string, number>,
  weekDays: string[],
  carryIn: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  let run = carryIn;
  for (const day of weekDays) {
    const worked = (hoursPerDay[day] ?? 0) > 0;
    if (worked) {
      run++;
      result[day] = run;
    } else {
      run = 0;
    }
  }
  return result;
}

function cellClass(
  day: string,
  approvedHolidays: Set<string>,
  publicHolidays: Set<string>,
  runPos: number | undefined,
  worked: boolean,
): string {
  if (publicHolidays.has(day)) return 'cell-public-holiday';
  if (approvedHolidays.has(day)) return 'cell-approved-holiday';
  if (!worked) return 'cell-not-working';
  if (runPos === undefined || runPos <= 2) return 'cell-run-1';
  if (runPos === 3) return 'cell-run-3';
  return 'cell-run-4plus';
}

export function WeekGrid({
  schedule,
  perEmployee,
  selectedEmployeeId,
  onSelectEmployee,
  currency,
  highlightDate = null,
}: WeekGridProps) {
  const hl = (day: string) => (day === highlightDate ? ' col-highlight' : '');
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(schedule.weekStart, i));
  const publicHols = new Set(schedule.publicHolidays ?? []);

  return (
    <div className="card" data-tour="week-grid">
      <div className="card-title">
        Week Grid — {schedule.name ?? ''} &nbsp;
        <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--fg-muted)' }}>
          Click row to see tasks
        </span>
      </div>
      <div className="week-grid-wrap">
        <table className="week-grid">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Employee</th>
              {weekDays.map((d) => (
                <th key={d} className={`${publicHols.has(d) ? 'cell-public-holiday' : ''}${hl(d)}` || undefined}>
                  {dayLabel(d)}
                </th>
              ))}
              <th style={{ textAlign: 'left' }}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {schedule.employees.map((emp) => {
              const kpi = perEmployee[emp.id];
              const hoursPerDay = kpi?.hoursPerDay ?? {};
              const approvedHols = new Set(emp.approvedHolidays ?? []);
              // Prefer server-computed runDayPerDate; fall back to local computation for
              // robustness (e.g. older API versions or missing field).
              const runPositions: Record<string, number> =
                kpi?.runDayPerDate ??
                computeRunPositions(hoursPerDay, weekDays, emp.consecutiveDaysBeforeWeek ?? 0);
              const isSelected = selectedEmployeeId === emp.id;

              return (
                <tr
                  key={emp.id}
                  className={`clickable${isSelected ? ' selected' : ''}`}
                  onClick={() => onSelectEmployee(isSelected ? null : emp.id)}
                >
                  <td className="employee-name-cell" title={`${emp.id} — ${emp.skills?.join(', ')}`}>
                    {emp.name}
                  </td>
                  {weekDays.map((day) => {
                    const hours = hoursPerDay[day] ?? 0;
                    const worked = hours > 0;
                    const cls = cellClass(day, approvedHols, publicHols, runPositions[day], worked);
                    return (
                      <td key={day} className={`${cls}${hl(day)}`}>
                        {worked ? (
                          <span className="cell-hours">{hours.toFixed(1)}h</span>
                        ) : approvedHols.has(day) ? (
                          '🏖'
                        ) : publicHols.has(day) ? (
                          '🎌'
                        ) : (
                          '–'
                        )}
                      </td>
                    );
                  })}
                  <td className="row-end-cell">
                    <div className="row" style={{ gap: 6 }}>
                      <span
                        className={`badge ${(kpi?.atRisk ?? false) ? 'badge-risk' : 'badge-ok'}`}
                      >
                        {kpi?.maxConsecutiveDays ?? 0}d
                      </span>
                      {kpi?.atRisk && <span className="badge badge-risk">at risk</span>}
                    </div>
                    <div className="row-end-cell" style={{ marginTop: 2 }}>
                      <span className="consec text-muted">
                        {formatMoney(kpi?.profit ?? 0, currency)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-8" style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="cell-run-1" style={{ padding: '1px 8px', borderRadius: 4 }}>1–2d</span> healthy
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="cell-run-3" style={{ padding: '1px 8px', borderRadius: 4 }}>3d</span> caution
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="cell-run-4plus" style={{ padding: '1px 8px', borderRadius: 4 }}>4d+</span> at risk
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="cell-approved-holiday" style={{ padding: '1px 8px', borderRadius: 4 }}>🏖</span> approved holiday
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="cell-public-holiday" style={{ padding: '1px 8px', borderRadius: 4 }}>🎌</span> public holiday
        </span>
      </div>
    </div>
  );
}
