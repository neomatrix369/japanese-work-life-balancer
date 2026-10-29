import React from 'react';
import type { LongevityData, PerEmployeeKpi } from '../api';
import type { Role } from '../types';

interface LongevityViewProps {
  longevity: LongevityData;
  role: Role;
  /** Per-employee KPI entries from the top-level `perEmployee[]` array; used for the
   *  HR/Executive detail table (tenureYears + unplannedAbsenceDays3m). */
  perEmployeeList?: PerEmployeeKpi[];
}

// MOCK: no auth — role selector in TopBar gates the view
export function LongevityView({ longevity, role, perEmployeeList }: LongevityViewProps) {
  const canSeePerEmployee = role === 'HR' || role === 'Executive';

  return (
    <div className="card" data-tour="longevity">
      <div className="card-title">
        Longevity view
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            fontWeight: 400,
            background: 'var(--blue-bg)',
            color: 'var(--blue)',
            borderRadius: 10,
            padding: '1px 8px',
          }}
        >
          {role}
        </span>
        {!canSeePerEmployee && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
            Managers see company-level figures only. Switch role to HR or Executive for per-employee detail.
          </span>
        )}
      </div>

      {/* Company-level stats — visible to all */}
      <div className="retention-grid">
        <div className="retention-card">
          <div className="retention-value">{(longevity.avgTenureYears ?? 0).toFixed(1)}</div>
          <div className="retention-label">Avg tenure (years)</div>
        </div>
        <div className="retention-card">
          <div className="retention-value">{longevity.totalUnplannedAbsenceDays ?? 0}</div>
          <div className="retention-label">Unplanned absences (3 m)</div>
        </div>
        <div className="retention-card">
          <div className="retention-value">{(longevity.avgUnplannedAbsenceDays ?? 0).toFixed(1)}</div>
          <div className="retention-label">Avg absences / person</div>
        </div>
      </div>

      {/* Retention rates */}
      {longevity.retention && (
        <>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>
            Retention rates (MOCK: company-reported figures)
          </div>
          <div className="retention-grid">
            <div className="retention-card">
              <div
                className="retention-value"
                style={{
                  color:
                    longevity.retention.year1 >= 0.8
                      ? 'var(--green)'
                      : 'var(--amber)',
                }}
              >
                {Math.round(longevity.retention.year1 * 100)}%
              </div>
              <div className="retention-label">Year 1</div>
            </div>
            <div className="retention-card">
              <div
                className="retention-value"
                style={{
                  color:
                    longevity.retention.year3 >= 0.7
                      ? 'var(--green)'
                      : 'var(--amber)',
                }}
              >
                {Math.round(longevity.retention.year3 * 100)}%
              </div>
              <div className="retention-label">Year 3</div>
            </div>
            <div className="retention-card">
              <div
                className="retention-value"
                style={{
                  color:
                    longevity.retention.year5 >= 0.6
                      ? 'var(--green)'
                      : 'var(--red)',
                }}
              >
                {Math.round(longevity.retention.year5 * 100)}%
              </div>
              <div className="retention-label">Year 5</div>
            </div>
          </div>
        </>
      )}

      {/* Per-employee detail — HR and Executive only */}
      {canSeePerEmployee && perEmployeeList && perEmployeeList.length > 0 && (
        <>
          <div
            style={{
              fontWeight: 600,
              fontSize: 12,
              color: 'var(--fg-muted)',
              margin: '12px 0 8px',
            }}
          >
            Per-employee detail
          </div>
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Tenure (years)</th>
                  <th>Unplanned absences (3 m)</th>
                </tr>
              </thead>
              <tbody>
                {perEmployeeList
                  .slice()
                  .sort((a, b) => b.unplannedAbsenceDays3m - a.unplannedAbsenceDays3m)
                  .map((e) => {
                    const empId = e.employeeId ?? e.id ?? '';
                    return (
                      <tr key={empId}>
                        <td>
                          <strong>{e.name ?? empId}</strong>
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
                            {empId}
                          </span>
                        </td>
                        <td>{e.tenureYears.toFixed(1)}</td>
                        <td>
                          <span
                            style={{
                              color:
                                e.unplannedAbsenceDays3m >= 4
                                  ? 'var(--red)'
                                  : e.unplannedAbsenceDays3m >= 2
                                  ? 'var(--amber)'
                                  : 'var(--green)',
                              fontWeight: 600,
                            }}
                          >
                            {e.unplannedAbsenceDays3m}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
