// All API response types for the Japanese Work-Life Balancer model.
// Field names match the REST API spec (§1.4 / §1.5 in the build spec).
// Reconcile this file against src/api at the model REST layer.

export type Preset = 'health-first' | 'balanced' | 'cost-first';
export type SolverStatus =
  | 'SOLVING_ACTIVE'
  | 'SOLVING_SCHEDULED'
  | 'NOT_SOLVING';
export type ConstraintLevel = 'HARD' | 'MEDIUM' | 'SOFT';
export type UnassignedReasonCode =
  | 'PUBLIC_HOLIDAY'
  | 'NO_SKILLED_EMPLOYEE'
  | 'NO_SKILLED_EMPLOYEE_AVAILABLE'
  | 'CAPACITY';
export type Role = 'Manager' | 'HR' | 'Executive';

// ---------- Problem facts ----------

export interface TimeWindow {
  date: string;   // ISO yyyy-MM-dd
  start: string;  // HH:mm
  end: string;    // HH:mm
}

export interface Employee {
  id: string;
  name: string;
  skills: string[];
  hourlyRate: number;       // JPY per task hour
  billingRate: number;      // JPY per task hour
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  minRestHours: number;
  availability: TimeWindow[];
  daysOffRequested: string[];       // ISO dates
  avoidHours: TimeWindow[];
  consecutiveDaysBeforeWeek: number;
  approvedHolidays: string[];       // ISO dates
  holidayDaysRemaining: number;
  tenureYears: number;
  unplannedAbsenceDays3m: number;
}

export interface Task {
  id: string;
  name: string;
  start: string;                // ISO yyyy-MM-ddTHH:mm:ss
  durationMinutes: number;
  requiredSkills: string[];
  employee: string | null;      // employee id reference (or null = unassigned)
  pinned: boolean;
}

export interface Leaver {
  id: string;                   // L-001
  leftAfterYears: number;
}

export interface RetentionData {
  year1: number;
  year3: number;
  year5: number;
}

export interface WorkSchedule {
  name: string;
  weekStart: string;            // ISO yyyy-MM-dd (Monday)
  shiftStart: string;           // HH:mm, typically 09:00
  shiftEnd: string;             // HH:mm, typically 17:00
  publicHolidays: string[];     // ISO dates
  leavers?: Leaver[] | null;    // history used to compute retention
  employees: Employee[];
  tasks: Task[];
  score: string | null;
  solverStatus: SolverStatus;
  preset?: Preset;
}

// ---------- KPIs ----------

export interface CompanyKpis {
  totalLaborCost: number;       // JPY
  totalRevenue: number;         // JPY
  companyProfit: number;        // JPY
  idleHoursTotal: number;
  unassignedCount: number;
  assignedTaskHours: number;
  healthyShare: number;         // 0.0–1.0
  avgConsecutiveDays: number;
  atRiskCount: number;
  employeesWorking: number;
}

export interface PerEmployeeKpi {
  // When returned as a list, one of these provides the key:
  employeeId?: string;
  id?: string;
  // KPI fields:
  name?: string;
  hoursPerDay: Record<string, number>; // ISO date → hours (decimal)
  /** server-computed consecutive-run position per date; use for week-grid colouring */
  runDayPerDate?: Record<string, number>;
  totalHours: number;
  idleHours: number;
  laborCost: number;       // JPY
  revenue: number;         // JPY
  profit: number;          // JPY
  daysWorked: number;
  maxConsecutiveDays: number;
  atRisk: boolean;
  holidaysTakenThisWeek: number;
  holidaysRemainingAfter: number;
  maxHoursPerDay?: number;
  maxHoursPerWeek?: number;
  tenureYears: number;
  unplannedAbsenceDays3m: number;
}

// The model may return perEmployee as a JSON array OR as a JSON object keyed by employee id.
export type PerEmployeeRaw =
  | PerEmployeeKpi[]
  | Record<string, PerEmployeeKpi>;

