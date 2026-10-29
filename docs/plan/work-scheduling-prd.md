# Overwork-preventing work scheduling
Reference: #PRD-36845F
Status: Ready for build (2026-10-29)

## Problem summary

Managers, HR staff and executives in Japanese companies want an AI-assisted weekly plan that prevents overwork. The plan fills fixed-time shifts with suitable employees and assigns tasks with set start times to employees who hold all the required skills.

- **Planning horizon:** 1 week of 7 days.
- **Shift:** 1 shift per day, 09:00 to 17:00. No shift on public holidays.
- **Size:** about 50 employees and about 500 tasks.
- **Employee limits:** each employee has their own daily hour limit, weekly hour limit, minimum rest, availability, approved holidays, hourly rate and requests for days off or hours they would rather not work.
- **Aim:** prevent overwork and support long-term employee health while keeping labor cost low. Labor cost is each employee's own hourly rate times task hours only.
- **Users:** managers, team leaders, HR staff and executives. Employee self-service (viewing schedules, submitting availability and preferences) is out of scope for this build.
- **Principle:** employee health and safety come before labor cost and profit. The company accepts lower profit in exchange for a healthier workforce. The health and profit metrics are reported side by side so this trade-off stays visible. The long-term aim is longevity: employees stay with the company for many years instead of falling ill, coming in less often or retiring early.

## Planning entities and decisions

- **Shifts (planned):** run 09:00 to 17:00 daily and need to be filled with suitable, rested employees. Decision: which employees work each day's shift.
- **Tasks (planned):** have set start times and need employees holding all required skills. Decision: which employee does each task. The plan does not decide when a task happens.

## Decision options and value ranges (per-entity restrictions)

- **Tasks:** an employee is an option for a task only if they hold all of the task's required skills. A task can need several skills at once.
- **Tasks:** the employee must also be available and working the shift on the day and hours of the task.
- **Shifts:** an employee is an option for a day's shift only if they are available on that day. Some employees only work certain days, some start later or leave earlier, and some work fewer hours per week.
- **Task assignment:** a task may be left unassigned when resources run out (see Medium constraints).
- **Shift filling:** options are restricted per employee by availability, daily hour limit and minimum rest.

## Sequencing / ordering (is order significant?)

No. Every task has a set start time, so the plan decides only who does each task, not when or in what order. This is an assignment problem, not a sequencing problem. Any overlap between an employee's tasks follows from the set start times and is checked by constraints.

## Problem facts (fixed input data)

- **Employees (resource):** the roughly 50 people who can be assigned to shifts and tasks.
- **Employee profiles (resource):** one per employee, holding:
  - skills (a plain list, no experience levels)
  - hourly rate (each employee has their own)
  - hourly billing rate: what the company earns per task hour this employee works (each employee has their own, reflecting their skills)
  - maximum hours per day (differs per employee)
  - minimum rest between two shifts, in hours (differs per employee)
  - availability: the days they can work, and the hours they can work if they start later or leave earlier
  - weekly hours limit (some work fewer hours per week)
  - work preferences: days they would like off, and hours they would rather not work (set per day)
  - days already worked in a row just before the planning week
  - approved holidays that fall in the planning week
  - holiday days remaining before the planning week
  - tenure: years at the company
  - unplanned absence days in the last 3 months (a count only, with no reason recorded)
- **Shift definition:** 1 shift per day, 09:00 to 17:00, over the planning week.
- **Public holidays:** company-wide closed days in the planning week (for example Japanese national holidays). No shift runs on them.
- **Company retention rate:** the share of staff still employed after 1, 3 and 5 years. Company-level only, with no per-person data. Supplied by HR.
- **Tasks:** each has a set start time, a duration (30 minutes to 8 hours, in 15-minute steps), and a list of required skills (1 or more).

Health, family and age details are not part of the input. They reach the plan only as the resulting per-employee limits, such as the daily hour limit and the availability. This limits the sensitive data the model holds.

## Derived / calculated values (shadow variables)

