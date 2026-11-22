# Build Spec — Japanese Work-Life Balancer (Claude Code prompt)

> **Implementation status (as of 2026-10-29, commit fac062c):** Build is complete and demo-ready.
> Key deviations from this spec: model runs on **:8083** (not :8080); GET `/` → 303 redirect to UI; the
> `Consecutive days risk` constraint adds a per-person flat charge (`AT_RISK_PERSON_PENALTY = 2400`) in addition to
> the per-day formula; scenarios were retuned for demonstrability (see README → Scenarios and "What is mocked").
> Extra UI features beyond the spec: solver replay bar, guided "▶ Play demo" tour (19 steps), theme toggle,
> plain-language KPI ⓘ tooltips, Compare runs as a collapsed `<details>` panel, About modal (constraints,
> KPIs, stack reference).  `make check` was split out from `setup` as a separate dry-run verification target.
> → See [README.md](../../README.md#deviations) for full details.

You are building a hackathon entry for **Hack for Humanity London (2026-10-29)** in the current directory:
`japanese-work-life-balancer/` (it sits inside the `ai-ml-dl-stuff` git repository — do **not** run `git init`).

Read `CLAUDE.md` and `docs/plan/work-scheduling-prd.md` first. This document records the decisions and
simplifications agreed for the build; **where it differs from the PRD, this document wins.**

The goal is a **working end-to-end demo**, as simple as possible. Mock anything that slows us down and mark it
with `MOCK:` comments.

Work in phases. **At the end of each phase, stop, run the checkpoint checks, report the results, and wait for
the user to say "continue".**

---

## 0. What we are building

| Part | Folder | Tech | Purpose |
|---|---|---|---|
| Model | `model/` | Java 21, Maven, Quarkus, Timefold Solver (quickstarts `stable` branch) | Stateless REST service that solves a weekly plan |
| Data | `data-gen/` | Python 3.11+, stdlib only | Seeded synthetic scenarios as JSON |
| UI | `ui/` | Vite + React + TypeScript (+ Recharts) | See, compare and explain plans |
| MCP | `mcp/` | Python MCP SDK (FastMCP), streamable HTTP | Lets Claude drive the solver |
| Root | `./` | Makefile, README, DEMO.md, .gitignore | One-command start for everything |

The tools JDK 21+, Maven, Node 20+ and Python 3.11+ are already installed (macOS).

---

## Phase 0 — Setup

1. Copy the employee-scheduling quickstart into `model/` (copy, don't fork):
   ```bash
   git clone --depth 1 --branch stable https://github.com/TimefoldAI/timefold-quickstarts.git /tmp/tf-quickstarts
   cp -R /tmp/tf-quickstarts/use-cases/employee-scheduling/. model/
   ```
   - If `model/pom.xml` depends on a parent POM that only exists in the quickstarts repo, make it standalone by
     inlining the needed properties, BOMs and plugin versions. Keep the Timefold version the `stable` branch pins.
   - Add a short `model/README.md` note: "Derived from TimefoldAI/timefold-quickstarts (Apache-2.0), use-cases/employee-scheduling."
   - Keep the original `LICENSE` notice if one was copied.
   - Remove the quickstart's static UI (`src/main/resources/META-INF/resources/**`) and any webjar dependencies;
     the UI lives in `ui/`.
2. Create `.gitignore` at the project root: `model/target/`, `ui/node_modules/`, `ui/dist/`, `mcp/.venv/`,
   `data-gen/.venv/`, `data-gen/out/`, `**/__pycache__/`, `.DS_Store`, `timefold-license.pem`, `*.pem`, `.env`.
3. License: if the solver needs the hackathon license at runtime, read it from `$TIMEFOLD_LICENSE_PATH`,
   `$TIMEFOLD_LICENSE`, or `~/timefold-license.pem`. Never copy it into the repo.
4. Create a `Makefile` skeleton (filled in later, see §6).

**Checkpoint 0:** `cd model && mvn -q -DskipTests package` succeeds on the untouched quickstart domain (before any
changes beyond the UI removal). Report the Timefold Solver version and the score type the quickstart uses.

---

## Phase 1 — The model (`model/`)

### 1.1 Domain (rename the quickstart's classes; keep its package)

**`Employee`** — problem fact, `@PlanningId String id`. Use `@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")`.

| Field | Type | Notes |
|---|---|---|
| `id` | String | `E-001` |
| `name` | String | fictional |
| `skills` | `Set<String>` | plain list, no levels |
| `hourlyRate` | int | JPY per task hour (cost) |
| `billingRate` | int | JPY per task hour (revenue) |
| `maxHoursPerDay` | int | |
| `maxHoursPerWeek` | int | hard maximum |
| `minRestHours` | int | from shift end to next shift start |
| `availability` | `List<TimeWindow>` | one entry per available date `{date, start, end}`; a date not listed = unavailable |
| `daysOffRequested` | `Set<LocalDate>` | soft wish, not approved holiday |
| `avoidHours` | `List<TimeWindow>` | per-day time ranges they'd rather not work |
| `consecutiveDaysBeforeWeek` | int | days worked in a row right before `weekStart` |
| `approvedHolidays` | `Set<LocalDate>` | hard |
| `holidayDaysRemaining` | int | before the week |
| `tenureYears` | double | report only |
| `unplannedAbsenceDays3m` | int | report only, no reasons |

`TimeWindow`: `{ LocalDate date; LocalTime start; LocalTime end; }` with helpers `minutes()` and `overlapMinutes(LocalDateTime s, LocalDateTime e)`.

Add helper methods on `Employee` (with `@JsonIgnore`): `windowOn(LocalDate)`, `availableMinutesOn(LocalDate)`,
`isAvailable(LocalDateTime start, LocalDateTime end)`, `hasAllSkills(Set<String>)`.

**`Task`** — `@PlanningEntity`, `@PlanningId String id`.

| Field | Type | Notes |
|---|---|---|
| `id` | String | `T-0001` |
| `name` | String | |
| `start` | LocalDateTime | fixed, never moved |
| `durationMinutes` | int | 30–480, multiple of 15 |
| `requiredSkills` | `Set<String>` | 1+ |
| `employee` | Employee | `@PlanningVariable(allowsUnassigned = true)`, serialized as id via `@JsonIdentityReference(alwaysAsId = true)` |
| `pinned` | boolean | `@PlanningPin` |

Helpers (`@JsonIgnore`): `end()`, `date()`, `dayIndex(LocalDate weekStart)`, `overlaps(Task other)`.

**`WorkSchedule`** — `@PlanningSolution` (rename the quickstart's `EmployeeSchedule`).

| Field | Notes |
|---|---|
| `name` | scenario name |
| `weekStart` | LocalDate (a Monday); the plan covers 7 days |
| `shiftStart`, `shiftEnd` | `09:00`, `17:00` |
| `publicHolidays` | `List<LocalDate>` |
| `leavers` | `[{ id, leftAfterYears }]`, report only; drives computed `retention` |
| `employees` | `@ProblemFactCollectionProperty @ValueRangeProvider` |
| `tasks` | `@PlanningEntityCollectionProperty` |
| `score` | `@PlanningScore`, long-based HardMediumSoft (`HardMediumSoftLongScore`, or `HardMediumSoftScore` if the pinned version renamed it) |
| `constraintWeightOverrides` | `@ConstraintWeightOverrides` — set from the requested preset |
| `solverStatus` | as in the quickstart |

### 1.2 Constraints (`WorkScheduleConstraintProvider`)

Use Constraint Streams. Name every constraint exactly as below (the UI and presets refer to these names).
For assigned-only streams use `forEach(Task.class)` (unassigned tasks are filtered automatically);
use `forEachIncludingUnassigned` only for the medium constraint.

**Hard** (never overridden by presets):

| Name | Rule | Penalty |
|---|---|---|
| `Required skills` | assigned employee lacks any required skill | 1 per missing skill |
| `Availability` | task not fully inside the employee's availability window that day (or day not available) | minutes outside the window |
| `Approved holiday` | task on an employee's approved holiday | task minutes |
| `Public holiday` | any task assigned on a public holiday | task minutes |
| `Task within shift` | task starts before `shiftStart` or ends after `shiftEnd` | minutes outside |
| `One task at a time` | two tasks of the same employee overlap (`forEachUniquePair` + `Joiners.overlapping`) | overlap minutes |
| `Max hours per day` | sum of task minutes per employee per date > `maxHoursPerDay*60` | excess minutes |
| `Max hours per week` | sum per employee > `maxHoursPerWeek*60` | excess minutes |
| `Minimum rest` | employee works dates d1 < d2 and rest `(d2−d1 days)*24h − (shift length)` < `minRestHours` | missing rest hours. With a 09–17 shift this only bites when `minRestHours > 16` (then consecutive days are forbidden). |

**Medium:**

| Name | Rule | Penalty |
|---|---|---|
| `Unassigned task` | `employee == null` | 1 per task |

**Soft** (weights come from the preset; default penalty units below make them comparable — document the units in `model/README.md`):

| Name | Rule | Unit of penalty |
|---|---|---|
| `Idle hours` | per employee per worked date: `availableMinutesOn(date) − taskMinutes(date)` (non-worked dates = 0) | minutes |
| `Labor cost` | per assigned task: `hourlyRate * durationMinutes / 60` | **per ¥100** (divide by 100, round) |
| `Requested day off` | employee has ≥ 1 task on a date in `daysOffRequested` | 480 per date |
| `Avoided hours` | overlap between a task and the employee's `avoidHours` window that day | minutes |
| `Consecutive days risk` | for each run of worked days of length L ≥ 3 (a run starting on `weekStart` adds `consecutiveDaysBeforeWeek`) | `(L − 2) * 480` |

Implementation hint for `Consecutive days risk`: `forEach(Task)` → `groupBy(Task::getEmployee, toSet(t -> t.dayIndex(weekStart)))`
→ compute runs in a plain Java helper (`ConsecutiveDays.runs(Set<Integer>, int carryIn)`) → `penalizeLong`.
`weekStart` can be read by joining with the `WorkSchedule`-level fact or by storing a `weekStart` field on each
`Task` when the request is received (simplest — do that, mark it `@JsonIgnore` or set it server-side).
Approved and public holidays break runs automatically because no tasks can be on them.

### 1.3 Presets (`ConstraintWeightOverrides`)

Hard and medium weights are always `ONE_HARD` / `ONE_MEDIUM`. Only soft weights change.

| Constraint | `health-first` (default) | `balanced` (PRD: all equal) | `cost-first` |
|---|---|---|---|
| Idle hours | 1 | 1 | 3 |
| Labor cost | 1 | 1 | 5 |
| Requested day off | 3 | 1 | 1 |
| Avoided hours | 2 | 1 | 1 |
| Consecutive days risk | 10 | 1 | 0 (report only, as the original PRD) |

Expose presets in `Presets.java` as a `Map<String, ConstraintWeightOverrides<...>>`.

### 1.4 KPIs and explanations (`KpiCalculator`, plain Java, run after solving and on every GET)

Per employee: `hoursPerDay` (date → hours), `totalHours`, `idleHours`, `laborCost`, `revenue`
(`billingRate × task hours`), `profit` (`revenue − laborCost`), `daysWorked`, `maxConsecutiveDays`
(including carry-in), `atRisk` (`maxConsecutiveDays ≥ 3`), `holidaysTakenThisWeek` (approved holidays in the week
that are not public holidays), `holidaysRemainingAfter`, `tenureYears`, `unplannedAbsenceDays3m`.

Company: `totalLaborCost`, `totalRevenue`, `companyProfit`, `idleHoursTotal`, `unassignedCount`,
`assignedTaskHours`, `healthyShare` (share with `maxConsecutiveDays < 3`), `avgConsecutiveDays`, `atRiskCount`,
`employeesWorking`.

Shifts (derived): `shifts`: date → list of employee ids working that date.

Longevity: `avgTenureYears`, `totalUnplannedAbsenceDays`, `avgUnplannedAbsenceDays`, `retention`.

Unassigned reasons (`UnassignedReasoner`, first match wins):
1. `PUBLIC_HOLIDAY` — "Task falls on a public holiday"
2. `NO_SKILLED_EMPLOYEE` — "No employee has all of: …"
3. `NO_SKILLED_EMPLOYEE_AVAILABLE` — "No skilled employee is available at that time"
4. `CAPACITY` — "All eligible employees are at their limits or busy"

Broken constraints: use `SolutionManager.analyze(schedule)` and return a flat list
`[{ name, level: "HARD|MEDIUM|SOFT", matchCount, score }]`, non-zero only, hard first.

### 1.5 REST API (adapt the quickstart's resource; keep it async)

| Method | Path | Behaviour |
|---|---|---|
| GET | `/demo-data` | list scenario names = `*.json` files in `app.data-dir` (default `../data-gen/out`) |
| GET | `/demo-data/{name}` | return that scenario JSON (unsolved) |
| POST | `/schedules?preset=health-first&limitSeconds=30` | body = full `WorkSchedule` JSON; starts async solve; returns job id (text) |
| POST | `/schedules/scenario/{name}?preset=…&limitSeconds=…` | convenience: load scenario from disk and solve (used by the MCP server) |
| GET | `/schedules` | list job ids |
| GET | `/schedules/{jobId}` | `{ schedule, kpis, perEmployee, shifts, unassigned, longevity, brokenConstraints, preset, status, score }` |
| GET | `/schedules/{jobId}/status` | `{ status, score, preset }` only |
| DELETE | `/schedules/{jobId}` | stop solving, return current best |
| PUT | `/schedules/analyze` | body = schedule, returns broken constraints |

- Per-request time limit via `SolverManager.solveBuilder()...withConfigOverride(new SolverConfigOverride<>().withTerminationConfig(new TerminationConfig().withSpentLimit(Duration.ofSeconds(n))))`. Default 30 s; allow 5–60.
- Default `application.properties` termination: `quarkus.timefold.solver.termination.spent-limit=30s`.
- Before solving, set `constraintWeightOverrides` from the preset and set each task's `weekStart`.
- Enable CORS for `http://localhost:5173` (the Vite proxy should make it unnecessary, but it's cheap).
- Jobs live in an in-memory map (`MOCK:` no persistence).

### 1.6 Tests (keep it small)

`ConstraintVerifier` tests for each **hard** constraint plus `Consecutive days risk` (one "penalizes" and one
"doesn't penalize" case each). Add one test that solves `src/test/resources/tiny.json` (8 employees, ~40 tasks,
hand-written) for 5 s and asserts `hard == 0`.

**Checkpoint 1:**
- `mvn test` passes.
- `mvn quarkus:dev`, then:
  ```bash
  JOB=$(curl -s -X POST "localhost:8083/schedules?preset=health-first&limitSeconds=5" -H 'Content-Type: application/json' -d @src/test/resources/tiny.json)
  sleep 7; curl -s localhost:8083/schedules/$JOB | jq '.score, .kpis'
  ```
  shows `0hard/…` and sensible KPIs.

---

## Phase 2 — Synthetic data (`data-gen/`)

`data-gen/generate.py` — Python stdlib only, `--seed 42 --out out/`. Deterministic. Writes the JSON shape the
model accepts (exactly the `WorkSchedule` request format, `employee: null` for every task unless pinned).

All names are **fictional** (combine ~30 Japanese-style family names with ~30 given names; include a comment
saying the combinations are synthetic). No health, family or age fields.

### Scenarios

| File | Week (Mon) | Public holidays | Employees | Tasks | Task hours ÷ capacity | Story |
|---|---|---|---|---|---|---|
| `tiny.json` | 2026-11-09 | – | 8 | 40 | ~60% | debugging (also copy to `model/src/test/resources/`) |
| `normal.json` | 2026-11-09 | – | 50 | 500 | ~65% | a regular week, should be fully assigned |
| `overloaded.json` | 2026-11-09 | – | 50 | 500 | ~125% | more work than capacity → unassigned tasks, still 0 hard |
| `holiday.json` | 2026-11-02 | 2026-11-03 (Culture Day) | 50 | 500 | ~75% | ~20 tasks fall on the public holiday → unassigned with reason; ~10% of staff have approved holidays |
| `burnout.json` | 2026-11-09 | – | 50 | 500 | ~85% | 60% of staff arrive with 2–5 days already worked in a row; best scenario for the cost-first vs health-first demo |

"Capacity" = sum over employees of `min(available minutes in week, maxHoursPerWeek*60)`. Tune task count/durations
to hit the target ratio; print the achieved ratio. Also check the ratio **per day** (weekends have fewer available
staff) and per skill, so `normal.json` doesn't produce unassigned tasks by accident.

### Distributions

- **Skills (8):** `accounting`, `customer-support`, `data-analysis`, `sales`, `translation-en-ja`, `it-support`,
  `logistics`, `design`. Employees have 1–4 skills; every skill is held by ≥ 4 employees. Tasks need 1 skill (75%) or 2 (25%).
- **Rates:** `hourlyRate` ¥1,500–3,500 (round to ¥50); `billingRate` = hourlyRate × U(1.5, 2.5) rounded to ¥50.
- **Limits:** `maxHoursPerDay` 8 (70%), 6 (20%), 4 (10%). `maxHoursPerWeek` 40 (65%), 30 (20%), 20 (15%).
  `minRestHours` 11–12 (90%), 20 or 24 (10% — these people can't work consecutive days).
- **Availability:** 75% Mon–Fri, 25% include Sat and/or Sun. 15% start at 10:00 or leave at 15:00/16:00.
  Availability is generated independently of holidays; the hard constraints handle approved and public holidays.
- **Preferences:** 0–2 `daysOffRequested`; 20% have one `avoidHours` window (e.g. 15:00–17:00 on one day).
- **History:** `consecutiveDaysBeforeWeek` 0–2 normally (burnout: see table). `holidayDaysRemaining` 0–20.
  `tenureYears` 0–25 (one decimal). `unplannedAbsenceDays3m` 0–6, mildly higher for people with long carry-in runs.
- **Leavers:** `[{ "id": "L-001", "leftAfterYears": 0.4 }, …]`, half the headcount. Early leavers rise with the share of staff
  on 3+ day carry-in streaks. The model computes Kaplan–Meier `retention` (year 1/3/5) from these plus current `tenureYears`.
- **Tasks:** start on a 15-minute grid, fully inside 09:00–17:00; duration 30–480 in 15-minute steps, skewed short
  (most 30–180). ~85% on weekdays, ~15% on weekends. Names from per-skill templates
  (e.g. accounting: "Invoice reconciliation", "Expense review"; it-support: "Laptop setup", "VPN ticket").
- **Pinned:** in `normal.json`, pin 3 tasks to valid employees to show pinning.

Also print a summary per scenario: employees, tasks, task hours, capacity, ratio, tasks per skill, tasks on public holidays.

**Checkpoint 2:** `make data` generates 5 files. Solve `normal` and `overloaded` with a 30 s limit:
`normal` → `0hard`, unassigned ≈ 0; `overloaded` → `0hard`, unassigned > 0. Report scores and KPIs.

---

## Phase 3 — UI (`ui/`)

Vite + React + TypeScript, Recharts, plain CSS (no component library). Dev proxy `/api` → `http://localhost:8083`.
Light and dark mode via `prefers-color-scheme`. Keep it to a handful of components.

**Top bar:** scenario dropdown (from `/demo-data`), preset dropdown (`health-first`, `balanced`, `cost-first`),
time limit (10 s / 30 s), **Solve**, **Stop**, currency selector (JPY / USD / GBP), role selector (Manager / HR / Executive).
Status line: solving spinner, live score (poll `/schedules/{id}` every 2 s while solving).

**Currency:** all values arrive in JPY. Convert in the UI with fixed rates in `src/fx.ts` (`MOCK:` e.g. 1 USD = 150 JPY,
1 GBP = 195 JPY), labeled "indicative rates".

**Panels:**
1. **KPI cards in two side-by-side groups** — *Health*: healthy share, at-risk count, avg consecutive days, idle hours.
   *Business*: labor cost, revenue, profit, unassigned tasks. (Health on the left: it comes first.)
2. **Week grid:** rows = employees, columns = 7 days. Cell shows hours worked. Colors: not working (neutral),
   approved holiday (blue), public holiday (hatched), worked day colored by position in its run
   (1–2 green, 3 amber, 4+ red). Row end: max consecutive days, at-risk badge, profit. Click a row → side panel
   with that employee's tasks.
3. **Hours per employee** bar chart (Recharts), with each employee's daily/weekly limit as a marker.
4. **Unassigned tasks** table with reason.
5. **Broken constraints** panel (from the GET response) — shows `0 hard` clearly when feasible.
6. **Compare runs:** "Keep this run for comparison" button. Shows the kept run and the current run side by side
   with deltas (labor cost, profit, at-risk count, healthy share, idle hours, unassigned). This is the core demo moment.
7. **Longevity view:** HR and Executive roles see per-employee tenure and unplanned absences plus company averages
   and retention; Manager sees company-level numbers only (`MOCK:` role selector, no auth).

**Checkpoint 3:** `make model` + `make ui`, open `http://localhost:5173`, solve `burnout` with `cost-first`, keep it,
solve with `health-first`, and the compare panel shows fewer at-risk employees and the extra cost. Report the numbers.

### Tour narration voice (`ui/tts-plugin.ts`, `ui/src/tour/voice.ts`)

**Status: BUILT 2026-11-21.** 4 pool voices (George, Brian, Alice, Charlotte) are still `// MOCK:` — pending an ear-check with `eleven_multilingual_v2`.

Presentation only: the voice chosen never changes the schedule, scores or KPIs.

**Why:** the narrator always speaks one fixed ElevenLabs voice (Lily, from `ELEVENLABS_VOICE_ID`) and can run out of credits mid-tour. The team wants a curated set of quality English and Japanese voices, a credit-aware fallback, and an Auto choice that makes both decisions per line. Manual choices keep working.

**Decisions taken:** curated quality list (no API quality score exists); ElevenLabs while credits are at least 10%, then Gemini if allowed, then the browser voice; Auto is the default; with no ElevenLabs key, Gemini if allowed, else the browser voice. Lily stays the English default voice, unless `ELEVENLABS_VOICE_ID` names a voice outside the curated list: that voice is the user's own, leads the English lines in Auto and is listed first in the picker as "Your voice" (decided 2026-11-22).

**Reuse first (no parallel paths):** `GEMINI_VOICE_OPTIONS`, `GEMINI_JA_VOICES`, `optionKey`, `resolveGeminiVoice`, `ttsCacheKey`, `coolingUntil`, the per-minute rate limiter and `diskCache` in `ui/tts-plugin.ts` and `ui/src/tour/voice.ts`. Keep the new logic in small pure functions with `fetch` and `now` injected, so tests run offline.

**Files to change**
- `ui/tts-plugin.ts`: voice pool, `fetchElevenCredits`, `pickElevenVoice`, Gemini guard, extracted `elevenSpeak` and `geminiSpeak`, the `elevenlabs-auto` branch, `VoiceProvider` union, `FetchLike` type, `GET /tts`.
- `ui/src/tour/voice.ts`: `PROVIDER_IDS`, `MULTI_VOICE`, `VoiceProvider`, the saved-choice fallback, `X-TTS-Provider` handling.
- `ui/src/components/VoicePicker.tsx`: labels for the new entries and the served-by note.
- `ui/scripts/warm-voice.ts`: accept `elevenlabs-auto` (currently only `gemini`, `gemini-argon`, `elevenlabs`).
- `Makefile`: `warm-voice` help text.
- `ui/src/__tests__/ttsPlugin.test.ts`, `ui/src/__tests__/voice.test.tsx`: the tests below.
- Docs listed under "Docs to update when this ships" below.

- **Default:** `elevenlabs-auto` (Auto) when an ElevenLabs key is set. Without one: Gemini if allowed, else the browser voice.
- **Pool:** `ELEVENLABS_VOICE_OPTIONS` in `ui/tts-plugin.ts`, entries `{ voiceId, label, lang: 'en' | 'ja', rank }`. At least 3 English and 2 Japanese voices, each ear-checked with `eleven_multilingual_v2`. Placeholders are marked `// MOCK:`. Pick from the premade voices: `GET /v2/voices?voice_type=default&language=…&high_quality=true` (confirmed in Step 0). Premade voices need no add step and work on the free tier. Avoid Voice Library voices (`GET /v1/shared-voices`): the free tier cannot use them through the API, some are paid-only, and some cost 2× credits per character. The API has no quality score, so `rank` lives in code.
- **Language:** Japanese if the line has kana or kanji, otherwise English. An empty pool for a language skips ElevenLabs for that language.
- **Credits:** `GET /v1/user/subscription` (`character_count`, `character_limit`). Success is cached 5 minutes, failure 60 seconds, both through the existing rate limiter. Below 10% left, or a line that would take the account below 10%, skips ElevenLabs. Unknown credits fail open (ElevenLabs is used). `GET /tts` returns the cached value and never waits on the network.
- **Quota errors:** an ElevenLabs quota error marks ElevenLabs "credits exhausted" for a cooldown and routes to the fallback. It must not return a plain 502. The cooldown lasts 5 minutes, the same as the credits cache.
- **Step 0 findings (confirmed 2026-11-21 in the ElevenLabs docs):**
  - Error bodies come in two shapes. New: `{detail:{type, code, message, status, request_id}}`, where `status` is marked legacy. Old: `{detail:{status, message}}`. `upstreamError` reads `detail.code` first, then `detail.status`.
  - "Out of credits" is code `insufficient_credits` (type `payment_required`, HTTP 402) on the errors page, and `quota_exceeded` in the older help pages, listed under 400/401. The HTTP status is not settled, so detection keys on the **code**: any 400, 401 or 402 whose code is `quota_exceeded` or `insufficient_credits`. A 401 with `invalid_api_key` stays a 502, as today.
  - 429 codes (`rate_limit_exceeded`, `concurrent_limit_exceeded`, `system_busy`, older `too_many_concurrent_requests`) keep the existing 429 cooldown. They do not mark credits exhausted.
  - `GET /v1/user/subscription` returns `character_count`, `character_limit` and `next_character_count_reset_unix`. It needs the `user_read` key permission; the error for a key without it is not documented. So any non-OK reply means "unknown" (fail open, cached 60 seconds).
  - TTS replies carry a `character-cost` header. Not used yet: a possible follow-up to cut the credits lag.
  - Sources: `elevenlabs.io/docs/eleven-api/resources/errors`, `…/api-reference/user/subscription/get`, `…/api-reference/voices/search`, `…/api-reference/introduction`.
- **Fallback chain:** ElevenLabs → Gemini (only if `GEMINI_TIER=paid`, `GEMINI_BUDGET_LEFT_PCT` is unset or ≥ 10, and Gemini is not in a 429 cooldown) → browser voice. English lines use `Aoede`. Japanese lines use `GEMINI_JA_VOICES[0]` with no translation step, since the text is already Japanese.
- **Shared steps:** extract `elevenSpeak` and `geminiSpeak` from the existing branches. The Auto branch composes them. No copied cache, gate or fetch code.
- **Config per request:** `GEMINI_TIER` and `GEMINI_BUDGET_LEFT_PCT` are read on each request, so edits apply without a restart.
- **Allow-list:** a client `voiceId` is accepted only if it is in the pool (or is the configured default). Anything else gets 400, so credits are never spent on an arbitrary voice.
- **Cache order:** resolve the provider and voice first, then look up the cache with that voice's key.
- **Served-by:** the response header `X-TTS-Provider` names the engine that spoke the line. The picker shows it.
- **Migration:** a saved bare `elevenlabs` choice maps to the first curated voice.

**Tests** (write first, with `/tdd`; interview the user before writing them, per the project rules). Files: `ui/src/__tests__/ttsPlugin.test.ts`, `ui/src/__tests__/voice.test.tsx`.
- `pickElevenVoice`: English text gets an `en` voice; Japanese text gets a `ja` voice; below 10% returns `null`; a line that would drop the account below 10% returns `null`; a populated `en` pool with an empty `ja` pool sends Japanese lines to Gemini or the browser; an empty pool returns `null`.
- `fetchElevenCredits`: parses `character_limit` and `character_count`; success cached 5 minutes; failure cached 60 seconds; a network error returns "unknown" and is not retried on every line.
- Quota error: an ElevenLabs quota response sets the "credits exhausted" window and routes to Gemini or the browser, not a 502.
- Gemini guard: tier unset blocks Gemini; `paid` with budget above 10% allows it; budget below 10% blocks it; cooldown blocks it; config changes apply without a restart.
- Handler: `elevenlabs-auto` calls the chosen voice in the URL; a cached line for the chosen voice is a hit; a `voiceId` not in the pool gets 400.
- Fallback response: the `X-TTS-Provider` header names the provider that served the line.
- `GET /tts`: lists Auto and every curated voice; unkeyed entries are unconfigured; credits are returned as cached or "unknown" without a network wait.
- Client: a saved bare `elevenlabs` maps to the first curated voice.

**Acceptance criteria**
1. The curated pool has at least 3 English and at least 2 Japanese voices, each ear-checked.
2. With credits above 10%, English lines use an English pool voice and Japanese lines use a Japanese pool voice.
3. Below 10% (or on a quota error), lines go to Gemini only if the guard allows it, otherwise to the browser voice. No line returns a 502 to the tour.
4. Gemini is never chosen automatically on the free tier or with budget below 10%.
5. Every provider change is visible in the picker (served-by note).
6. All existing tests still pass, and the new tests above pass.

**Verification**
1. `cd ui && npm test && npx tsc --noEmit && npm run build`.
2. Browser check at 1280 px and 390 px (`/browser-ui-qa`): Auto is the default, the curated voices appear, and English and Japanese lines sound different.
3. `bash scripts/check-tts.sh` still passes with the real key.

**Open risks**
- Quality is a human judgement. The curated list is only as good as the ear test.
- The quota error codes are documented, but which HTTP status comes back with `quota_exceeded` is not. Detection keys on the code to cover all three statuses. A live out-of-credits reply has not been seen yet.
- Credits can lag. The 10% rule and the line-length check give a buffer, but the account can still run out between checks.
- With `GEMINI_TIER` unset and no ElevenLabs key, the narrator uses the browser voice. The browser's Japanese quality is not guaranteed.
- `GEMINI_BUDGET_LEFT_PCT` goes stale unless someone updates it. With the tier set to paid and no budget value, only the 429 cooldown limits spend.
- Japanese detection is a heuristic. Mixed text, or English lines that should be spoken in Japanese, may pick the wrong voice. Tagging the fixed tour lines with an explicit language is a possible follow-up.

**Docs to update when this ships** (kept out of the setup guide until then): `README.md` (voice narration section, env table rows for `TTS_PROVIDER`, `GEMINI_TIER`, `GEMINI_BUDGET_LEFT_PCT`), `DEMO.md` (warm-voice step), `docs/external-services.md` (Auto section, credits troubleshooting, Gemini guard and its env vars), `docs/maintaining.md`, `ui/.env.example`, and the `Makefile` help text.

**Checkpoint 3b (after the voice build):** `make ui`, then `make warm-voice PROVIDER=elevenlabs-auto` (a second run reports cache hits). Play one English and one Japanese line and confirm they use different voices. Lower the credit threshold temporarily to check the Gemini and browser fallbacks, and that the served-by note changes.

---

## Phase 4 — MCP server (`mcp/`)

Python, official MCP Python SDK (FastMCP API), **streamable HTTP** on `0.0.0.0:8765` at path `/mcp`.
Use `httpx` to call the model at `MODEL_URL` (default `http://localhost:8083`). Manage deps with `uv`
(`mcp/pyproject.toml`), fallback to a venv.

Tools (return compact JSON — never dump all 500 tasks):

| Tool | Args | Returns |
|---|---|---|
| `list_scenarios` | – | scenario names |
| `solve_schedule` | `scenario`, `preset="health-first"`, `time_limit_seconds=30`, `wait=True` | job id; if `wait`, polls until done and returns the summary |
| `get_plan_summary` | `job_id` | score, status, company KPIs, top 5 at-risk employees, unassigned count by reason |
| `get_employee_schedule` | `job_id`, `employee_id` | that employee's tasks, hours per day, consecutive days, cost/profit |
| `explain_score` | `job_id` | broken constraints list |
| `compare_presets` | `scenario`, `presets=["cost-first","health-first"]`, `time_limit_seconds=10` | KPI table per preset + deltas (solve sequentially) |
| `stop_solving` | `job_id` | final summary |

Give every tool a clear docstring (the agent reads them). Add one MCP resource `prd://summary` returning a short
plain-text summary of the problem and constraints (from this spec).

**Checkpoint 4:**
- `make mcp` starts the server.
- `npx @modelcontextprotocol/inspector` (or a small `mcp/smoke_test.py` client) lists the tools and runs
  `compare_presets("burnout")`.
- Print the command to register it: `claude mcp add --transport http jwlb http://localhost:8765/mcp`.

---

## Phase 5 — Root, docs and demo

### Makefile targets

| Target | Does |
|---|---|
| `setup` | check `java -version` ≥ 21, `mvn`, `node` ≥ 20, `python3` ≥ 3.11; `npm install` in `ui/`; create Python env in `mcp/`; warn (don't fail) if no license file found |
| `data` | `python3 data-gen/generate.py --seed 42 --out data-gen/out` and copy `tiny.json` to `model/src/test/resources/` |
| `model` | `cd model && mvn quarkus:dev` |
| `ui` | `cd ui && npm run dev` |
| `mcp` | run the MCP server |
| `demo` | `data`, then start model in background, wait until `curl -sf localhost:8083/demo-data` succeeds, then start ui and mcp; `trap` kills all on Ctrl-C (put the logic in `scripts/dev.sh`) |
| `warm-voice` | `PROVIDER=gemini` (or `gemini-argon`, `gemini-ja`, `elevenlabs`; `elevenlabs-auto` once built); UI must be running. Pre-records the fixed tour lines into `ui/.tts-cache`, and re-runs report cache hits |
| `test` | `cd model && mvn test` |
| `clean` | remove build outputs and `data-gen/out/` |

### Docs

- `README.md`: what it is, the community problem (Japanese overwork / karoshi, with a London bridge — the same
  pattern in London care and hospitality staff and Japanese firms' London offices), architecture diagram (Mermaid),
  quick start (`make setup && make demo`), constraints table with the presets, penalty units, what is mocked.
- `DEMO.md`: a 5-minute script:
  1. (45 s) Problem and who benefits.
  2. (60 s) `burnout` scenario, `cost-first`: red cells, at-risk count, profit.
  3. (60 s) Same scenario, `health-first`: compare panel → fewer at-risk employees, the cost of health in JPY/GBP.
     Point out `0hard` in both: no rule is ever broken.
  4. (45 s) `overloaded`: unassigned tasks with reasons instead of overworking people.
  5. (45 s) Claude via MCP: "Compare cost-first and health-first for the burnout week and tell me what health costs us."
  6. (25 s) Wrap-up: long-term longevity view for HR.

**Checkpoint 5:** from a fresh terminal, `make setup && make demo` brings everything up; walk through DEMO.md steps 2–5
and report the numbers you'd quote.

---

## Simplifications vs the PRD (state these honestly in the README)

- Shifts are derived from task assignments, not planned separately.
- Shadow variables in the PRD are computed after solving (KPIs) or inside constraint streams.
- Added a soft `Consecutive days risk` constraint (the PRD reported health only); `cost-first` reproduces the PRD's
  "report only" behaviour.
- Soft penalties use normalized units (minutes, ¥100) so equal weights are meaningful.
- No persistence, no auth, fixed FX rates (all marked `MOCK:`).
- Tour narration voice auto-pick is a presentation choice. Credits and quality choose the voice only; they never change the schedule or KPIs.

## Cut order if time runs short

Longevity view → hours-rather-not-work (`Avoided hours`) → pinning → profit metrics → tour voice auto-pick (keep the fixed Lily voice from `ELEVENLABS_VOICE_ID`).
