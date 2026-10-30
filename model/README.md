# model — Timefold weekly work plan service

Derived from TimefoldAI/timefold-quickstarts (Apache-2.0), use-cases/employee-scheduling. See `LICENSE.txt`.

Timefold Solver **2.7.0** (Community Edition by default), Quarkus 3.39.4, Java 21+.
The quickstart's static UI and webjars were removed; the dashboard lives in `../ui`.

## Run

```sh
mvn quarkus:dev                      # http://localhost:8083, Swagger UI at /q/swagger-ui
mvn test                             # constraint tests + a 5 s solve of src/test/resources/tiny.json
```

Scenarios are read from `app.data-dir` (default `../data-gen/out`; tests use `src/test/resources`).
Override with `-Dapp.data-dir=...`.

### Licensed edition (optional)

`mvn quarkus:dev -Denterprise` (or `make model ENTERPRISE=1` from the root). The `enterprise` profile swaps in the
`ai.timefold.solver.enterprise` artifacts from Maven Central; no extra repository is needed. Timefold finds the
license itself via `TIMEFOLD_LICENSE_PATH` (absolute path), `TIMEFOLD_LICENSE` (the PEM **contents**) or
`~/timefold-license.pem`. Never commit it. Without the profile the license is ignored. How to get one:
[../docs/external-services.md](../docs/external-services.md#timefold-solver-community-or-enterprise).

The only difference for this app: `brokenConstraints[].matchCount` is filled in. In Community Edition, Timefold's
score analysis is a commercial feature, so broken constraints are computed by re-scoring once per constraint
and `matchCount` is `null`.

## Model

Single planning entity `Task.employee` (nullable, pinnable). An employee "works a day" if they have at least one
task that day. Score: `HardMediumSoftScore` (long-based; the 2.x name of `HardMediumSoftLongScore`).

| Constraint | Level | Penalty unit |
|---|---|---|
| Required skills | Hard | 1 per missing skill |
| Availability | Hard | minutes outside the availability window |
| Approved holiday | Hard | task minutes |
| Public holiday | Hard | task minutes |
| Task within shift | Hard | minutes outside 09:00–17:00 |
| One task at a time | Hard | overlap minutes |
| Max hours per day | Hard | excess minutes |
| Max hours per week | Hard | excess minutes |
| Minimum rest | Hard | missing rest hours (only bites when minRestHours > 16) |
| Unassigned task | Medium | 1 per task |
| Idle hours | Soft | minutes (available minutes − task minutes, on worked days) |
| Labor cost | Soft | ¥100 (hourlyRate × hours / 100, rounded) |
| Requested day off | Soft | 480 per date |
| Avoided hours | Soft | overlap minutes |
| Consecutive days risk | Soft | (L − 2) × 480 per run of L ≥ 3 days, **plus 2400 once per at-risk employee** |

Soft units are all "about minutes" (480 = one shift), so equal weights are meaningful.

**Why the one-off 2400 charge:** the `atRisk` KPI counts *people* with any run of 3+ days, but (L − 2) × 480 alone
counts *extra days* summed over people. With only the day charge, the solver shortens many runs a little and leaves
every one of those people at risk (burnout: 41–42 at risk under both presets). 2400 = five shifts: making one
person fully healthy is worth as much as removing five extra days elsewhere. Under health-first (weight 10) that is
24,000 per person.

**Consecutive days and carry-in:** `consecutiveDaysBeforeWeek` extends a run only if the employee also works on
day 0 (the Monday). If they are off on Monday, the old run has ended. The same rule is used for the constraint and
the KPIs (`ConsecutiveDays`). For Minimum rest, carry-in > 0 means "worked the day before the week".

## Presets (soft weights only)

| Constraint | health-first (default) | balanced | cost-first |
|---|---|---|---|
| Idle hours | 1 | 1 | 3 |
| Labor cost | 1 | 1 | 5 |
| Requested day off | 3 | 1 | 1 |
| Avoided hours | 2 | 1 | 1 |
| Consecutive days risk | 10 | 1 | 0 (report only) |

## REST API

| Method | Path | Returns |
|---|---|---|
| GET | `/` | 303 redirect to `app.ui-url` (default `http://localhost:5173`); configurable in `application.properties` |
| GET | `/demo-data` | scenario names (`*.json` in `app.data-dir`, without extension) |
| GET | `/demo-data/{name}` | scenario JSON (unsolved) |
| POST | `/schedules?preset=&limitSeconds=` | body = WorkSchedule JSON → job id (text). Missing/null body → 400 with hint to use `/schedules/scenario/{name}` |
| POST | `/schedules/scenario/{name}?preset=&limitSeconds=` | job id (text) |
| GET | `/schedules` | job ids |
| GET | `/schedules/{jobId}` | `{schedule, kpis, perEmployee, shifts, unassigned, longevity, brokenConstraints, preset, status, score}` |
| GET | `/schedules/{jobId}/status` | `{status, score, preset}` (`score` is null until the first solution) |
| DELETE | `/schedules/{jobId}` | stop, same body as GET |
| PUT | `/schedules/analyze?preset=` | body = WorkSchedule → broken constraints |

`limitSeconds` defaults to 30 and is clamped to 5–60. Unknown preset → 400. Unknown job → 404.

Mocked: in-memory job store (no persistence, no eviction). Money is integer JPY.
