import React from 'react';
import type { BrokenConstraint } from '../api';

interface BrokenConstraintsProps {
  brokenConstraints: BrokenConstraint[];
  score: string;
}

function levelClass(level: string): string {
  if (level === 'HARD') return 'level-hard';
  if (level === 'MEDIUM') return 'level-medium';
  return 'level-soft';
}

export function BrokenConstraints({ brokenConstraints, score }: BrokenConstraintsProps) {
  const hard = brokenConstraints.filter((c) => c.level === 'HARD');
  const medium = brokenConstraints.filter((c) => c.level === 'MEDIUM');
  const soft = brokenConstraints.filter((c) => c.level === 'SOFT');

  // matchCount can be null when the server doesn't provide a count; treat as 1 for badge purposes
  const hardCount = hard.reduce((s, c) => s + (c.matchCount ?? 1), 0);

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        Broken Constraints
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 12, color: 'var(--fg-muted)' }}>
          score: {score || '–'}
        </span>
        {hardCount === 0 ? (
          <span
            style={{
              background: 'var(--green-bg)',
              color: 'var(--green)',
              borderRadius: 12,
              padding: '2px 10px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            0 hard ✓
          </span>
        ) : (
          <span
            style={{
              background: 'var(--red-bg)',
              color: 'var(--red)',
              borderRadius: 12,
              padding: '2px 10px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {hardCount} hard ✗
          </span>
        )}
      </div>

      {brokenConstraints.length === 0 ? (
        <div className="all-clear">✓ No constraints broken — plan is fully feasible</div>
      ) : (
        <div>
          {[...hard, ...medium, ...soft].map((c, i) => (
            <div key={i} className="constraint-row">
              <span className={`badge ${levelClass(c.level)}`} style={{ minWidth: 56 }}>
                {c.level}
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {c.matchCount != null ? `×${c.matchCount}` : '–'} · {c.score}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
