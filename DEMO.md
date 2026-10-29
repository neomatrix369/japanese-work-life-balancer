# DEMO.md — 5-Minute Demo Script

Hack for Humanity London 2026-10-29
**Total: ~5 minutes**

---

## Before you start

Everything should already be running (`make demo` from the project root, or three separate terminals: `make model`, `make ui`, `make mcp`).

Have open: **http://localhost:5173** in Chrome or Firefox.

Services at a glance: UI on :5173, model REST API on :8083, MCP server on :8765.

---

## Step 1 — The problem (45 s)

> *"Every year, hundreds of people in Japan die from karoshi — overwork. The same pattern is quietly growing in London: care workers, hospitality staff, and employees at Japanese firms' London offices routinely work consecutive days without enough rest.*
>
> *This tool gives a manager a weekly work plan that is mathematically guaranteed to respect every employee's health limits — daily hours, weekly hours, minimum rest between shifts, approved holidays — while still covering as many tasks as possible. And it can show you, in pounds and pence, exactly what that protection costs."*

No clicks needed here. Just talk.

---

## Step 2 — The burnout week, cost-first (60 s)

1. **Scenario dropdown** → select `burnout`.
2. **Preset dropdown** → select `cost-first`.
3. **Time limit** → `30s`.
4. Click **Solve**. Watch the score update in the status bar.
5. After solving finishes, point to:
   - **At-risk count** (KPI card, Health group): `{{NUMBER: at-risk employee count, cost-first}}` employees in a 3+ consecutive-day run.
   - **Average consecutive days**: `{{NUMBER: avg consecutive days, cost-first}}`.
   - **Company profit**: `{{NUMBER: company profit JPY, cost-first}}` JPY
     (switch currency to GBP → `{{NUMBER: company profit GBP, cost-first}}`).
   - **Week grid**: point out the red and amber cells — those are employees at risk.
6. Click **Keep this run for comparison**.

> *"With cost-first, the solver minimises labor cost and ignores consecutive-day health risk. You can see {{NUMBER: at-risk employee count, cost-first}} people in the red or amber zone. The company earns {{NUMBER: company profit GBP, cost-first}} profit this week."*

---

## Step 3 — Same week, health-first (60 s)

1. **Preset dropdown** → `health-first`.
2. Click **Solve**. Same scenario, different priority.
3. When done, look at the **compare panel** (it appeared because you kept the previous run):

   | KPI | cost-first | health-first | delta |
   |---|---|---|---|
   | At-risk employees | `{{NUMBER: at-risk, cost-first}}` | `{{NUMBER: at-risk, health-first}}` | `{{NUMBER: at-risk delta}}` fewer |
   | Avg consecutive days | `{{NUMBER: avg days, cost-first}}` | `{{NUMBER: avg days, health-first}}` | |
   | Company profit (GBP) | `{{NUMBER: profit GBP, cost-first}}` | `{{NUMBER: profit GBP, health-first}}` | `{{NUMBER: profit delta GBP}}` |
   | Idle hours | `{{NUMBER: idle hours, cost-first}}` | `{{NUMBER: idle hours, health-first}}` | |

4. Point to the **broken constraints panel** — both runs show `0 hard`. No rule was ever broken.
5. Scroll down to the **Solver replay bar**. Click **▶ Play** (or scrub the slider) to watch the solver
   improve the plan from its first guess to the final result. Switch speed to **4×** to make it snappy.
   Point out how the score improves with each step and how the week grid changes colour in real time.

> *"Health-first uses a 10× penalty weight on consecutive-day runs. We go from {{NUMBER: at-risk, cost-first}} at-risk employees down to {{NUMBER: at-risk, health-first}}. That protection costs us {{NUMBER: profit delta GBP}} in profit this week — a number every HR director should be able to put in front of a board.*
>
> *And with the replay bar, you can see exactly how the solver got there — every improvement step, slowed down enough to explain."*

---

## Step 4 — Overloaded week: never overwork to cover tasks (45 s)

1. **Scenario dropdown** → `overloaded`.
2. **Preset** → `health-first`. Click **Solve**.
3. When done, point to:
   - **Unassigned tasks**: `{{NUMBER: unassigned count, overloaded}}` tasks.
   - **Unassigned tasks table**: scroll the table and read out two or three reasons — "No employee has all of: …", "All eligible employees are at their limits".
   - **Broken constraints**: still `0 hard`.

> *"This week has 25% more work than the team can cover. The solver leaves {{NUMBER: unassigned count, overloaded}} tasks unassigned rather than exceeding a single hour limit. The reasons are listed explicitly — a manager can either redistribute work, hire temporary staff, or push tasks to next week. The plan is never made feasible by sacrificing someone's health."*

---

## Step 5 — Claude via MCP (45 s)

In a terminal (the MCP server should already be running):

```
# (already done at setup time)
# claude mcp add --transport http jwlb http://localhost:8765/mcp
```

Open Claude Code or claude.ai with the MCP server connected. Type:

```
Compare cost-first and health-first for the burnout week and tell me
what health protection costs in GBP.
```

Claude calls `compare_presets("burnout", presets=["cost-first", "health-first"])` and returns a table.

Point to the output — the same numbers, now in natural language.

> *"A manager who isn't comfortable reading a scheduling dashboard can just ask. Claude drives the solver through the MCP server, reads the plan, and explains the health–cost trade-off in plain English."*

---

## Step 6 — Longevity view (25 s)

1. Back in the browser, switch **Role** → `HR`.
2. Scroll to the **Longevity view** panel.
3. Point to average tenure (`{{NUMBER: avg tenure years}}` years), total unplanned absences in 3 months
   (`{{NUMBER: total unplanned absences}}`), and retention rates (year 1: 88%, year 3: 74%, year 5: 63%).

> *"This week's plan is the short-term lever. The long-term question is: are people staying? Are absences trending up? HR and executives see these numbers next to the weekly plan. The connection between this week's schedule and whether someone is still here in three years is made explicit."*

---

## Wrap-up (10 s)

> *"Zero hard violations — always. The cost of health, visible in the compare panel. Unassigned tasks with reasons instead of silent overwork. And an MCP interface so any AI agent can run a scenario and explain the trade-offs to a manager who just wants a plain-English answer."*

---

## Recovery notes

- **Model not responding?** Check the Quarkus terminal. Restart with `make model` and wait for "Started in …".
- **Score stuck at `INIT`?** The solve is still running. Wait for the spinner to stop or increase the time limit.
- **Compare panel not showing?** You need to have clicked "Keep this run" after the first solve.
- **MCP call fails?** Confirm the model is on :8083: `curl -s localhost:8083/demo-data`.
  Confirm the MCP server is on :8765: `curl -s localhost:8765/mcp` (should return a 200 or a method-not-allowed, not a connection refused).
