# Overwork-Preventing Scheduling — Clarifying Questions

**Project:** Hack for Humanity London (Timefold, Option B: custom model)
**PRD:** #PRD-36845F — Overwork-preventing work scheduling
**Date:** 2026-10-29
**Project root:** `/Users/swami/git-repos/ai-ml-dl-stuff/hackathons/hack-for-humanity-london-2026/japanese-work-life-balancer/`
**Existing contents:** `docs/plan/Work Scheduling PRD.md` (same PRD as #PRD-36845F)

Each question has a **suggested default** in brackets. Reply with "defaults except 3, 7, 12" to save time.

## Answers (2026-10-29)

All defaults accepted, except:
- **2:** separate Python FastMCP server calling the REST API.
- **3:** streamable HTTP (not stdio).
- **4:** `timefold-prd` MCP not connected yet; optional only.
- **15:** JPY as the base currency; UI also shows USD and GBP (mock FX rates).
- **16:** Python generator.
- **24:** copy the employee-scheduling quickstart (clone from https://github.com/TimefoldAI/timefold-quickstarts.git if needed).
- **24b:** PRD renamed to `work-scheduling-prd.md` (done).
- **26:** all tools installed.
- **27:** quickstarts `stable` branch.
- **29:** `CLAUDE.md` + one big prompt (`claude-code-prompt.md`) + short phased kickoff prompt (`kickoff-prompt.md`).
- **30:** no Graphiti saves in the Claude Code prompt.

> Time note: the planned build window is 3 hours. Several defaults below are chosen to fit inside it.

---

## A. Overall shape and the MCP server

**1. What does "our own MCP server" mean here?**
- (a) The solver is exposed as MCP tools, such as `solve_schedule`, `get_plan` and `explain_score`, so Claude or another agent can drive it.
- (b) The `timefold-prd` MCP server from the slides, used during development.
- (c) Both.

[Default: (a). The model is a Quarkus REST service as the PRD says, and a thin MCP layer sits on top of it.]

**2. If (a), how should the MCP layer be built?**
- Inside the Java app, using the Quarkus MCP server extension, so there's one process.
- As a separate small Python FastMCP or TypeScript server that calls the REST API.

[Default: a separate Python FastMCP wrapper. It's faster to write, and the solver stays a pure quickstart fork.]

**3. Which MCP transport: stdio (Claude Desktop / Claude Code) or streamable HTTP?**
[Default: stdio, plus an HTTP flag if it's cheap.]

**4. Is the `timefold-prd` MCP server connected in Claude Code?** If so, should the prompt tell Claude Code to use it for generating or validating constraints?
[Default: mention it as optional, but don't depend on it.]

---

## B. Modeling simplifications (the biggest time-saver)

**5. Single planning entity?**
The PRD has two decisions: who works each shift, and who does each task. Proposal: make only Task → Employee the planning variable. An employee "works the shift that day" if they have at least one task that day, which is derived rather than planned. This removes the two-level problem entirely, and every hard rule still holds.
[Default: yes.]

**6. Which quickstart to start from?**
- Employee-scheduling: closest UI, closest domain, and the slide recommendation.
- Task-assigning: supports unassigned items, but chains tasks in time, which isn't needed here.

[Default: employee-scheduling. Rename Shift → Task, add `allowsUnassigned = true`, use a HardMediumSoft score.]

**7. Health is currently "report only."**
The PRD says health comes before cost, yet nothing in the score protects it beyond the hard limits. Judges give 30% for modeling and want "a trade-off you can explain." Add a soft (or weighted) constraint penalizing consecutive-day runs of 3+ (or 4+)?
[Default: yes, as a soft constraint with a higher weight — unless you'd rather keep it strictly as the PRD says.]

**8. Minimum rest only matters when it's over 16 hours** (fixed 09:00–17:00 shift). Implement it anyway, or skip and mention it in the demo?
[Default: implement it. It's about 10 lines.]

**9. Idle hours on a worked day = available hours that day − task hours?** Non-worked days count as 0.
[Default: yes.]

**10. "Hours rather not work"** given as per-day time ranges, with the penalty being the overlap in minutes?
[Default: yes.]

**11. Pinning in v1?**
[Default: support the `pinned` flag on tasks (almost free in Timefold), but no UI for it.]

**12. "Cost-first vs Health-first" toggle in the UI** that switches constraint weights for the demo? A strong 5-minute story.
[Default: yes, as two presets using ConstraintWeightOverrides.]

**13. Async solve with polling** (as in the quickstart), 30-second termination limit?
[Default: yes, plus a 10-second "demo" limit.]

---

## C. Community impact (judging)

**14. Framing.** The folder name `japanese-work-life-balancer` suggests the Japanese framing is settled. The rules still require "help people locally" in London, and community impact is worth 30%. How should the demo connect it to London?
- Keep it purely Japanese.
- Keep the Japanese model and data, but open the pitch with a London angle (for example, Japanese firms' London offices, or the same overwork pattern in London care and hospitality staff).

[Default: Japanese model and data, with a one-slide London bridge in the pitch.]

**15. Currency and locale?**
[Default: JPY, Japanese public holidays (pick a week containing one, e.g. Culture Day on 3 Nov 2026), Japanese-style fictional names.]

---

## D. Synthetic data

**16. Generator language: Python or Java?**
[Default: Python, outputting JSON files with a fixed seed for reproducible runs.]

**17. Which scenarios?**
- Normal week
- Overloaded week (more task hours than capacity, so unassigned tasks show up)
- Holiday week (a public holiday plus several approved holidays)
- "Burnout risk" week (many employees arriving with 2–4 days already worked in a row)

[Default: all four at 50 employees / 500 tasks, plus a tiny 8-employee / 40-task version for debugging.]

**18. Skill distribution?**
[Default: ~8 skills. Employees have 1–4 skills; tasks need 1–2.]

**19. Names** — obviously fictional, as rule 6 requires?
[Default: generated from a fixed name list, with an `E-001` style ID next to each name.]

**20. Rate ranges?**
[Default: hourly rate ¥1,500–3,500; billing rate 1.5–2.5× the hourly rate.]

---

## E. UI

**21. UI stack?**
[Default: Vite + React + a simple chart library in `/ui`, calling the model's REST API through a dev proxy. Alternative: the quickstart's built-in vanilla JS UI — faster, but it stays inside the model folder.]

**22. Which views?**
[Default:
- Scenario picker with a Solve button
- KPI cards row, health metrics next to profit metrics
- Employee × day grid colored by consecutive-day risk
- Unassigned tasks list with reasons
- "Broken constraints" panel from score analysis]

**23. Longevity view access** (PRD: HR and executives only) — mock with a role dropdown, no auth?
[Default: yes.]

---

## F. Repo, tooling and run

**24. Copy, not fork.** The project folder already lives inside the `ai-ml-dl-stuff` git repo, so a GitHub fork or a nested `git init` would clash. Copy only `use-cases/employee-scheduling` from the quickstarts into `model/`, with an Apache-2.0 attribution note in `model/README.md`. Is committing everything into `ai-ml-dl-stuff` fine?
[Default: yes. Add a `.gitignore` at the project root for `target/`, `node_modules/`, `.venv/`, `data-gen/out/` and `timefold-license.pem`.]

**24b. PRD filename has spaces** (`Work Scheduling PRD.md`). Rename it to `work-scheduling-prd.md` so scripts and prompts don't need quoting?
[Default: yes, rename it.]

**25. Root-level start mechanism:** `Makefile`, `start.sh`, or docker-compose?
[Default: a `Makefile` with `make data`, `make model`, `make ui`, `make mcp`, `make demo`. No Docker — Quarkus dev mode is faster.]

**26. Environment check:** macOS is confirmed from the path. Are JDK 21+, Maven, Node 20+ and Python 3.11+ (or `uv`) installed? Is `timefold-license.pem` in `~`?

**27. Timefold Solver version?**
[Default: whatever the quickstart's `stable` branch pins.]

**28. Tests?**
[Default: a handful of ConstraintVerifier tests for the hard constraints only.]

---

## G. The final prompt

**29. One big prompt, or `CLAUDE.md` + a short kickoff prompt** split into phases (model → data → UI → MCP) with a checkpoint after each?
[Default: `CLAUDE.md` at the project root that points at the PRD in `docs/plan/`, plus `docs/plan/claude-code-prompt.md` as the kickoff prompt, run from the project root. Phased checkpoints, so there's something to demo even if only phase 2 is finished.]

**30. Graphiti memory saves** at each phase checkpoint in the Claude Code prompt?
[Default: yes.]

**31. What can be cut if time runs short?**
[Suggested cut order: longevity view → hours-rather-not-work → pinning → profit metrics.]

---

## Proposed layout (inside the existing folder)

```
japanese-work-life-balancer/
├── Makefile                 # make data | model | ui | mcp | demo
├── README.md
├── CLAUDE.md                # project rules for Claude Code
├── .gitignore
├── docs/
│   └── plan/
│       ├── work-scheduling-prd.md      # existing PRD (renamed, see 24b)
│       ├── clarifying-questions.md     # this file
│       └── claude-code-prompt.md       # final kickoff prompt
├── data-gen/                # Python synthetic data generator (seeded)
│   └── out/                 # normal.json, overloaded.json, holiday.json, burnout.json, tiny.json
├── model/                   # Timefold Quarkus service (copied from employee-scheduling)
├── mcp/                     # Python FastMCP wrapper over the REST API
└── ui/                      # Vite + React dashboard
```
