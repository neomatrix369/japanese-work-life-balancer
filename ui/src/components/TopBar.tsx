import React from 'react';
import type { Preset, SolverStatus } from '../api';
import type { Currency, Role } from '../types';

interface TopBarProps {
  scenarios: string[];
  selectedScenario: string;
  onScenarioChange: (s: string) => void;
  preset: Preset;
  onPresetChange: (p: Preset) => void;
  limitSeconds: number;
  onLimitChange: (n: number) => void;
  currency: Currency;
  onCurrencyChange: (c: Currency) => void;
  role: Role;
  onRoleChange: (r: Role) => void;
  solving: boolean;
  canSolve: boolean;
  onSolve: () => void;
  onStop: () => void;
  status: SolverStatus | null;
  score: string;
}

export function TopBar({
  scenarios,
  selectedScenario,
  onScenarioChange,
  preset,
  onPresetChange,
  limitSeconds,
  onLimitChange,
  currency,
  onCurrencyChange,
  role,
  onRoleChange,
  solving,
  canSolve,
  onSolve,
  onStop,
}: TopBarProps) {
  return (
    <div className="topbar">
      <span className="topbar-title">🌸 Work-Life Balancer</span>
      <div className="sep" />

      <label>Scenario</label>
      <select
        value={selectedScenario}
        onChange={(e) => onScenarioChange(e.target.value)}
        disabled={solving}
      >
        <option value="">— pick scenario —</option>
        {scenarios.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <label>Preset</label>
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as Preset)}
        disabled={solving}
      >
        <option value="health-first">health-first</option>
        <option value="balanced">balanced</option>
        <option value="cost-first">cost-first</option>
      </select>

      <label>Time limit</label>
      <select
        value={limitSeconds}
        onChange={(e) => onLimitChange(Number(e.target.value))}
        disabled={solving}
      >
        <option value={10}>10 s</option>
        <option value={30}>30 s</option>
        <option value={60}>60 s</option>
      </select>

      <div className="sep" />

      {!solving ? (
        <button
          className="btn btn-primary"
          onClick={onSolve}
          disabled={!canSolve}
        >
          ▶ Solve
        </button>
      ) : (
        <button className="btn btn-danger" onClick={onStop}>
          ⏹ Stop
        </button>
      )}

      <div className="sep" />

      <label>Currency</label>
      <select
        value={currency}
        onChange={(e) => onCurrencyChange(e.target.value as Currency)}
      >
        <option value="JPY">JPY ¥</option>
        <option value="USD">USD $</option>
        <option value="GBP">GBP £</option>
      </select>

      <label>Role</label>
      <select
        value={role}
        onChange={(e) => onRoleChange(e.target.value as Role)}
      >
        <option value="Manager">Manager</option>
        <option value="HR">HR</option>
        <option value="Executive">Executive</option>
      </select>
    </div>
  );
}