/**
 * Normalise perEmployee to a Record<employeeId, PerEmployeeKpi> regardless of
 * whether the server returned a JSON array or a JSON object.
 */
export function normalizePerEmployee(
  raw: PerEmployeeRaw,
): Record<string, PerEmployeeKpi> {
  if (Array.isArray(raw)) {
    const result: Record<string, PerEmployeeKpi> = {};
    for (const item of raw) {
      const key = item.employeeId ?? item.id ?? '';
      if (key) result[key] = item;
    }
    return result;
  }
  return raw;
}

export interface UnassignedTask {
  taskId: string;
  /** task display name — API field is `name` (not `taskName`) */
  name: string;
  /** may be "yyyy-MM-ddTHH:mm:ss" or "yyyy-MM-ddTHH:mm" — normalise with parseTaskStart() */
  start: string;
  durationMinutes: number;
  requiredSkills: string[];
  reason: UnassignedReasonCode;
  /** human-readable explanation of why the task is unassigned */
  message: string;
}

export interface BrokenConstraint {
  name: string;
  level: ConstraintLevel;
  /** number of matched violations, or null when the server does not provide a count */
  matchCount: number | null;
  /** penalty contribution — API returns a number (JPY-weighted score delta) */
  score: number | string;
}

export interface LongevityPerEmployee {
  employeeId: string;
  name: string;
  tenureYears: number;
  unplannedAbsenceDays3m: number;
}

export interface LongevityData {
  avgTenureYears: number;
  totalUnplannedAbsenceDays: number;
  avgUnplannedAbsenceDays: number;
  retention: RetentionData | null;  // null when the input has no leaver history
  // NOTE: per-employee longevity fields (tenureYears, unplannedAbsenceDays3m) live in
  // the top-level perEmployee[] array, NOT here. LongevityPerEmployee is kept for
  // backwards compat but is no longer returned inside this object.
}

// ---------- Full schedule response ----------

export interface ScheduleResponse {
  schedule: WorkSchedule;
  kpis: CompanyKpis;
  perEmployee: PerEmployeeRaw;
  shifts: Record<string, string[]>; // ISO date → list of employee ids
  unassigned: UnassignedTask[];
  longevity: LongevityData;
  brokenConstraints: BrokenConstraint[];
  preset: Preset;
  status: SolverStatus;
  score: string;
}

export interface StatusResponse {
  status: SolverStatus;
  score: string;
  preset: Preset;
}

/** Number of broken hard constraints from a score like "-1hard/-2medium/-300soft". */
export function scoreHardCount(score: string): number {
  const m = score?.match(/(-?\d+)hard/);
  return m ? Math.abs(parseInt(m[1], 10)) : 0;
}

// ---------- API fetch functions ----------

const BASE = '/api';

export async function fetchScenarios(): Promise<string[]> {
  const res = await fetch(`${BASE}/demo-data`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<string[]>;
}

/** POST /schedules/scenario/{name}?preset=&limitSeconds= → job id (text) */
export async function startSolve(
  scenarioName: string,
  preset: Preset,
  limitSeconds: number,
): Promise<string> {
  const url = `${BASE}/schedules/scenario/${encodeURIComponent(scenarioName)}?preset=${preset}&limitSeconds=${limitSeconds}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** GET /schedules/{jobId} → full schedule response */
export async function fetchSchedule(jobId: string): Promise<ScheduleResponse> {
  const res = await fetch(`${BASE}/schedules/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ScheduleResponse>;
}

/** GET /schedules/{jobId}/status → lightweight status */
export async function fetchStatus(jobId: string): Promise<StatusResponse> {
  const res = await fetch(
    `${BASE}/schedules/${encodeURIComponent(jobId)}/status`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<StatusResponse>;
}

/** DELETE /schedules/{jobId} → stop + return current best */
export async function stopSolve(jobId: string): Promise<ScheduleResponse> {
  const res = await fetch(
    `${BASE}/schedules/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ScheduleResponse>;
}
