# CLAUDE.md — Japanese Work-Life Balancer

Hackathon entry for **Hack for Humanity London (2026-10-29)**. A Timefold planning model that builds a weekly
work plan which prevents overwork, plus a UI, a Python MCP server and a synthetic data generator.

- PRD (source of truth for the problem): `docs/plan/work-scheduling-prd.md`
- Full build spec (source of truth for decisions and simplifications): `docs/plan/claude-code-prompt.md`
- Phase-by-phase kickoff: `docs/plan/kickoff-prompt.md`
- Answered questions: `docs/plan/clarifying-questions.md`

When the PRD and the build spec disagree, **the build spec wins** (it records deliberate simplifications).

## Golden rules

1. **Keep it simple.** The goal is a working end-to-end demo, not completeness. Mock anything that slows us down,
   and mark it with a `// MOCK:` or `# MOCK:` comment so it can be replaced later.
2. **Hard constraints are never traded for anything.** Employee health and safety come before cost and profit.
3. **No real personal data.** All names and data are synthetic and fictional. No health, family or age fields anywhere.
4. **Never commit `timefold-license.pem`** or any secret. It lives in `~/timefold-license.pem` or `$TIMEFOLD_LICENSE_PATH`.
5. **Stop at every phase checkpoint**, run the checks listed there, show the results, and wait for the user before
   starting the next phase.
6. When unsure about a Timefold API, check the docs (`https://docs.timefold.ai/llms.txt`) instead of guessing.
   The `timefold-prd` MCP server and Context7 may be used if connected, but nothing depends on them.
7. Prefer editing the copied quickstart over rewriting it. Keep the quickstart's Java package names.

## Layout

```
japanese-work-life-balancer/
├── Makefile          # setup | data | model | ui | mcp | demo | test | clean
├── CLAUDE.md
├── README.md
├── DEMO.md           # 5-minute demo script
├── .gitignore
├── docs/plan/        # PRD, questions, prompts
├── data-gen/         # Python generator (stdlib only, seeded) -> data-gen/out/*.json
├── model/            # Timefold Solver + Quarkus REST service (copied from quickstarts employee-scheduling)
├── ui/               # Vite + React + TypeScript dashboard
└── mcp/              # Python MCP server (streamable HTTP) wrapping the model's REST API
```

## Ports

| Service | Port | Notes |
|---|---|---|
| model (Quarkus) | 8083 | `mvn quarkus:dev` |
| ui (Vite) | 5173 | proxies `/api` → `http://localhost:8083` |
| mcp (FastMCP) | 8765 | streamable HTTP at `/mcp` |

## Core modeling decisions (short version)

- **Single planning entity:** `Task.employee` (nullable, `allowsUnassigned = true`, `@PlanningPin` supported).
  A shift is *derived*: an employee works a day if they have ≥ 1 task that day. No separate shift entity.
- **Score:** Hard / Medium / Soft (long-based). Medium = 1 per unassigned task.
- **Health constraint added** (soft): penalize consecutive-day runs of 3+ (including days worked before the week).
- **Weight presets** via `ConstraintWeightOverrides`: `health-first`, `balanced` (PRD equal weights), `cost-first`.
  Hard and medium constraints are identical in every preset.
- **KPIs are computed after solving** in plain Java (`KpiCalculator`), not as shadow variables.
- **Money is stored in JPY.** The UI converts to USD and GBP with fixed mock FX rates.

## Conventions

- JSON is camelCase. Dates are ISO `yyyy-MM-dd`, times `HH:mm`, date-times `yyyy-MM-ddTHH:mm:ss` (local, Asia/Tokyo assumed, no zone).
- Durations are integer minutes. Money is integer JPY.
- IDs: employees `E-001`, tasks `T-0001`.
- Python: 3.11+, use `uv` if available, otherwise `python3 -m venv`.
- Every service must start with one `make` target from the project root.

## Cut order if time runs short

1. Longevity view → 2. Hours-rather-not-work → 3. Pinning → 4. Profit metrics.
