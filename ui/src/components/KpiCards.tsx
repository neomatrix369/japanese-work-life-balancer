import React from 'react';
import type { CompanyKpis } from '../api';
import type { Currency } from '../types';
import { formatMoney } from '../fx';

interface KpiCardsProps {
  kpis: CompanyKpis;
  currency: Currency;
}

function KpiCard({
  label,
  value,
  sub,
  variant,
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${variant ? ` ${variant}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function KpiCards({ kpis, currency }: KpiCardsProps) {
  const healthyPct = Math.round((kpis.healthyShare ?? 0) * 100);
  const atRisk = kpis.atRiskCount ?? 0;
  const avgCons = (kpis.avgConsecutiveDays ?? 0).toFixed(1);

  return (
    <div className="kpi-groups">
      {/* Health group */}
      <div className="kpi-group">
        <div className="kpi-group-label health">Health</div>
        <div className="kpi-grid">
          <KpiCard
            label="Healthy share"
            value={`${healthyPct}%`}
            sub="≤2 consecutive days"
            variant={healthyPct >= 80 ? 'good' : healthyPct >= 60 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="At-risk employees"
            value={String(atRisk)}
            sub="3+ consecutive days"
            variant={atRisk === 0 ? 'good' : atRisk <= 5 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Avg consecutive days"
            value={avgCons}
            sub="this week"
            variant={Number(avgCons) < 2 ? 'good' : Number(avgCons) < 3 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Idle hours total"
            value={`${(kpis.idleHoursTotal ?? 0).toFixed(0)} h`}
            sub="across all employees"
          />
        </div>
      </div>

      {/* Business group */}
      <div className="kpi-group">
        <div className="kpi-group-label business">Business</div>
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
          />
          <KpiCard
            label="Unassigned tasks"
            value={String(kpis.unassignedCount ?? 0)}
            sub={`${(kpis.assignedTaskHours ?? 0).toFixed(0)} h assigned`}
            variant={(kpis.unassignedCount ?? 0) === 0 ? 'good' : 'warn'}
          />
        </div>
      </div>
    </div>
  );
}
