import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchScenarios,
  startSolve,
  fetchSchedule,
  stopSolve,
  normalizePerEmployee,
  scoreHardCount,
  type Preset,
  type SolverStatus,
  type ScheduleResponse,
  type PerEmployeeKpi,
} from './api';
import type { Currency } from './fx';
import { INDICATIVE_LABEL } from './fx';
import type { Role } from './api';
import { recordSnapshot, type ReplaySnapshot } from './replay';

import { TopBar } from './components/TopBar';
import { KpiCards } from './components/KpiCards';
import { WeekGrid } from './components/WeekGrid';
import { EmployeeSidePanel } from './components/EmployeeSidePanel';
import { HoursChart } from './components/HoursChart';
import { UnassignedTable } from './components/UnassignedTable';
import { BrokenConstraints } from './components/BrokenConstraints';
import { CompareRuns, type SavedRun } from './components/CompareRuns';
import { LongevityView } from './components/LongevityView';
import { ReplayBar } from './components/ReplayBar';
import { TourOverlay } from './components/TourOverlay';
import { useTour, type TourController } from './tour/useTour';
import { createNarrator } from './tour/voice';
import { weekDates } from './tour/narrate';

const POLL_INTERVAL_MS = 2000;

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

  // ── Replay state ──────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<ReplaySnapshot[]>([]);
  /** null = live (show scheduleResponse); number = index into snapshots */
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const solveStartRef = useRef<number>(0);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null);
  const [currency, setCurrency] = useState<Currency>('JPY');
  const [role, setRole] = useState<Role>('Manager');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Settles the promise returned by runSolve (used by the guided tour). */
  const solveWaiterRef = useRef<{
    resolve: (r: ScheduleResponse) => void;
    reject: (e: unknown) => void;
  } | null>(null);
  /** Bumped on every new solve / tour stop so a late job-id response is ignored. */
  const solveGenRef = useRef(0);
  const settleSolve = useCallback((result: ScheduleResponse | Error) => {
    const w = solveWaiterRef.current;
    solveWaiterRef.current = null;
    if (!w) return;
    if (result instanceof Error) w.reject(result);
    else w.resolve(result);
  }, []);

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
          const isDone =
            resp.status !== 'SOLVING_ACTIVE' && resp.status !== 'SOLVING_SCHEDULED';
          setSnapshots((prev) =>
            recordSnapshot(prev, resp, solveStartRef.current, isDone),
          );
          if (isDone) {
            setSolving(false);
            stopPolling();
            settleSolve(resp);
          }
        } catch {
          // keep polling — transient errors during solve are expected
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, settleSolve],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Solve / Stop handlers ──────────────────────────────────────────────────
  /** Start a solve and resolve with the final response once the solver is done. */
  const runSolve = useCallback(
    (scenario: string, solvePreset: Preset, limit: number): Promise<ScheduleResponse> => {
      settleSolve(new Error('superseded by a new solve'));
      const gen = ++solveGenRef.current;
      const done = new Promise<ScheduleResponse>((resolve, reject) => {
        solveWaiterRef.current = { resolve, reject };
      });
      setSolving(true);
      setLiveScore('');
      setLiveStatus('SOLVING_SCHEDULED');
      setScheduleResponse(null);
      // Clear replay state for the new solve.
      setSnapshots([]);
      setReplayIndex(null);
      solveStartRef.current = Date.now();
      startSolve(scenario, solvePreset, limit)
        .then((id) => {
          const trimmed = id.trim().replace(/^"|"$/g, ''); // some servers wrap in quotes
          if (gen !== solveGenRef.current) {
            void stopSolve(trimmed).catch(() => undefined); // stopped before it started
            return;
          }
          setJobId(trimmed);
          startPolling(trimmed);
        })
        .catch((err) => {
          setSolving(false);
          settleSolve(err instanceof Error ? err : new Error(String(err)));
        });
      return done;
    },
    [startPolling, settleSolve],
  );

  const handleSolve = useCallback(async () => {
    if (!selectedScenario) return;
    try {
      await runSolve(selectedScenario, preset, limitSeconds);
    } catch (err) {
      if (String(err).includes('superseded') || String(err).includes('stopped')) return;
      console.error('Solve error:', err);
      alert(`Failed to start solve: ${String(err)}`);
    }
  }, [selectedScenario, preset, limitSeconds, runSolve]);

  const handleStop = useCallback(async () => {
    if (!jobId) return;
    stopPolling();
    try {
      const resp = await stopSolve(jobId);
      setScheduleResponse(resp);
      setLiveScore(resp.score ?? '');
      setLiveStatus('NOT_SOLVING');
      setSnapshots((prev) =>
        recordSnapshot(prev, resp, solveStartRef.current, true),
      );
      settleSolve(resp);
    } catch {
      // best effort
      settleSolve(new Error('stopped'));
    } finally {
      setSolving(false);
    }
  }, [jobId, stopPolling, settleSolve]);

  // ── Compare helpers ────────────────────────────────────────────────────────
  const handleSaveRun = useCallback(() => {
    if (!scheduleResponse) return;
    setSavedRun({
      label: `${scheduleResponse.preset ?? preset} — ${scheduleResponse.schedule?.name ?? selectedScenario}`,
      response: scheduleResponse,
    });
  }, [scheduleResponse, preset, selectedScenario]);

  // ── Guided tour ("Play demo") — drives the same state as the controls ─────
  const tourController: TourController = {
    solveLive: (spec, limit) => {
      setSelectedScenario(spec.scenario);
      setPreset(spec.preset);
      return runSolve(spec.scenario, spec.preset, limit);
    },
    stopLive: () => {
      solveGenRef.current++;
      stopPolling();
      settleSolve(new Error('stopped'));
      setSolving(false);
      if (jobId) void stopSolve(jobId).catch(() => undefined);
    },
    applyFrame: (resp, first, final) => {
      if (first) {
        solveStartRef.current = Date.now();
        setSnapshots([]);
        setReplayIndex(null);
      }
      setScheduleResponse(resp);
      setLiveScore(resp.score ?? '');
      setLiveStatus(final ? 'NOT_SOLVING' : 'SOLVING_ACTIVE');
      setSnapshots((prev) => recordSnapshot(first ? [] : prev, resp, solveStartRef.current, final));
    },
    show: (resp, spec) => {
      setSelectedScenario(spec.scenario);
      setPreset(spec.preset);
      setReplayIndex(null);
      setScheduleResponse(resp);
      setLiveScore(resp.score ?? '');
      setLiveStatus('NOT_SOLVING');
    },
    keep: (resp, spec) =>
      setSavedRun({ label: `${spec.preset} — ${resp.schedule?.name ?? spec.scenario}`, response: resp }),
  };
  const [narrator] = useState(createNarrator); // tour voice narration (POST /tts → browser voice fallback)
  const tour = useTour(tourController, { current: scheduleResponse, currency }, undefined, narrator);
  const tourStep = tour.active ? tour.step : null;
  /** The tour may show a role (HR view) without changing the user's own choice. */
  const effectiveRole: Role = tourStep?.role ?? role;

  // ── Derived ───────────────────────────────────────────────────────────────

  /**
   * Single source of truth for what the panels render:
   *  - In live mode (replayIndex = null): use the latest scheduleResponse.
   *  - In replay mode: use the frozen snapshot response.
   * CompareRuns always uses scheduleResponse (final result) regardless.
   */
  const displayedResult: ScheduleResponse | null =
    replayIndex !== null && snapshots[replayIndex]
      ? snapshots[replayIndex].response
      : scheduleResponse;

  /** First-snapshot KPIs; defined only while replaying (for delta arrows). */
  const baselineKpis =
    replayIndex !== null && snapshots.length > 0
      ? snapshots[0].response.kpis
      : undefined;

  const perEmployee: Record<string, PerEmployeeKpi> = displayedResult
    ? normalizePerEmployee(displayedResult.perEmployee)
    : {};

  const isHardViolated =
    liveScore !== '' && scoreHardCount(liveScore) > 0;

  /** Show replay bar once solving is complete and we have captured steps. */
  const showReplayBar = !solving && snapshots.length > 0;

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
        role={effectiveRole}
        onRoleChange={setRole}
        onPlayTour={tour.start}
        tourActive={tour.active}
        solving={solving}
        canSolve={!!selectedScenario && !modelDown}
        onSolve={handleSolve}
        onStop={handleStop}
        status={liveStatus}
        score={liveScore}
      />

      {/* Status line — includes the "Keep for comparison" action so it stays accessible
          even after CompareRuns panel moves to the bottom of the page. */}
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
        {scheduleResponse && (
          <button
            className="btn btn-primary"
            onClick={handleSaveRun}
            style={{ fontSize: 12 }}
          >
            📌 Keep this run for comparison
          </button>
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

      {/* Replay bar — shown after solve completes */}
      {showReplayBar && (
        <div data-tour="replay">
          <ReplayBar
            snapshots={snapshots}
            replayIndex={replayIndex}
            onSeek={setReplayIndex}
          />
        </div>
      )}

      {/* Main panels */}
      <div className="main-content">
        {/* KPI cards — show when there's any response.
            data-tour anchors kpis-health / kpis-business live inside KpiCards. */}
        {displayedResult?.kpis && (
          <KpiCards
            kpis={displayedResult.kpis}
            currency={currency}
            baselineKpis={baselineKpis}
          />
        )}

        {/* Longevity view — directly after KPI cards, above the week grid */}
        {displayedResult?.longevity && (
          <LongevityView
            longevity={displayedResult.longevity}
            role={effectiveRole}
            perEmployeeList={Object.values(perEmployee)}
          />
        )}

        {/* Week grid */}
        {displayedResult?.schedule && (
          <WeekGrid
            schedule={displayedResult.schedule}
            perEmployee={perEmployee}
            selectedEmployeeId={selectedEmployeeId}
            onSelectEmployee={setSelectedEmployeeId}
            currency={currency}
            highlightDate={
              tourStep?.highlightDay !== undefined
                ? weekDates(displayedResult)[tourStep.highlightDay]
                : null
            }
          />
        )}

        {/* Hours chart */}
        {displayedResult?.schedule && Object.keys(perEmployee).length > 0 && (
          <div data-tour="hours-chart">
            <HoursChart
              schedule={displayedResult.schedule}
              perEmployee={perEmployee}
            />
          </div>
        )}

        {/* Unassigned tasks */}
        {displayedResult && (
          <UnassignedTable unassigned={displayedResult.unassigned ?? []} />
        )}

        {/* Broken constraints */}
        {displayedResult && (
          <div data-tour="broken-constraints">
            <BrokenConstraints
              brokenConstraints={displayedResult.brokenConstraints ?? []}
              score={displayedResult.score ?? ''}
            />
          </div>
        )}

        {/* Compare runs — collapsible panel at the bottom; collapsed by default.
            The "Keep this run" button stays in the status line above for quick access. */}
        <details
          id="compare-panel"
          data-tour="compare"
          className="panel-collapsible"
        >
          <summary className="panel-collapsible-summary">
            <span>Compare runs</span>
            {savedRun && (
              <span className="compare-kept-label">Kept: {savedRun.label}</span>
            )}
            <span className="panel-chevron" aria-hidden="true">›</span>
          </summary>
          <div className="panel-collapsible-content">
            <CompareRuns
              savedRun={savedRun}
              currentResponse={scheduleResponse}
              onClear={() => setSavedRun(null)}
              currency={currency}
            />
          </div>
        </details>
      </div>

      {/* Employee side panel */}
      {selectedEmployeeId && displayedResult?.schedule && (
        <EmployeeSidePanel
          schedule={displayedResult.schedule}
          perEmployee={perEmployee}
          employeeId={selectedEmployeeId}
          onClose={() => setSelectedEmployeeId(null)}
          currency={currency}
        />
      )}

      {/* Guided tour */}
      {tour.active && (
        <TourOverlay
          target={tour.step.target}
          stepId={tour.step.id}
          title={tour.step.title}
          text={tour.text}
          index={tour.index}
          total={tour.total}
          paused={tour.paused}
          running={tour.running}
          recorded={tour.recorded}
          isLast={tour.isLast}
          onNext={tour.next}
          onBack={tour.back}
          onTogglePause={tour.togglePause}
          onExit={tour.exit}
          onReplay={tour.start}
          voice={tour.voice}
        />
      )}
    </div>
  );
}
