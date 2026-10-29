import React from 'react';
import type { ScheduleResponse, CompanyKpis } from '../api';
import type { Currency } from '../types';
import { formatMoney } from '../fx';

export interface SavedRun {
  label: string;
  response: ScheduleResponse;
}

interface CompareRunsProps {
  savedRun: SavedRun | null;
  currentResponse: ScheduleResponse | null;
  /** onSave is handled externally (status-line button); kept here for API compat. */
  onSave?: () => void;
  onClear: () => void;
  currency: Currency;
}

interface DeltaRowProps {
  label: string;
  savedVal: string;
  currentVal: string;
  delta: string;
  positive: boolean | null; // true = higher is better, false = lower is better, null = neutral
  rawDelta: number;
}

function DeltaRow({ label, savedVal, currentVal, delta, positive, rawDelta }: DeltaRowProps) {
  let deltaClass = 'delta-neu';
  if (rawDelta !== 0 && positive !== null) {
    const improved = (positive && rawDelta > 0) || (!positive && rawDelta < 0);
    deltaClass = improved ? 'delta-pos' : 'delta-neg';
  }
  return (
    <div className="delta-row">
      <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
      <span style={{ width: 90, textAlign: 'right', color: 'var(--fg-muted)' }}>{savedVal}</span>
      <span style={{ width: 90, textAlign: 'right' }}>{currentVal}</span>
      <span className={`${deltaClass}`} style={{ width: 80, textAlign: 'right' }}>
        {delta}
      </span>
    </div>
  );
}

function fmt(val: number, isMoney: boolean, currency: Currency): string {
  if (isMoney) return formatMoney(val, currency);
  return String(val);
}

function fmtPct(val: number): string {
  return `${Math.round(val * 100)}%`;
}

function buildRows(
  saved: CompanyKpis,
  current: CompanyKpis,
  currency: Currency,
): React.ReactNode[] {
  const rows: React.ReactNode[] = [];

  const addRow = (
    label: string,
    sVal: number,
    cVal: number,
    formatter: (v: number) => string,
    higherIsBetter: boolean | null,
  ) => {
    const delta = cVal - sVal;
    const sign = delta > 0 ? '+' : '';
    rows.push(
      <DeltaRow
        key={label}
        label={label}
        savedVal={formatter(sVal)}
        currentVal={formatter(cVal)}
        delta={`${sign}${formatter(Math.abs(delta))}`}
        positive={higherIsBetter}
        rawDelta={delta}
      />,
    );
  };

  addRow('Labor cost', saved.totalLaborCost, current.totalLaborCost, (v) => formatMoney(v, currency), false);
  addRow('Revenue', saved.totalRevenue, current.totalRevenue, (v) => formatMoney(v, currency), true);
  addRow('Profit', saved.companyProfit, current.companyProfit, (v) => formatMoney(v, currency), true);
  addRow('Healthy share', saved.healthyShare, current.healthyShare, fmtPct, true);
  addRow('At-risk count', saved.atRiskCount, current.atRiskCount, (v) => String(v), false);
  addRow('Avg consecutive days', saved.avgConsecutiveDays, current.avgConsecutiveDays, (v) => v.toFixed(1), false);
  addRow('Idle hours', saved.idleHoursTotal, current.idleHoursTotal, (v) => `${v.toFixed(0)} h`, null);
  addRow('Unassigned tasks', saved.unassignedCount, current.unassignedCount, (v) => String(v), false);

  return rows;
}

export function CompareRuns({
  savedRun,
  currentResponse,
  onClear,
  currency,
}: CompareRunsProps) {
  const canCompare = savedRun !== null && currentResponse !== null;

  return (
    <div>
      {savedRun && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="btn" onClick={onClear} style={{ fontSize: 12 }}>
            × Clear saved
          </button>
        </div>
      )}

      {!canCompare && (
        <div className="empty-state">
          {savedRun === null
            ? 'Solve a scenario, then click "Keep this run" to save it for comparison.'
            : 'Solve another scenario or preset to compare.'}
        </div>
      )}

      {canCompare && savedRun && currentResponse && (
        <>
          {/* Header row */}
          <div className="delta-row" style={{ fontWeight: 700, borderBottom: '2px solid var(--border)' }}>
            <span style={{ flex: 1 }}>Metric</span>
            <span style={{ width: 90, textAlign: 'right', color: 'var(--fg-muted)', fontSize: 11 }}>
              {savedRun.label}
            </span>
            <span style={{ width: 90, textAlign: 'right', fontSize: 11 }}>
              {currentResponse.preset} (current)
            </span>
            <span style={{ width: 80, textAlign: 'right', fontSize: 11 }}>Δ</span>
          </div>

          {buildRows(savedRun.response.kpis, currentResponse.kpis, currency)}

          {/* Score comparison */}
          <div
            className="delta-row"
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '2px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
          >
            <span style={{ flex: 1 }}>Score</span>
            <span style={{ width: 90, textAlign: 'right', color: 'var(--fg-muted)' }}>
              {savedRun.response.score}
            </span>
            <span style={{ width: 90, textAlign: 'right' }}>{currentResponse.score}</span>
            <span style={{ width: 80 }} />
          </div>
        </>
      )}
    </div>
  );
}
