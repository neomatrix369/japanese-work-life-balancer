# Kickoff Prompt — Japanese Work-Life Balancer

> **Implementation status (as of 2026-10-29, commit fac062c):** All phases complete. Model on :8083, UI on :5173,
> MCP on :8765. Key deviations from the original spec are documented in `docs/plan/claude-code-prompt.md` and in
> `README.md → What is mocked or simplified`. Start with `make demo` for a running system.

Run Claude Code from the project root:

```bash
cd /Users/swami/git-repos/ai-ml-dl-stuff/hackathons/hack-for-humanity-london-2026/japanese-work-life-balancer
claude
```

Paste **Prompt 0** once. After each checkpoint, review the results and paste the next prompt (or just say "continue").

---

## Models and effort per phase

Switch with `/model` and `/effort <level>` inside a session, or at launch: `claude --model opus --effort high`.
Check `/model` for exactly what your plan offers.

| Phase | Model | Effort | Why |
|---|---|---|---|
| 0 Setup + 1 Model | Opus 5.5 (`opus`) | high | Hardest part: Timefold APIs, constraint streams, score types. Must run tests and verify. |
| 2 Data | Sonnet 5.5 (`sonnet`) | default | Well-specified Python; needs a few tune-and-rerun loops. |
| 3 UI | Sonnet 5.5 | default (high if it skips checks) | Routine React work against a fixed API. |
| 4 MCP | Sonnet 5.5 | default | Small, well-specified wrapper. |
| 5 Root/docs | Sonnet 5.5 | default | Makefile, README, DEMO.md. |
| Stuck anywhere | Fable 5.1 (if your plan has it) | default | Only when Opus has full context and is still wrong (e.g. infeasible plans, solver bugs). Costs the most. |

Rule of thumb: if Claude skipped a file or didn't run the tests → raise effort. If it tried properly and is still wrong → bigger model.

Start a **fresh session per phase** (`/clear` or a new `claude`). Everything it needs is in `CLAUDE.md` and the spec,
so a clean context is cheaper and less confused than one long session.

To avoid approving every command, allow the routine ones once via `/permissions` (e.g. `mvn`, `npm`, `python3`, `uv`,
`curl`, `make`) and use auto-accept edits (Shift+Tab) when you're running several phases unattended.

---

## Ways to run the phases

### A. One phase at a time (recommended)
Prompt 0, then Prompts 1–5 below, one per checkpoint. Best control, easiest to recover.

### B. A couple of phases together
Good pairs: **0+1** (setup + model), **2+3** (data + UI), **4+5** (MCP + docs).

```
Read CLAUDE.md and docs/plan/claude-code-prompt.md. Do Phase 2 and Phase 3 back to back.
Run Checkpoint 2 yourself and fix any failures without stopping; stop only after Checkpoint 3
and report the results of both checkpoints.
```

### C. All phases in one go
Only once you trust the setup (e.g. after Phase 1 passed). Use Opus 5.5, effort high.

```
Read CLAUDE.md, docs/plan/work-scheduling-prd.md and docs/plan/claude-code-prompt.md.
Execute all remaining phases in order without waiting for me. After each phase, run its checkpoint;
if it fails, fix it before moving on (max 3 attempts, then note it and continue).
Apply the cut order in CLAUDE.md if something blocks progress for more than ~20 minutes.
At the end, give me one report: checkpoint results per phase, what was cut or mocked, and the demo numbers.
```

### D. Parallel (fastest, after Phase 1 is done)
Once the model's REST API works, Phases 2, 3 and 4 touch different folders and can run in three terminals at once:
- Terminal 1: Prompt 2 (data-gen/)
- Terminal 2: Prompt 3 (ui/) — tell it to use `model/src/test/resources/tiny.json` until the data exists
- Terminal 3: Prompt 4 (mcp/)

Tell each session to edit only its own folder and **not touch the Makefile** (three sessions editing one file will clash).
Then run Prompt 5 last, which wires all the Makefile targets.

---

## Prompt 0 — Start (paste this first)

```
Read CLAUDE.md, docs/plan/work-scheduling-prd.md and docs/plan/claude-code-prompt.md.
The build spec (claude-code-prompt.md) is the source of truth; it overrides the PRD where they differ.

We are building in phases: Phase 0 setup → Phase 1 model → Phase 2 data → Phase 3 UI → Phase 4 MCP → Phase 5 root/docs/demo.
Rules:
- Keep it as simple as possible. Mock what slows us down and mark it with MOCK: comments.
- Do one phase at a time. At the end of each phase, run its checkpoint checks, show me the results
  (commands run, scores, KPIs, anything mocked or skipped), then STOP and wait for me to say "continue".
- If a Timefold API differs from what the spec says, check https://docs.timefold.ai/llms.txt and adapt; tell me what changed.
- Never commit or copy timefold-license.pem.

Before writing any code, give me a short plan for Phase 0 and Phase 1 (max 15 lines) and list any spec
points you think are wrong or risky. Then start Phase 0.
```

---

## Prompt 1 — Model

```
Continue with Phase 1 (model) from docs/plan/claude-code-prompt.md.
Order: domain → constraints (hard, then medium, then soft) → presets → KpiCalculator + UnassignedReasoner → REST → tests.
Use src/test/resources/tiny.json (hand-written, 8 employees, ~40 tasks) for tests until Phase 2 exists.
Run Checkpoint 1 and stop.
```

## Prompt 2 — Data

```
Continue with Phase 2 (synthetic data). Write data-gen/generate.py (stdlib only, seeded) and the `make data` target.
Print the per-scenario summary, then run Checkpoint 2 against the running model and stop.
If normal.json has unassigned tasks or overloaded.json has none, tune the generator before reporting.
```

## Prompt 3 — UI

```
Continue with Phase 3 (UI) in ui/ with Vite + React + TypeScript + Recharts, proxying /api to localhost:8083.
Build the panels in this order: top bar + status → KPI cards → week grid → compare runs → unassigned → broken constraints
→ hours chart → longevity view. Run Checkpoint 3 and stop.
```

## Prompt 4 — MCP

```
Continue with Phase 4 (MCP server) in mcp/: Python FastMCP, streamable HTTP on port 8765 at /mcp, calling the model over REST.
Implement the tools in the spec with clear docstrings and compact outputs. Add mcp/smoke_test.py.
Run Checkpoint 4 and stop. Print the `claude mcp add` command.
```

## Prompt 5 — Root, docs and demo

```
Continue with Phase 5: finish the Makefile and scripts/dev.sh, write README.md (with a Mermaid architecture diagram,
constraints and presets table, penalty units, what is mocked) and DEMO.md (5-minute script).
Run Checkpoint 5 from a fresh shell and give me the exact numbers to quote in the demo.
```

---

## If time runs short

```
We're short on time. Cut in this order until we're on track: longevity view → avoided hours → pinning → profit metrics.
Tell me what you cut and make sure `make demo` still works end to end.
```

## If the solver can't reach 0hard in 30 s

```
The plan isn't feasible within the time limit. Diagnose with /schedules/analyze, then try in order:
1) add an entity-dependent value range on Task (only employees with all required skills who are available that day),
2) check the generator isn't creating impossible tasks, 3) raise the limit to 60 s for the 500-task scenarios.
Report what fixed it.
```

## Register the MCP server in Claude Code (after Phase 4)

```bash
claude mcp add --transport http jwlb http://localhost:8765/mcp
```
