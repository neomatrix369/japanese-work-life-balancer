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
4. **Never commit `timefold-license.pem`** or any secret. It lives in `~/timefold-license.pem`, `$TIMEFOLD_LICENSE_PATH`
   (a path) or `$TIMEFOLD_LICENSE` (the PEM contents — never echo it), and is only used by `make demo|model ENTERPRISE=1`.
   The ElevenLabs key lives in `ui/.env.local` or the shell. Setup steps: `docs/external-services.md`.
5. **Stop at every phase checkpoint**, run the checks listed there, show the results, and wait for the user before
   starting the next phase.
6. When unsure about a Timefold API, check the docs (`https://docs.timefold.ai/llms.txt`) instead of guessing.
   The `timefold-prd` MCP server and Context7 may be used if connected, but nothing depends on them.
7. Prefer editing the copied quickstart over rewriting it. Keep the quickstart's Java package names.

## Layout

```
japanese-work-life-balancer/
├── Makefile          # setup | data | model | ui | mcp | demo | test | clean
├── scripts/
│   ├── dev.sh        # started by `make demo`; spawns model, ui, mcp; logs → .logs/
│   └── capture-gallery.py  # re-shoots docs/screenshots/ from a running demo (Playwright)
├── CLAUDE.md
├── README.md
├── DEMO.md           # 5-minute demo script
├── .gitignore
├── docs/plan/        # PRD, questions, prompts
├── docs/external-services.md  # ElevenLabs + Timefold accounts, keys, licence (outside the repo)
├── docs/maintaining.md        # checks, regeneration, toolchain traps (human-facing)
├── docs/screenshots/ # gallery + README
├── data-gen/         # Python generator (stdlib only, seeded) -> data-gen/out/*.json
├── model/            # Timefold Solver + Quarkus REST service (copied from quickstarts employee-scheduling)
├── ui/               # Vite + React + TypeScript dashboard
│   └── src/tour/     # guided "Play demo" tour (steps.ts, runs.ts, narrate.ts, useTour.ts, fixtures/)
└── mcp/              # Python MCP server (streamable HTTP) wrapping the model's REST API
```

## Ports

| Service | Port | Notes |
|---|---|---|
| model (Quarkus) | 8083 | `mvn quarkus:dev` |
| ui (Vite) | 5173 | proxies `/api` → `http://localhost:8083` |
| mcp (MCP SDK v2 MCPServer) | 8765 | streamable HTTP at `/mcp` |

## Core modeling decisions (short version)

- **Single planning entity:** `Task.employee` (nullable, `allowsUnassigned = true`, `@PlanningPin` supported).
  A shift is *derived*: an employee works a day if they have ≥ 1 task that day. No separate shift entity.
- **Score:** Hard / Medium / Soft (long-based). Medium = 1 per unassigned task.
- **Health constraint added** (soft): penalize consecutive-day runs of 3+ (including days worked before the week).
  The penalty is `(L − 2) × 480` per run of L ≥ 3 days **plus `AT_RISK_PERSON_PENALTY = 2400` once per at-risk employee**.
  The per-person flat charge drives the solver to make people fully healthy, not just shorten their runs slightly.
- **Weight presets** via `ConstraintWeightOverrides`: `health-first`, `balanced` (PRD equal weights), `cost-first`.
  Hard and medium constraints are identical in every preset.
- **KPIs are computed after solving** in plain Java (`KpiCalculator`), not as shadow variables.
- **Money is stored in JPY.** The UI converts to USD and GBP with fixed mock FX rates (1 USD = 150 JPY, 1 GBP = 195 JPY).
- **Score-analysis fallback:** Timefold 2.7 Community edition does not return per-match counts; broken-constraint
  `matchCount` is `null` and the UI shows "–". Enterprise edition fills in exact counts.
- **Scenarios retuned:** `normal` targets ~50% load, `burnout` ~55% with ~30% of staff carrying in 2–5 days.
  Original spec (65% / 85%) produced identical at-risk counts under both presets. Generator is seeded; exact counts
  are printed at runtime and documented in `README.md → Scenarios`.

## Conventions

- JSON is camelCase. Dates are ISO `yyyy-MM-dd`, times `HH:mm`, date-times `yyyy-MM-ddTHH:mm:ss` (local, Asia/Tokyo assumed, no zone).
- Durations are integer minutes. Money is integer JPY.
- IDs: employees `E-001`, tasks `T-0001`.
- Python: 3.11+, use `uv` if available, otherwise `python3 -m venv`.
- Every service must start with one `make` target from the project root.

## Cut order if time runs short

1. Longevity view → 2. Hours-rather-not-work → 3. Pinning → 4. Profit metrics.

## Working rules learned (from the build)

Human-facing version with commands: `docs/maintaining.md` (toolchain traps, ports, regenerating fixtures and
screenshots via `scripts/capture-gallery.py`). Keep the two in step.

- **UI agents: use a git worktree**, never work directly in the folder the live demo runs from. Symlink conflicts and
  hot-reload interference cause hard-to-diagnose failures.
- **Stage explicit paths:** `ui/node_modules` may be a symlink in a worktree. Always `git add ui/src/...` rather than
  `git add -A` or `git add .` to avoid accidentally staging the symlink.
- **Before merging any UI change**: run `npm test && npx tsc --noEmit && npm run build` in `ui/`, then do a quick
  browser smoke-check at 1280 px and 390 px (especially the tour overlay and the replay bar).
- **Tour fixtures are in `ui/src/tour/fixtures/`**: regenerate with `node ui/scripts/record-tour-fixtures.mjs`
  (model must be running). Commit the updated fixtures alongside the UI change.
- **Visual changes go in `ui/src/theme.css`** (loaded last, overrides only) using the tokens in
  `design-system/MASTER.md`; no hex values in components. Markup changes belong to the component.
- **Automated browser checks must stub `speechSynthesis`**: headless Chrome on macOS speaks through the real speakers.
