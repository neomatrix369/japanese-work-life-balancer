import React from 'react';
import type { WorkSchedule, Task, PerEmployeeKpi } from '../api';
import type { Currency } from '../types';
import { formatMoney } from '../fx';
import { Pin, X } from 'lucide-react';

interface EmployeeSidePanelProps {
  schedule: WorkSchedule;
  perEmployee: Record<string, PerEmployeeKpi>;
  employeeId: string;
  onClose: () => void;
  currency: Currency;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function EmployeeSidePanel({
  schedule,
  perEmployee,
  employeeId,
  onClose,
  currency,
}: EmployeeSidePanelProps) {
  const employee = schedule.employees.find((e) => e.id === employeeId);
  const kpi = perEmployee[employeeId];

  if (!employee) return null;

  const myTasks: Task[] = schedule.tasks.filter(
    (t) => t.employee === employeeId,
  );

  // Sort tasks by start time
  const sorted = [...myTasks].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="side-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="side-panel" style={{ position: 'relative' }}>
        <button className="side-panel-close" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>

        <h3>{employee.name}</h3>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
          {employee.id} · {employee.skills?.join(', ')}
        </div>

        {/* KPI summary */}
        {kpi && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Total hours', value: `${kpi.totalHours.toFixed(1)} h` },
              { label: 'Idle hours', value: `${kpi.idleHours.toFixed(1)} h` },
              { label: 'Days worked', value: String(kpi.daysWorked) },
              { label: 'Max consec.', value: `${kpi.maxConsecutiveDays}d${kpi.atRisk ? ', at risk' : ''}` },
              { label: 'Labor cost', value: formatMoney(kpi.laborCost, currency) },
              { label: 'Revenue', value: formatMoney(kpi.revenue, currency) },
              { label: 'Profit', value: formatMoney(kpi.profit, currency) },
              { label: 'Holidays left', value: String(kpi.holidaysRemainingAfter) },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--bg-muted)', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="card-title" style={{ marginBottom: 8 }}>
          Assigned tasks ({sorted.length})
        </div>

        {sorted.length === 0 ? (
          <div className="empty-state">No tasks assigned this week.</div>
        ) : (
          sorted.map((task) => (
            <div key={task.id} className="task-row">
              <div className="task-name">{task.name}</div>
              <div className="task-meta">
                {formatDateTime(task.start)} · {task.durationMinutes} min
                {task.pinned && (
                  <span
                    style={{
                      marginLeft: 6,
                      background: 'var(--blue-bg)',
                      color: 'var(--blue)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    <Pin size={10} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 3 }} />
                    pinned
                  </span>
                )}
              </div>
              <div className="task-meta" style={{ marginTop: 2 }}>
                Skills: {task.requiredSkills?.join(', ')}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
