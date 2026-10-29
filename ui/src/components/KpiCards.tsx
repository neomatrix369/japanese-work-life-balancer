import React, { useState } from 'react';
import type { CompanyKpis } from '../api';
import type { Currency } from '../types';
import { formatMoney } from '../fx';
import { KPI_HELP } from '../kpiHelp';
import { CollapsiblePanel } from './CollapsiblePanel';

interface KpiCardsProps {
  kpis: CompanyKpis;
  currency: Currency;
  /** First-snapshot KPIs for replay delta arrows. Omit outside replay. */
  baselineKpis?: CompanyKpis;
}

/** Returns a delta string like "▼ 3" / "▲ 5" or undefined when trivial. */
function delta(
  current: number,
  baseline: number,
  /** true = lower is better (atRisk, unassigned); false = higher is better (healthyShare) */
  lowerIsBetter: boolean,
  format: (n: number) => string,
): { text: string; cls: 'good' | 'bad' | 'neutral' } | undefined {
  const diff = current - baseline;
  if (diff === 0) return undefined;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  const arrow = diff < 0 ? '▼' : '▲';
  return {
    text: `${arrow} ${format(Math.abs(diff))}`,
    cls: improved ? 'good' : 'bad',
  };
}

function KpiCard({
  label,
  value,
  sub,
  variant,
  deltaInfo,
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: 'good' | 'warn' | 'bad';
  deltaInfo?: { text: string; cls: 'good' | 'bad' | 'neutral' };
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const helpText = KPI_HELP[label];
  const infoId = `kpi-info-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="kpi-card">
      <div className="kpi-label">
        <span>{label}</span>
        {helpText && (
          <button
            className="kpi-info-btn"
            aria-label={`What is ${label}?`}
            aria-expanded={infoOpen}
            aria-controls={infoId}
            onClick={() => setInfoOpen((v) => !v)}
            onKeyDown={(e) => e.key === 'Escape' && setInfoOpen(false)}
          >
            ⓘ
          </button>
        )}
      </div>
      <div className={`kpi-value${variant ? ` ${variant}` : ''}`}>{value}</div>
      {deltaInfo && (
        <div className={`kpi-delta kpi-delta-${deltaInfo.cls}`}>{deltaInfo.text}</div>
      )}
      {helpText && infoOpen && (
        <div id={infoId} className="kpi-info-text" role="note">
          {helpText}
        </div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function KpiCards({ kpis, currency, baselineKpis }: KpiCardsProps) {
  const healthyPct = Math.round((kpis.healthyShare ?? 0) * 100);
  const atRisk = kpis.atRiskCount ?? 0;
  const avgCons = (kpis.avgConsecutiveDays ?? 0).toFixed(1);

  // Delta helpers — only compute when we have a baseline (replay mode).
  const b = baselineKpis;
  const dAtRisk = b
    ? delta(atRisk, b.atRiskCount ?? 0, true, (n) => String(n))
    : undefined;
  const dHealthy = b
    ? delta(healthyPct, Math.round((b.healthyShare ?? 0) * 100), false, (n) => `${n}%`)
    : undefined;
  const dUnassigned = b
    ? delta(kpis.unassignedCount ?? 0, b.unassignedCount ?? 0, true, (n) => String(n))
    : undefined;
  const dProfit = b
    ? delta(kpis.companyProfit ?? 0, b.companyProfit ?? 0, false, (n) =>
        formatMoney(n, currency),
      )
    : undefined;

  return (
    <div className="kpi-groups" data-tour="kpis">
      {/* Health group */}
      <CollapsiblePanel
        id="kpi-health"
        title={<span style={{ color: 'var(--green)' }}>Health</span>}
        dataTour="kpi-health"
        defaultOpen={true}
        className="kpi-group"
        style={{ marginBottom: 0 }}
      >
        <div className="kpi-grid">
          <KpiCard
            label="Healthy share"
            value={`${healthyPct}%`}
            sub="never 3+ days in a row"
            variant={healthyPct >= 80 ? 'good' : healthyPct >= 60 ? 'warn' : 'bad'}
            deltaInfo={dHealthy}
          />
          <KpiCard
            label="At-risk employees"
            value={String(atRisk)}
            sub="work 3+ days in a row"
            variant={atRisk === 0 ? 'good' : atRisk <= 5 ? 'warn' : 'bad'}
            deltaInfo={dAtRisk}
          />
          <KpiCard
            label="Avg consecutive days"
            value={avgCons}
            sub="longest run per person"
            variant={Number(avgCons) < 2 ? 'good' : Number(avgCons) < 3 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Idle hours total"
            value={`${(kpis.idleHoursTotal ?? 0).toFixed(0)} h`}
            sub="paid time with no task"
          />
        </div>
      </CollapsiblePanel>

      {/* Business group */}
      <CollapsiblePanel
        id="kpi-business"
        title={<span style={{ color: 'var(--primary)' }}>Business</span>}
        dataTour="kpi-business"
        defaultOpen={true}
        className="kpi-group"
        style={{ marginBottom: 0 }}
      >
        <div className="kpi-grid">
          <KpiCard
            label="Labor cost"
            value={formatMoney(kpis.totalLaborCost ?? 0, currency)}
            sub="total payroll"
          />
          <KpiCard
            label="Revenue"
            value={formatMoney(kpis.totalRevenue ?? 0, currency)}
            sub="billable hours"
          />
          <KpiCard
            label="Profit"
            value={formatMoney(kpis.companyProfit ?? 0, currency)}
            sub="revenue − labor"
            variant={(kpis.companyProfit ?? 0) >= 0 ? 'good' : 'bad'}
            deltaInfo={dProfit}
          />
          <KpiCard
            label="Unassigned tasks"
            value={String(kpis.unassignedCount ?? 0)}
            sub={`${(kpis.assignedTaskHours ?? 0).toFixed(0)} h assigned`}
            variant={(kpis.unassignedCount ?? 0) === 0 ? 'good' : 'warn'}
            deltaInfo={dUnassigned}
          />
        </div>
      </CollapsiblePanel>
    </div>
  );
}
