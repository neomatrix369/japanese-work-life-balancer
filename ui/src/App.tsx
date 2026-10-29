import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchScenarios,
  startSolve,
  fetchSchedule,
  stopSolve,
  normalizePerEmployee,
  type Preset,
  type SolverStatus,
  type ScheduleResponse,
  type PerEmployeeKpi,
} from './api';
import type { Currency } from './fx';
import { INDICATIVE_LABEL } from './fx';
import type { Role } from './api';

import { TopBar } from './components/TopBar';
import { KpiCards } from './components/KpiCards';
import { WeekGrid } from './components/WeekGrid';
import { EmployeeSidePanel } from './components/EmployeeSidePanel';
import { HoursChart } from './components/HoursChart';
import { UnassignedTable } from './components/UnassignedTable';
import { BrokenConstraints } from './components/BrokenConstraints';
import { CompareRuns, type SavedRun } from './components/CompareRuns';
import { LongevityView } from './components/LongevityView';

const POLL_INTERVAL_MS = 2000;

function scoreHardCount(score: string): number {
  // Score format: "-1hard/-2medium/-300soft" or "0hard/..."
  const m = score?.match(/(-?\d+)hard/);
  return m ? Math.abs(parseInt(m[1], 10)) : 0;
}

export function App() {
  // ── Scenario list & model health ──────────────────────────────────────────
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [modelDown, setModelDown] = useState(false);

  // ── Solve configuration ───────────────────────────────────────────────────
  const [selectedScenario, setSelectedScenario] = useState('');
  const [preset, setPreset] = useState<Preset>('health-first');
  const [limitSeconds, setLimitSeconds] = useState(30);

  // ── Solve state ───────────────────────────────────────────────────────────
  const [jobId, setJobId] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [liveScore, setLiveScore] = useState('');
  const [liveStatus, setLiveStatus] = useState<SolverStatus | null>(null);
  const [scheduleResponse, setScheduleResponse] = useState<ScheduleResponse | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null);
  const [currency, setCurrency] = useState<Currency>('JPY');
  const [role, setRole] = useState<Role>('Manager');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── On mount: fetch scenario list ─────────────────────────────────────────
  useEffect(() => {
    fetchScenarios()
      .then((names) => {
        setScenarios(names);
        if (names.length > 0) setSelectedScenario(names[0]);
      })
      .catch(() => setModelDown(true));
  }, []);

  // ── Polling while solving ─────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const resp = await fetchSchedule(id);
          setLiveScore(resp.score ?? '');
          setLiveStatus(resp.status);
          setScheduleResponse(resp);
          if (resp.status !== 'SOLVING_ACTIVE' && resp.status !== 'SOLVING_SCHEDULED') {
            setSolving(false);
            stopPolling();
          }
        } catch {
          // keep polling — transient errors during solve are expected
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Solve / Stop handlers ──────────────────────────────────────────────────
  const handleSolve = useCallback(async () => {
    if (!selectedScenario) return;
    try {
      setSolving(true);
      setLiveScore('');
      setLiveStatus('SOLVING_SCHEDULED');
      setScheduleResponse(null);
      const id = await startSolve(selectedScenario, preset, limitSeconds);
      const trimmed = id.trim().replace(/^"|"$/g, ''); // some servers wrap in quotes
      setJobId(trimmed);
      startPolling(trimmed);
    } catch (err) {
      setSolving(false);
      console.error('Solve error:', err);
      alert(`Failed to start solve: ${String(err)}`);
    }
  }, [selectedScenario, preset, limitSeconds, startPolling]);

  const handleStop = useCallback(async () => {
    if (!jobId) return;
    stopPolling();
    try {
      const resp = await stopSolve(jobId);
      setScheduleResponse(resp);
      setLiveScore(resp.score ?? '');
      setLiveStatus('NOT_SOLVING');
    } catch {
      // best effort
    } finally {
      setSolving(false);
    }
  }, [jobId, stopPolling]);

  // ── Compare helpers ────────────────────────────────────────────────────────
  const handleSaveRun = useCallback(() => {
    if (!scheduleResponse) return;
    setSavedRun({
      label: `${scheduleResponse.preset ?? preset} — ${scheduleResponse.schedule?.name ?? selectedScenario}`,
      response: scheduleResponse,
    });
  }, [scheduleResponse, preset, selectedScenario]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const perEmployee: Record<string, PerEmployeeKpi> = scheduleResponse
    ? normalizePerEmployee(scheduleResponse.perEmployee)
    : {};

  const isHardViolated =
    liveScore !== '' && scoreHardCount(liveScore) > 0;

  return (
    <div className="app">
      {/* Model-down banner */}
      {modelDown && (
        <div className="banner">
          <span className="banner-icon">⚠️</span>
          <strong>Model not running —</strong> the Quarkus solver is not reachable on{' '}
          <code>localhost:8083</code>. Run <code>make model</code> to start it. UI is shown in
          read-only mode.
        </div>
      )}

      {/* Indicative FX rates notice */}
      {currency !== 'JPY' && (
        <div
          style={{
            background: 'var(--bg-muted)',
            borderBottom: '1px solid var(--border)',
            padding: '4px 16px',
            fontSize: 11,
            color: 'var(--fg-muted)',
            textAlign: 'center',
          }}
        >
          Currency shown in {currency} · {INDICATIVE_LABEL}
        </div>
      )}

      {/* Top bar */}
      <TopBar
        scenarios={scenarios}
        selectedScenario={selectedScenario}
        onScenarioChange={setSelectedScenario}
        preset={preset}
        onPresetChange={setPreset}
        limitSeconds={limitSeconds}
        onLimitChange={setLimitSeconds}
        currency={currency}
        onCurrencyChange={setCurrency}
        role={role}
        onRoleChange={setRole}
        solving={solving}
        canSolve={!!selectedScenario && !modelDown}
        onSolve={handleSolve}
        onStop={handleStop}
        status={liveStatus}
        score={liveScore}
      />

      {/* Status line */}
      <div className="status-line">
        <span
          className={`status-dot${solving ? ' solving' : scheduleResponse ? ' done' : ''}`}
        />
        {solving ? (
          <span>
            Solving <strong>{selectedScenario}</strong> with <strong>{preset}</strong>…
          </span>
        ) : scheduleResponse ? (
          <span>
            Done ·{' '}
            <strong>{scheduleResponse.schedule?.name ?? selectedScenario}</strong> ·{' '}
            <strong>{scheduleResponse.preset}</strong>
          </span>
        ) : (
          <span style={{ color: 'var(--fg-muted)' }}>
            Pick a scenario and click Solve to begin.
          </span>
        )}
        {(liveScore || scheduleResponse?.score) && (
          <span
            className={`score-text ${
              isHardViolated ? 'score-hard-bad' : 'score-hard-ok'
            }`}
            style={{ marginLeft: 'auto' }}
          >
            score: {liveScore || scheduleResponse?.score}
          </span>
        )}
      </div>

      {/* Main panels */}
      <div className="main-content">
        {/* KPI cards — show when there's any response */}
        {scheduleResponse?.kpis && (
          <KpiCards kpis={scheduleResponse.kpis} currency={currency} />
        )}

        {/* Compare runs — always visible */}
        <CompareRuns
          savedRun={savedRun}
          currentResponse={scheduleResponse}
          onSave={handleSaveRun}
          onClear={() => setSavedRun(null)}
          currency={currency}
        />

        {/* Week grid */}
        {scheduleResponse?.schedule && (
          <WeekGrid
            schedule={scheduleResponse.schedule}
            perEmployee={perEmployee}
            selectedEmployeeId={selectedEmployeeId}
            onSelectEmployee={setSelectedEmployeeId}
            currency={currency}
          />
        )}

        {/* Hours chart */}
        {scheduleResponse?.schedule && Object.keys(perEmployee).length > 0 && (
          <HoursChart
            schedule={scheduleResponse.schedule}
            perEmployee={perEmployee}
          />
        )}

        {/* Unassigned tasks */}
        {scheduleResponse && (
          <UnassignedTable unassigned={scheduleResponse.unassigned ?? []} />
        )}

        {/* Broken constraints */}
        {scheduleResponse && (
          <BrokenConstraints
            brokenConstraints={scheduleResponse.brokenConstraints ?? []}
            score={scheduleResponse.score ?? ''}
          />
        )}

        {/* Longevity view */}
        {scheduleResponse?.longevity && (
          <LongevityView
            longevity={scheduleResponse.longevity}
            role={role}
            perEmployeeList={Object.values(perEmployee)}
          />
        )}
      </div>

      {/* Employee side panel */}
      {selectedEmployeeId && scheduleResponse?.schedule && (
        <EmployeeSidePanel
          schedule={scheduleResponse.schedule}
          perEmployee={perEmployee}
          employeeId={selectedEmployeeId}
          onClose={() => setSelectedEmployeeId(null)}
          currency={currency}
        />
      )}
    </div>
  );
}
