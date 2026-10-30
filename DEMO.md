# DEMO.md — 5-Minute Demo Script

Hack for Humanity London 2026-10-29
**Total: ~5 minutes**

---

## Before you start

Everything should already be running (`make demo` from the project root, or three separate terminals: `make model`, `make ui`, `make mcp`).

Have open: **http://localhost:5173** in Chrome or Firefox.

Services at a glance: UI on :5173, model REST API on :8083, MCP server on :8765.

**Five-minute pre-flight** (do this before the audience arrives):

- [ ] The UI really is on 5173: `grep -m1 Local: .logs/ui.log`. If it says 5174, an old Vite is still running;
      see [maintaining.md → Ports](docs/maintaining.md#ports-and-stale-processes).
- [ ] Voice: `.logs/ui.log` shows `apiKey=present`, and `curl -s localhost:5173/tts` shows the voice you expect.
      No key is fine; the tour falls back to the browser voice ([setup](docs/external-services.md#elevenlabs-premium-tour-voice)).
- [ ] Play the tour once end to end. The fixed lines are then cached in `ui/.tts-cache/`, so the live run starts
      instantly and uses little quota. Lines that read live numbers ("Right now: 22 people at risk…") change with
      every solve, so they still go to ElevenLabs.
- [ ] Sound on, the correct output device chosen, and the browser tab not muted.

---

## Step 0 — Guided tour option (about 3–4 min, replaces Steps 2–4)

If you prefer a fully hands-free run, click **▶ Play demo** in the top bar.
The tour walks through all 6 story beats automatically (19 steps): it solves `burnout` cost-first then health-first
(live, 10-second limit) and `overloaded`, narrates each result, and ends on the longevity view.
It falls back to recorded results if the model is unreachable.
Use **Space** to pause, **← →** to step back or forward, **Esc** to exit.

Skip to **Step 5 (MCP)** after the tour exits, as the compare panel will already be populated.

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
   - **At-risk count** (KPI card, Health group): `34` employees in a 3+ consecutive-day run.
   - **Average consecutive days**: `3.8`.
   - **Company profit**: `¥2,042,000` JPY
     (switch currency to GBP → `£10,470`).
   - **Week grid**: point out the red and amber cells — those are employees at risk.
6. Click **Keep this run for comparison**.

> *"With cost-first, the solver minimises labor cost and ignores consecutive-day health risk. You can see 34 people in the red or amber zone. The company earns £10,470 profit this week."*

---

## Step 3 — Same week, health-first (60 s)

1. **Preset dropdown** → `health-first`.
2. Click **Solve**. Same scenario, different priority.
3. When done, look at the **compare panel** (it appeared because you kept the previous run):

   | KPI | cost-first | health-first | delta |
   |---|---|---|---|
   | At-risk employees | `34` | `20` | `14` fewer |
   | Avg consecutive days | `3.8` | `3.4` | |
   | Labor cost (GBP) | `£10,640` | `£10,800` | +£160 |
   | Company profit (GBP) | `£10,470` | `£10,670` | +£200 |
   | Idle hours | `496` | `594` | |

4. Point to the **broken constraints panel** — both runs show `0 hard`. No rule was ever broken.
5. Scroll down to the **Solver replay bar**. Click **▶ Play** (or scrub the slider) to watch the solver
   improve the plan from its first guess to the final result. Switch speed to **4×** to make it snappy.
   Point out how the score improves with each step and how the week grid changes colour in real time.

> *"Health-first uses a 10× penalty weight on consecutive-day runs. We go from 34 at-risk employees down to 20 — 14 fewer people risking burnout. The extra health protection costs £160 more in labor this week — about 1.5%. Profit even came out £200 higher in this run, because the people it picked happen to bill at higher rates, so here health didn't cost us profit at all. An HR director can now put an exact labor-cost figure in front of a board.*
>
> *And with the replay bar, you can see exactly how the solver got there — every improvement step, slowed down enough to explain."*

---

## Step 4 — Overloaded week: never overwork to cover tasks (45 s)

1. **Scenario dropdown** → `overloaded`.
2. **Preset** → `health-first`. Click **Solve**.
3. When done, point to:
   - **Unassigned tasks**: `131` tasks.
   - **Unassigned tasks table**: scroll the table and read out two or three reasons — "All eligible employees are at their limits or busy".
   - **Broken constraints**: still `0 hard`.

> *"This week has 25% more work than the team can cover. The solver leaves 131 tasks unassigned rather than exceeding a single hour limit. The reasons are listed explicitly — a manager can either redistribute work, hire temporary staff, or push tasks to next week. The plan is never made feasible by sacrificing someone's health."*

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
3. Point to average tenure (`11.5` years), total unplanned absences in 3 months
   (`90`), and retention rates (year 1: 88%, year 3: 74%, year 5: 63%).

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
