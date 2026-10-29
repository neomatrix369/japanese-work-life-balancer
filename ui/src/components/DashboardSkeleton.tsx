import React from 'react';

const CARDS_PER_GROUP = 4;
const GRID_ROWS = 8;

/** Placeholder card shaped like a KPI card: label, number, sub-line. */
function KpiCardSkeleton() {
  return (
    <div className="kpi-card skeleton-card">
      <span className="skeleton skeleton-line" style={{ width: '55%' }} />
      <span className="skeleton skeleton-number" />
      <span className="skeleton skeleton-line" style={{ width: '70%' }} />
    </div>
  );
}

/**
 * Shown while the first solve result is on its way, so the page keeps its shape
 * instead of jumping from empty to full. Reuses the KPI and card layout classes.
 */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Waiting for the first plan from the solver</span>
      <div className="kpi-groups" aria-hidden="true">
        {['Health', 'Business'].map((group) => (
          <div key={group} className="kpi-group">
            <div className="kpi-group-label">{group}</div>
            <div className="kpi-grid">
              {Array.from({ length: CARDS_PER_GROUP }, (_, i) => (
                <KpiCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="card" aria-hidden="true">
        <span className="skeleton skeleton-line" style={{ width: 180, marginBottom: 16 }} />
        <div className="skeleton-grid">
          {Array.from({ length: GRID_ROWS }, (_, i) => (
            <span key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    </div>
  );
}
