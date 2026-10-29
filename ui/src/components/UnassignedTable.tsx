import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { UnassignedTask } from '../api';
import { CollapsiblePanel } from './CollapsiblePanel';

interface UnassignedTableProps {
  unassigned: UnassignedTask[];
}

export const REASON_LABELS: Record<string, string> = {
  PUBLIC_HOLIDAY: 'Public holiday',
  NO_SKILLED_EMPLOYEE: 'No skilled employee',
  NO_SKILLED_EMPLOYEE_AVAILABLE: 'Skilled but unavailable',
  CAPACITY: 'All employees at capacity',
};

function formatTaskDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

export function UnassignedTable({ unassigned }: UnassignedTableProps) {
  const countBadge = (
    <span
      style={{
        background: unassigned.length === 0 ? 'var(--green-bg)' : 'var(--amber-bg)',
        color: unassigned.length === 0 ? 'var(--green)' : 'var(--amber)',
        borderRadius: 12,
        padding: '1px 8px',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'none',
        letterSpacing: 0,
      }}
    >
      {unassigned.length}
    </span>
  );

  return (
    <CollapsiblePanel
      id="unassigned"
      title="Unassigned Tasks"
      summaryExtra={countBadge}
      dataTour="unassigned"
      defaultOpen={true}
    >
      {unassigned.length === 0 ? (
        <div className="all-clear"><CheckCircle2 size={16} aria-hidden="true" />All tasks assigned</div>
      ) : (
        <div className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Start</th>
                <th>Duration</th>
                <th>Required skills</th>
                <th>Reason</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {unassigned.map((t) => (
                <tr key={t.taskId}>
                  <td>
                    <strong>{t.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      {t.taskId}
                    </div>
                  </td>
                  <td>{formatTaskDateTime(t.start)}</td>
                  <td>{t.durationMinutes} min</td>
                  <td>{t.requiredSkills?.join(', ')}</td>
                  <td>
                    <span className="reason-tag">
                      {REASON_LABELS[t.reason] ?? t.reason}
                    </span>
                  </td>
                  <td style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {t.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsiblePanel>
  );
}