- Hours worked per employee per day (sum of the durations of the tasks assigned to them that day).
- Rest hours between an employee's consecutive shifts.
- Idle hours per employee (hours on shift that are not spent on tasks, counted against the employee's own available hours that day).
- Labor cost per employee and total labor cost for the week (hourly rate times task hours only).
- Number of unassigned tasks.
- Holiday days taken per employee this week, and holiday days remaining after the week (remaining before the week minus approved holidays taken on working days).
- Consecutive days worked per employee: the longest run of days on shift without a day off. A holiday or public holiday counts as a day off. A run that starts before the week counts the days already worked in a row before it. This is the employee's health status in days. An employee is at risk once the run reaches 3 days.
- Company employee health: the share of employees who are not at risk (run below 3 days), plus the average run across all employees.
- Revenue per task: the assigned employee's billing rate times the task duration.
- Profit per employee: (billing rate minus hourly rate) times their task hours.
- Company profit for the week: the sum of profit per employee (revenue of all assigned tasks minus total labor cost).

## Hard constraints (a plan that breaks one is infeasible)

- **Minimum rest:** each employee gets at least their own minimum rest between shifts, measured from shift end to the next shift start. This protects against overwork, which is the purpose of the model.
- **Maximum hours per day:** never exceed each employee's own maximum hours per day. Exceeding it risks overwork and health harm.
- **Maximum hours per week:** never exceed each employee's own weekly hours limit.
- **Required skills:** tasks go only to employees holding all the needed skills. An employee without the skills cannot do the task.
- **Health-related work limits:** respect health-related work limits. They enter the model as the per-employee limits above (daily hour limit, availability), so the plan never exceeds a limit set for health reasons.
- **Availability:** only schedule employees on days and hours they are available. Scheduling someone when they cannot work gives an unusable plan.
- **Approved holidays:** never schedule an employee on an approved holiday. Every employee has the right to take holidays, so the plan never overrides one to save cost or cover tasks.
- **Public holidays:** no shifts and no task assignments on a public holiday.
- **One task at a time (added from conversation context):** an employee cannot do 2 overlapping tasks. A person cannot be in 2 places at once.
- **Tasks within shift (added from conversation context):** an employee can take a task only if the task falls within a shift they are assigned to.

## Medium constraints (best-effort coverage when resources are short)

- **Penalize each unassigned task.** The plan assigns as many tasks as possible but never breaks a hard constraint to do so. A week with more work than available capacity still gets a usable plan, with the leftover tasks listed as unassigned. This ranks above every soft goal, so the plan does not drop tasks just to save labor cost.

## Soft constraints / objectives (equal weights to start)

- **Fewer idle hours during shifts:** minimize idle hours per employee on shift.
- **Lower total labor cost:** minimize total cost, paid only for task hours at each employee's own hourly rate.
- **Fewer tasks left unassigned:** best-effort coverage of tasks. It is enforced at the medium level (see Medium constraints), so it ranks above the other soft goals.
- **Respect days employees want off:** penalize scheduling an employee on a day they asked to have off. This covers wishes that are not approved holidays; approved holidays are a hard constraint.
- **Avoid hours employees would rather not work:** penalize scheduling an employee in hours they asked to avoid.

Spreading hours evenly across employees was considered and removed. It is not a goal of this model.

The health and profit metrics (see Success metrics) are reported only. They do not change the score, and employee health still comes before cost.

## Success metrics (KPIs)

- Total labor cost for the week.
- Idle hours (per employee and in total).
- Number of tasks left unassigned.
- Employee health status in days: consecutive days worked per employee.
- Company overall employee health: share of employees not at risk (fewer than 3 days in a row), and the average consecutive days worked.
- Company profit per employee.
- Company overall profit for the week.

**Long-term outcomes (longevity).** HR measures these over months. The weekly plan does not optimise them. The weekly health metrics above are the short-term lever meant to move them:
- Average tenure (years at the company).
- Unplanned absence days per employee and in total, and whether the trend is rising or falling.
- Company retention rate after 1, 3 and 5 years.

## Scale and performance targets (horizon, counts)

| Item | Normal plan | Busiest plan |
|---|---|---|
| Planning horizon | 1 week | 1 week |
| Employees | 50 | 50 |
| Shifts per day | 1 (09:00 to 17:00) | 1 (09:00 to 17:00) |
| Tasks | 500 | 500 |
| Days in the plan | 7 | 7 |
| Solve time | 30 seconds | 30 seconds |

## Input and output (JSON request and response content)

**Input (one request holds the complete dataset):**
- The planning week, the daily shift times and the public holidays in the week.
- Employees with their profiles: skills, hourly rate, hourly billing rate, maximum hours per day, minimum rest, available days and hours, weekly hours, days off requested, hours they would rather not work, days already worked in a row before the week, approved holidays in the week, holiday days remaining, tenure, and unplanned absence days in the last 3 months.
- The company retention rate after 1, 3 and 5 years.
- Tasks with set start time, duration and required skills.
- Optional pinned assignments.

**Output (the plan):**
- Employees assigned to each day's shift.
- The employee assigned to each task.
- Hours worked per employee per day.
- Total labor cost.
- Idle hours per employee.
- The list of tasks that stayed unassigned.
- Consecutive days worked per employee (health status in days).
- Holiday days taken this week and holiday days remaining per employee.
- Longevity view: tenure and unplanned absence days per employee, average tenure, and the company retention rate, shown next to the plan.
- Company employee health.
- Profit per employee.
- Company profit for the week.
- Which constraints are broken, if any.

## Timefold defaults

- The model is a stateless JSON REST API service built with the Timefold Solver service module on Quarkus. Every request carries its complete dataset as JSON input and gets the plan back as JSON output, so the model handles any dataset, not one fixed instance. A UI is always included.
- The score has three levels. Hard: rules that must never be broken, because a plan that breaks one is infeasible. Medium: assign as much work as possible, with a penalty for each unassigned item. Soft: preferences and optimization goals. A week with more work than capacity still gets a usable plan.
- All soft constraints start with equal weight. The weights are tuned afterwards, once real schedules show which trade-offs matter (goal alignment).
- Pinning is supported: any assignment can be pinned, so the plan can be solved again with work in progress locked. A pinned assignment always wins, even when it breaks a hard constraint: the model keeps it and minimizes breaking any other constraint.
- Travel times and distances come from the Timefold Platform's built-in map service, never from a matrix in the input data. This model has no travel component.

## Assumptions

- Each task is done by exactly 1 employee.
- Task start times are fixed, and the plan never moves them.
- Labor cost counts only task hours, not idle shift hours.
- Health, family and age details are not stored. Only the resulting limits are in the input.
- Preferences cover only days off and hours employees would rather not work. Preferences about specific tasks are out of scope.
- Because the shift is fixed at 09:00 to 17:00, the minimum rest rule is checked per employee against their own value.
- Health status in days is measured from the schedule only (consecutive days worked, including days worked in a row before the week), never from health records. 3 or more days in a row counts as at risk.
- Revenue depends on who does the task: the assigned employee's billing rate times the task hours. An unassigned task earns nothing.
- Holiday entitlement rules (days allowed per year, carry-over, approval) stay in the HR system. The plan only receives approved holidays and the remaining balance.
- A public holiday does not use up an employee's holiday days.
- Unplanned absences are counted over the last 3 months, without any reason (no illness or medical details), in line with the rule that health details are not stored.
- Longevity data (tenure, unplanned absences, retention) is reported only. It never changes the score or who gets assigned.

## Build decisions

These settle the former open questions for this build. Any of them can be revisited later.

| Topic | Decision |
|---|---|
| Days in the plan | 7 days. Days in a row are counted across weekends; public holidays are closed days. |
| Staff per shift | Any number. Staffing follows the tasks. |
| Working every available day | Not required. Days with no shift are allowed. |
| Task duration | 30 minutes to 8 hours, in 15-minute steps. |
| Weekly hours limit | Hard maximum. |
| Minimum rest | Measured from shift end to the next shift start (17:00 to 09:00 = 16 hours), so it only affects employees whose minimum rest is over 16 hours. |
| Idle hours | Counted against each employee's own available hours. |
| Skills | A plain list, no experience levels. |
| Hours rather not work | Set per day. |
| Employee self-service | Out of scope. The tool is for managers, team leaders, HR and executives. |
| Approval | Out of scope. The plan is a draft that a manager reviews. |
| Solve time | 30 seconds. |
| Task on a public holiday | Listed as unassigned, with the reason. |
| Half-day holidays | Not supported. Full days only. |
| Longevity view access | HR and executives. Managers see company-level numbers only. |