# Work-Life Balancer screenshot gallery

Real captures from a running `make demo` (model + UI + MCP), solving the synthetic scenarios with a 10-second
time limit. Numbers come from live solver runs, so a fresh run may differ slightly.

[← Back to the main README](../../README.md)

## 1. CLI and REST

Everything starts from one `make` target; the solver can also be driven directly over REST.

### `make help` — every service has one target

![Output of make help listing setup, data, model, ui, mcp, demo, test and clean targets](01-cli/01-make-help.png)

### Solve `burnout` with `health-first` over REST and read the KPIs

![JSON result from the REST API showing a 0hard score, 22 at-risk employees and a 56% healthy share](01-cli/02-rest-solve-kpis.png)

---

## 2. Dashboard

The main flow: pick a scenario and preset, solve, then compare the cheap plan with the healthy plan.

### Landing — pick a scenario and click Solve

![Empty dashboard with the top bar: scenario, preset, time limit, Solve, currency and role](02-dashboard/01-landing.png)

### `burnout` week, `cost-first` — the cheapest plan

![Dashboard after a cost-first solve: KPI cards, longevity view and a week grid with many red at-risk cells](02-dashboard/02-burnout-cost-first.png)

### `burnout` week, `health-first` — the same week, protecting people

![Dashboard after a health-first solve: fewer at-risk employees and more green cells in the week grid](02-dashboard/03-burnout-health-first.png)

### Compare runs — what health protection costs

![Compare panel: health-first protects 7 more people than cost-first for about 99,600 yen more labor cost](02-dashboard/04-compare-runs.png)

### Solver replay — how the plan improved step by step

![Solver replay bar with play button, step slider and 1x/2x/4x speed buttons](02-dashboard/05-solver-replay.png)

---

## 3. Details

Drill-downs: what each number means, one person's week, longevity data and an over-capacity week.

### KPI explainer — plain-language meaning of each card

![A KPI card with its information note open, explaining what the metric measures](03-details/06-kpi-explainer.png)

### Employee panel — one person's tasks, hours and risk

![Side panel for one employee: hours, consecutive days at risk, cost, profit and assigned tasks](03-details/07-employee-panel.png)

### Longevity view as HR, in GBP

![Longevity view with per-employee tenure and absences visible to the HR role, money shown in pounds](03-details/08-longevity-hr-gbp.png)

### `overloaded` week — broken constraints, still 0 hard

![Broken constraints panel for the overloaded scenario: 0 hard, 143 unassigned tasks as medium penalties](03-details/09-overloaded-broken-constraints.png)

---

## 4. Themes and mobile

### Dark theme

![Dashboard in dark theme with KPIs shown in GBP](04-themes-and-mobile/10-dark-theme.png)

### Phone width (390 px)

![Dashboard at 390 px wide: controls stack vertically and KPI cards wrap](04-themes-and-mobile/11-mobile-390.png)

---

## 5. Guided tour

The **▶ Play demo** button runs a hands-free, narrated 19-step story.

### Tour start

![First step of the guided tour overlay](05-tour/12-tour-intro.png)

### Tour step — "Plan 1: the cheapest week", solving live

![Tour step 2 of 19 spotlighting the KPI cards while the solver runs cost-first](05-tour/13-tour-step.png)

---

### How these were made

UI shots: headless Chromium via Python Playwright at 1440×900 (and 390×844), device scale 2, with
`speechSynthesis` stubbed and `/tts` blocked so nothing plays aloud. CLI shots: real command output rendered
with [`freeze`](https://github.com/charmbracelet/freeze).
