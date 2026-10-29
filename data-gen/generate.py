#!/usr/bin/env python3
"""
generate.py — Synthetic data generator for Japanese Work-Life Balancer.

Usage:
    python3 generate.py [--seed 42] [--out out/]

Outputs five WorkSchedule JSON files into --out:
    tiny.json, normal.json, overloaded.json, holiday.json, burnout.json

All names are FICTIONAL. Family names and given names are synthetic
combinations drawn from Japanese-style phoneme lists — no real person
is represented. The combinations are synthetic.
"""

import argparse
import json
import os
import random
from datetime import date, datetime, time, timedelta
from typing import Any

# ---------------------------------------------------------------------------
# Name pools (synthetic combinations — no real person represented)
# ---------------------------------------------------------------------------
FAMILY_NAMES = [
    "Yamamoto", "Tanaka", "Suzuki", "Watanabe", "Ito", "Kato", "Nakamura",
    "Kobayashi", "Saito", "Kudo", "Inoue", "Fujita", "Hayashi", "Ogawa",
    "Matsuda", "Nishimura", "Shimizu", "Ikeda", "Abe", "Maeda", "Morita",
    "Takeuchi", "Hasegawa", "Ueda", "Ishii", "Kimura", "Miura", "Okamoto",
    "Fujiwara", "Goto",
]

GIVEN_NAMES = [
    "Aoi", "Haruki", "Yuki", "Ren", "Sora", "Hana", "Kaito", "Mio",
    "Riku", "Nao", "Sota", "Yuna", "Kenji", "Emi", "Taro", "Sakura",
    "Hiroshi", "Yuri", "Daiki", "Akemi", "Ryota", "Nanami", "Takeshi",
    "Mizuki", "Jiro", "Ayane", "Kazuya", "Koharu", "Shinji", "Tomoka",
]

# ---------------------------------------------------------------------------
# Skills and task name templates
# ---------------------------------------------------------------------------
ALL_SKILLS = [
    "accounting", "customer-support", "data-analysis", "sales",
    "translation-en-ja", "it-support", "logistics", "design",
]

TASK_TEMPLATES: dict[str, list[str]] = {
    "accounting": [
        "Invoice reconciliation", "Expense review", "Budget forecast",
        "Payroll processing", "Tax filing prep", "Audit support",
        "Cost analysis", "Monthly close",
    ],
    "customer-support": [
        "Customer inquiry follow-up", "Complaint resolution",
        "Onboarding call", "Account review", "SLA report",
        "Escalation handling", "FAQ update", "Satisfaction survey",
    ],
    "data-analysis": [
        "Weekly KPI report", "Data pipeline review", "Dashboard update",
        "A/B test analysis", "Sales trend analysis", "Churn report",
        "Forecast model review", "Data quality check",
    ],
    "sales": [
        "Prospect call", "Proposal drafting", "Demo preparation",
        "Contract negotiation", "CRM update", "Sales review",
        "Lead qualification", "Partnership meeting",
    ],
    "translation-en-ja": [
        "Contract translation", "User guide localisation",
        "Email translation", "Marketing copy review", "Legal doc review",
        "Product spec translation", "Meeting transcript", "Press release",
    ],
    "it-support": [
        "Laptop setup", "VPN ticket", "Software install",
        "Access provisioning", "Security patch review", "Help desk",
        "Network troubleshoot", "Backup verification",
    ],
    "logistics": [
        "Shipment tracking", "Customs documentation", "Warehouse audit",
        "Carrier negotiation", "Inventory reconciliation", "Route planning",
        "Returns processing", "Vendor invoice check",
    ],
    "design": [
        "UI mock-up", "Brand asset update", "Presentation design",
        "Social media graphic", "Icon set review", "Landing page design",
        "Motion brief", "Design system update",
    ],
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SHIFT_START_MIN = 9 * 60   # 09:00
SHIFT_END_MIN   = 17 * 60  # 17:00
SHIFT_MINUTES   = SHIFT_END_MIN - SHIFT_START_MIN  # 480


def fmt_date(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def fmt_time(t: time) -> str:
    return t.strftime("%H:%M")


def fmt_dt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def minutes_to_time(m: int) -> time:
    return time(m // 60, m % 60)


def _time_to_min(t_str: str) -> int:
    h, m = t_str.split(":")
    return int(h) * 60 + int(m)


def week_days(week_start: date) -> list[date]:
    return [week_start + timedelta(days=i) for i in range(7)]


def sample_task_duration(rng: random.Random) -> int:
    """Skewed short: 30–180 weighted 3x, 195–480 normal weight."""
    options = list(range(30, 181, 15)) * 3 + list(range(195, 481, 15))
    return rng.choice(options)


# ---------------------------------------------------------------------------
# Capacity calculations
# ---------------------------------------------------------------------------

def employee_capacity_minutes(
    emp: dict,
    public_holidays: list[str],
) -> int:
    """Available work minutes for the week respecting maxHoursPerWeek + maxHoursPerDay."""
    forbidden = set(emp.get("approvedHolidays", [])) | set(public_holidays)
    total = 0
    for window in emp["availability"]:
        d_str = window["date"]
        if d_str in forbidden:
            continue
        ws = max(SHIFT_START_MIN, _time_to_min(window["start"]))
        we = min(SHIFT_END_MIN,   _time_to_min(window["end"]))
        day_mins = max(0, we - ws)
        total += min(day_mins, emp["maxHoursPerDay"] * 60)
    return min(total, emp["maxHoursPerWeek"] * 60)


def total_capacity(employees: list[dict], public_holidays: list[str]) -> int:
    return sum(employee_capacity_minutes(e, public_holidays) for e in employees)


def skill_capacity(skill: str, employees: list[dict], public_holidays: list[str]) -> int:
    return sum(
        employee_capacity_minutes(e, public_holidays)
        for e in employees if skill in e["skills"]
    )


def healthy_capacity_for_employee(
    emp: dict,
    week_start: date,
    public_holidays: list[str],
) -> int:
    """
    Max minutes the employee can work this week WITHOUT ever having a run of 3+
    consecutive worked days (counting their carry-in days before the week).

    Rules:
      - carry-in ≥ 2  → cannot work Monday (would be day 3)
      - carry-in = 1  → Mon + Tue cannot both be worked (would be days 2+3)
      - carry-in = 0  → no restriction at start of week

    Each worked day contributes min(availability_minutes, maxHoursPerDay*60).
    Total is capped at maxHoursPerWeek*60.
    Approved and public holidays are treated as 0-availability days (no work possible,
    run resets on those days, same as a scheduled day off).

    Uses exhaustive search over 2^7 = 128 subsets of the 7-day week.
    """
    carry_in    = min(emp.get("consecutiveDaysBeforeWeek", 0), 7)
    approved    = set(emp.get("approvedHolidays", []))
    pub_set     = set(public_holidays)
    max_week    = emp["maxHoursPerWeek"] * 60

    # Per-day available minutes (0 = cannot / must not work)
    day_avail: list[int] = []
    for offset in range(7):
        d     = week_start + timedelta(days=offset)
        d_str = fmt_date(d)
        if d_str in approved or d_str in pub_set:
            day_avail.append(0)
            continue
        w = _emp_avail_window(emp, d_str)
        if w is None:
            day_avail.append(0)
        else:
            ws, we = w
            day_avail.append(min(we - ws, emp["maxHoursPerDay"] * 60))

    initial_run = min(carry_in, 2)
    best        = 0

    for mask in range(128):  # 2^7 subsets
        run   = initial_run
        total = 0
        valid = True

        for day in range(7):
            if (mask >> day) & 1:
                if day_avail[day] == 0:
                    valid = False   # can't work a 0-availability day
                    break
                if run >= 2:
                    valid = False   # would be 3rd consecutive day
                    break
                run   += 1
                total += day_avail[day]
            else:
                run = 0

        if valid:
            best = max(best, min(total, max_week))

    return best


def total_healthy_capacity(
    employees: list[dict],
    week_start: date,
    public_holidays: list[str],
) -> int:
    """Sum of healthy_capacity_for_employee across all employees."""
    return sum(
        healthy_capacity_for_employee(e, week_start, public_holidays)
        for e in employees
    )


# ---------------------------------------------------------------------------
# Employee generation
# ---------------------------------------------------------------------------

def make_employees(
    rng: random.Random,
    n: int,
    week_start: date,
    *,
    burnout_mode: bool = False,
) -> list[dict[str, Any]]:
    """
    Generate n employees with synthetic names (FICTIONAL combinations only).
    """
    # Guarantee every skill is held by ≥ 4 employees via mandatory seeding
    mandatory_assignments: list[str] = []
    for skill in ALL_SKILLS:
        mandatory_assignments.extend([skill] * 4)
    rng.shuffle(mandatory_assignments)

    employees = []
    used_names: set[str] = set()

    for i in range(n):
        for _ in range(200):
            fname = rng.choice(FAMILY_NAMES)
            gname = rng.choice(GIVEN_NAMES)
            full_name = f"{fname} {gname}"
            if full_name not in used_names:
                break
        used_names.add(full_name)

        emp_id = f"E-{i+1:03d}"

        # Skills: 1–4, include mandatory seed if available
        n_skills = rng.randint(1, 4)
        if i < len(mandatory_assignments):
            mandatory = [mandatory_assignments[i]]
        else:
            mandatory = [rng.choice(ALL_SKILLS)]
        extra_pool = [s for s in ALL_SKILLS if s not in mandatory]
        extra = rng.sample(extra_pool, min(n_skills - 1, len(extra_pool)))
        skills = list(set(mandatory + extra))

        # Rates (JPY)
        hourly_rate  = rng.randrange(1500, 3550, 50)
        billing_rate = round(hourly_rate * rng.uniform(1.5, 2.5) / 50) * 50

        # Daily / weekly / rest limits
        r_day = rng.random()
        max_hours_day = 8 if r_day < 0.70 else (6 if r_day < 0.90 else 4)

        r_week = rng.random()
        max_hours_week = 40 if r_week < 0.65 else (30 if r_week < 0.85 else 20)

        r_rest = rng.random()
        min_rest = rng.randint(11, 12) if r_rest < 0.90 else rng.choice([20, 24])

        # Availability windows (per day)
        days = week_days(week_start)
        include_weekend = rng.random() < 0.25
        availability: list[dict] = []
        for d in days:
            is_weekend = d.weekday() >= 5
            if is_weekend and not include_weekend:
                continue
            r_av = rng.random()
            if r_av < 0.075:
                avail_start, avail_end = time(10, 0), time(17, 0)
            elif r_av < 0.15:
                avail_start = time(9, 0)
                avail_end   = rng.choice([time(15, 0), time(16, 0)])
            else:
                avail_start, avail_end = time(9, 0), time(17, 0)
            availability.append({
                "date":  fmt_date(d),
                "start": fmt_time(avail_start),
                "end":   fmt_time(avail_end),
            })

        # Days off requested (0–2 soft wishes from available days)
        avail_date_strs = [a["date"] for a in availability]
        n_off = rng.randint(0, 2)
        days_off_requested = (
            rng.sample(avail_date_strs, min(n_off, len(avail_date_strs)))
            if avail_date_strs else []
        )

        # Avoid hours (20% chance, one window)
        avoid_hours: list[dict] = []
        if rng.random() < 0.20 and avail_date_strs:
            avoid_hours.append({
                "date":  rng.choice(avail_date_strs),
                "start": "15:00",
                "end":   "17:00",
            })

        # History
        # Ordinary carry-in is 0–1 (carry-in=2 already pre-loads Mon as 3rd day).
        # Burnout scenario: 30% of staff arrive with 2–5 days already worked in a row.
        if burnout_mode and rng.random() < 0.30:
            consecutive_before = rng.randint(2, 5)
        else:
            consecutive_before = rng.randint(0, 1)

        holiday_remaining = rng.randint(0, 20)
        tenure_years      = round(rng.uniform(0, 25), 1)
        base_absence      = rng.randint(0, 4)
        absence_extra     = rng.randint(0, 2) if consecutive_before >= 3 else 0
        unplanned_absence = min(6, base_absence + absence_extra)

        employees.append({
            "id":                        emp_id,
            "name":                      full_name,
            "skills":                    skills,
            "hourlyRate":                hourly_rate,
            "billingRate":               billing_rate,
            "maxHoursPerDay":            max_hours_day,
            "maxHoursPerWeek":           max_hours_week,
            "minRestHours":              min_rest,
            "availability":              availability,
            "daysOffRequested":          days_off_requested,
            "avoidHours":                avoid_hours,
            "approvedHolidays":          [],   # filled later for holiday scenario
            "consecutiveDaysBeforeWeek": consecutive_before,
            "holidayDaysRemaining":      holiday_remaining,
            "tenureYears":               tenure_years,
            "unplannedAbsenceDays3m":    unplanned_absence,
        })

    return employees


def add_approved_holidays(
    rng: random.Random,
    employees: list[dict],
    week_start: date,
    frac: float = 0.10,
) -> None:
    """Mark ~frac of employees as having an approved holiday on one weekday."""
    weekdays = [week_start + timedelta(days=i) for i in range(5)]
    n = max(1, round(len(employees) * frac))
    chosen = rng.sample(employees, n)
    for emp in chosen:
        d_str = fmt_date(rng.choice(weekdays))
        if d_str not in emp["approvedHolidays"]:
            emp["approvedHolidays"].append(d_str)


# ---------------------------------------------------------------------------
# Task generation
# ---------------------------------------------------------------------------

def _emp_avail_window(emp: dict, d_str: str) -> tuple[int, int] | None:
    """Return (start_min, end_min) clipped to shift for emp on d_str, or None."""
    for w in emp["availability"]:
        if w["date"] == d_str:
            ws = max(SHIFT_START_MIN, _time_to_min(w["start"]))
            we = min(SHIFT_END_MIN,   _time_to_min(w["end"]))
            if we > ws:
                return (ws, we)
    return None


def make_tasks(
    rng: random.Random,
    week_start: date,
    employees: list[dict],
    public_holidays: list[str],
    target_ratio: float,
    *,
    pinned_count: int = 0,
    ensure_no_unassigned: bool = False,
    ensure_eligible: bool = False,
    include_public_holiday_tasks: bool = False,
    n_holiday_tasks: int = 0,
) -> list[dict[str, Any]]:
    """
    Generate tasks until task_minutes / capacity ≈ target_ratio.

    ensure_no_unassigned: each task has ≥1 eligible employee with capacity left.
    ensure_eligible: each task has ≥1 eligible employee (skills + availability),
        but capacity is NOT tracked — used for overloaded to exceed total capacity
        while keeping every task theoretically hard-assignable.
    """
    cap = total_capacity(employees, public_holidays)
    target_task_min = int(cap * target_ratio)

    days = week_days(week_start)
    pub_set = set(public_holidays)

    # Capacity tracking for ensure_no_unassigned
    emp_day_used:    dict[str, dict[str, int]]              = {e["id"]: {} for e in employees}
    emp_week_used:   dict[str, int]                         = {e["id"]: 0  for e in employees}
    # Interval tracking: employee_id -> date_str -> list of (start_min, end_min)
    emp_intervals:   dict[str, dict[str, list]]             = {e["id"]: {} for e in employees}
    # Dates worked (for minRestHours check)
    emp_worked_dates: dict[str, set]                        = {e["id"]: set() for e in employees}

    def _adj(d_str: str, delta: int) -> str:
        return fmt_date(date.fromisoformat(d_str) + timedelta(days=delta))

    def can_fit(emp: dict, d_str: str, ts_min: int, dur: int) -> bool:
        eid = emp["id"]
        if d_str in set(emp.get("approvedHolidays", [])):
            return False
        # minRestHours > 16 means the 16 h gap between consecutive 09–17 days is
        # insufficient: employee cannot work on a day adjacent to any already-booked day.
        if emp["minRestHours"] > 16:
            if _adj(d_str, -1) in emp_worked_dates[eid]:
                return False
            if _adj(d_str,  1) in emp_worked_dates[eid]:
                return False
        w = _emp_avail_window(emp, d_str)
        if w is None:
            return False
        ws, we = w
        if ts_min < ws or ts_min + dur > we:
            return False
        # Time-overlap check against already-booked intervals on this day
        te_min = ts_min + dur
        for (existing_ts, existing_te) in emp_intervals[eid].get(d_str, []):
            if ts_min < existing_te and te_min > existing_ts:
                return False
        if emp_day_used[eid].get(d_str, 0) + dur > emp["maxHoursPerDay"] * 60:
            return False
        if emp_week_used[eid] + dur > emp["maxHoursPerWeek"] * 60:
            return False
        return True

    def is_eligible(emp: dict, d_str: str, ts_min: int, dur: int) -> bool:
        """Skills + availability only, no capacity tracking — used for overloaded."""
        if d_str in set(emp.get("approvedHolidays", [])):
            return False
        w = _emp_avail_window(emp, d_str)
        if w is None:
            return False
        ws, we = w
        return ts_min >= ws and ts_min + dur <= we

    def book(emp: dict, d_str: str, ts_min: int, dur: int) -> None:
        eid = emp["id"]
        emp_intervals[eid].setdefault(d_str, []).append((ts_min, ts_min + dur))
        emp_worked_dates[eid].add(d_str)
        emp_day_used[eid][d_str]  = emp_day_used[eid].get(d_str, 0) + dur
        emp_week_used[eid]        = emp_week_used.get(eid, 0) + dur

    tasks: list[dict] = []
    total_task_min = 0
    task_counter   = 1

    # Weekday and weekend pools (excluding public holidays for normal tasks)
    weekday_pool  = [d for d in days if d.weekday() < 5 and fmt_date(d) not in pub_set]
    weekend_pool  = [d for d in days if d.weekday() >= 5]
    all_valid_pool = weekday_pool + weekend_pool

    max_iterations = 200_000
    iterations = 0

    while total_task_min < target_task_min and iterations < max_iterations:
        iterations += 1

        # Day: 85% weekday, 15% weekend
        if rng.random() < 0.85 and weekday_pool:
            d = rng.choice(weekday_pool)
        elif all_valid_pool:
            d = rng.choice(all_valid_pool)
        else:
            break

        d_str = fmt_date(d)

        # Skills: 75% single, 25% dual
        if rng.random() < 0.75:
            required_skills = [rng.choice(ALL_SKILLS)]
        else:
            required_skills = rng.sample(ALL_SKILLS, 2)

        dur = sample_task_duration(rng)

        latest_start = SHIFT_END_MIN - dur
        if latest_start < SHIFT_START_MIN:
            continue  # duration doesn't fit in the shift

        # Try a random grid start
        grid_starts = list(range(SHIFT_START_MIN, latest_start + 1, 15))
        rng.shuffle(grid_starts)

        placed = False
        for ts in grid_starts:
            if ensure_no_unassigned:
                eligible = [
                    e for e in employees
                    if all(sk in e["skills"] for sk in required_skills)
                    and can_fit(e, d_str, ts, dur)
                ]
                if not eligible:
                    continue
                # Book the least-loaded eligible employee
                best = min(eligible, key=lambda e: emp_week_used.get(e["id"], 0))
                book(best, d_str, ts, dur)
            elif ensure_eligible:
                # Skills + availability only (no capacity tracking)
                eligible = [
                    e for e in employees
                    if all(sk in e["skills"] for sk in required_skills)
                    and is_eligible(e, d_str, ts, dur)
                ]
                if not eligible:
                    continue

            task_dt = datetime.combine(d, minutes_to_time(ts))
            tasks.append({
                "id":              f"T-{task_counter:04d}",
                "name":            rng.choice(TASK_TEMPLATES[required_skills[0]]),
                "start":           fmt_dt(task_dt),
                "durationMinutes": dur,
                "requiredSkills":  required_skills,
                "employee":        None,
                "pinned":          False,
            })
            task_counter   += 1
            total_task_min += dur
            placed = True
            break

        if not placed and ensure_no_unassigned:
            # Skip this iteration silently — try again with different day/skill/time
            continue

    # --- Overloaded stretch: add tasks with eligibility gate but no capacity tracking ---
    if ensure_eligible and total_task_min < target_task_min:
        for _ in range(200_000):
            if total_task_min >= target_task_min:
                break
            d = rng.choice(days)
            d_str = fmt_date(d)
            if d_str in pub_set:
                continue
            required_skills = [rng.choice(ALL_SKILLS)]
            dur = sample_task_duration(rng)
            latest_start = SHIFT_END_MIN - dur
            if latest_start < SHIFT_START_MIN:
                continue
            grid = list(range(SHIFT_START_MIN, latest_start + 1, 15))
            rng.shuffle(grid)
            for ts in grid:
                eligible = [
                    e for e in employees
                    if all(sk in e["skills"] for sk in required_skills)
                    and is_eligible(e, d_str, ts, dur)
                ]
                if not eligible:
                    continue
                task_dt = datetime.combine(d, minutes_to_time(ts))
                tasks.append({
                    "id":              f"T-{task_counter:04d}",
                    "name":            rng.choice(TASK_TEMPLATES[required_skills[0]]),
                    "start":           fmt_dt(task_dt),
                    "durationMinutes": dur,
                    "requiredSkills":  required_skills,
                    "employee":        None,
                    "pinned":          False,
                })
                task_counter   += 1
                total_task_min += dur
                break

    # --- Tasks deliberately on public holiday ---
    if include_public_holiday_tasks and n_holiday_tasks > 0:
        pub_days = [date.fromisoformat(p) for p in public_holidays]
        for pub_day in pub_days:
            for _ in range(n_holiday_tasks):
                dur = sample_task_duration(rng)
                latest_start = SHIFT_END_MIN - dur
                if latest_start < SHIFT_START_MIN:
                    dur = 60
                    latest_start = SHIFT_END_MIN - dur
                ts = rng.choice(range(SHIFT_START_MIN, latest_start + 1, 15))
                task_dt = datetime.combine(pub_day, minutes_to_time(ts))
                sk = rng.choice(ALL_SKILLS)
                tasks.append({
                    "id":              f"T-{task_counter:04d}",
                    "name":            rng.choice(TASK_TEMPLATES[sk]),
                    "start":           fmt_dt(task_dt),
                    "durationMinutes": dur,
                    "requiredSkills":  [sk],
                    "employee":        None,
                    "pinned":          False,
                })
                task_counter   += 1

    # --- Apply pinning ---
    if pinned_count and tasks:
        # Only pin tasks that are NOT on public holidays
        pinnable = [t for t in tasks if t["start"][:10] not in pub_set]
        for t in rng.sample(pinnable, min(pinned_count, len(pinnable))):
            d_str = t["start"][:10]
            ts_min = _time_to_min(t["start"][11:16])
            dur    = t["durationMinutes"]
            eligible = [
                e for e in employees
                if all(sk in e["skills"] for sk in t["requiredSkills"])
                and d_str not in set(e.get("approvedHolidays", []))
                and _emp_avail_window(e, d_str) is not None
                and (lambda w=_emp_avail_window(e, d_str): w[0] <= ts_min and ts_min + dur <= w[1])()
            ]
            if eligible:
                chosen = rng.choice(eligible)
                t["employee"] = chosen["id"]
                t["pinned"]   = True

    return tasks


# ---------------------------------------------------------------------------
# Schedule assembly + summary
# ---------------------------------------------------------------------------

def build_schedule(
    name: str,
    week_start: date,
    employees: list[dict],
    tasks: list[dict],
    public_holidays: list[date],
) -> dict:
    return {
        "name":           name,
        "weekStart":      fmt_date(week_start),
        "shiftStart":     "09:00",
        "shiftEnd":       "17:00",
        "publicHolidays": [fmt_date(d) for d in public_holidays],
        # MOCK: invented company retention figures
        "retention":      {"year1": 0.88, "year3": 0.74, "year5": 0.63},
        "employees":      employees,
        "tasks":          tasks,
    }


def _peak_simultaneous(tasks: list[dict], d_str: str) -> int:
    """Maximum number of tasks overlapping at any single minute on date d_str."""
    events: list[tuple[int, int]] = []
    for t in tasks:
        if t["start"][:10] != d_str:
            continue
        ts = _time_to_min(t["start"][11:16])
        te = ts + t["durationMinutes"]
        events.append((ts,  +1))
        events.append((te,  -1))
    events.sort()
    peak = cur = 0
    for _, delta in events:
        cur  += delta
        peak  = max(peak, cur)
    return peak


def print_summary(scenario: str, schedule: dict) -> None:
    employees   = schedule["employees"]
    tasks       = schedule["tasks"]
    pub_list    = schedule["publicHolidays"]
    week_start  = date.fromisoformat(schedule["weekStart"])
    pub_set     = set(pub_list)

    n_emp    = len(employees)
    n_tasks  = len(tasks)
    task_hrs = sum(t["durationMinutes"] for t in tasks) / 60
    cap_min  = total_capacity(employees, pub_list)
    cap_hrs  = cap_min / 60
    ratio    = task_hrs / cap_hrs if cap_hrs else float("inf")

    # Healthy capacity
    hcap_min = total_healthy_capacity(employees, week_start, pub_list)
    hcap_hrs = hcap_min / 60
    h_ratio  = task_hrs / hcap_hrs if hcap_hrs else float("inf")

    # Per-day task minutes
    day_task_min: dict[str, int] = {}
    for t in tasks:
        d_str = t["start"][:10]
        day_task_min[d_str] = day_task_min.get(d_str, 0) + t["durationMinutes"]

    # Per-day capacity and available staff count
    day_cap_min:   dict[str, int] = {}
    day_avail_staff: dict[str, int] = {}
    for d_off in range(7):
        d     = week_start + timedelta(days=d_off)
        d_str = fmt_date(d)
        dc = staff = 0
        for emp in employees:
            if d_str in set(emp.get("approvedHolidays", [])):
                continue
            if d_str in pub_set:
                continue
            w = _emp_avail_window(emp, d_str)
            if w:
                ws, we = w
                dc    += min(we - ws, emp["maxHoursPerDay"] * 60)
                staff += 1
        day_cap_min[d_str]    = dc
        day_avail_staff[d_str] = staff

    # Tasks per skill
    skill_count: dict[str, int] = {s: 0 for s in ALL_SKILLS}
    for t in tasks:
        for sk in t["requiredSkills"]:
            skill_count[sk] = skill_count.get(sk, 0) + 1

    tasks_on_pub = sum(1 for t in tasks if t["start"][:10] in pub_set)

    print(f"\n=== {scenario} ===")
    print(f"  Employees        : {n_emp}")
    print(f"  Tasks            : {n_tasks}")
    print(f"  Task hours       : {task_hrs:.1f} h")
    print(f"  Capacity         : {cap_hrs:.1f} h   (ratio {ratio:.1%})")
    print(f"  Healthy capacity : {hcap_hrs:.1f} h   (task/healthy ratio {h_ratio:.1%})")
    print(f"  Tasks on public holidays: {tasks_on_pub}")
    print(f"  Per-day  task h / cap h  (load%)  peak-simultaneous / available-staff:")
    for d_off in range(7):
        d         = week_start + timedelta(days=d_off)
        d_str     = fmt_date(d)
        day_name  = d.strftime("%a %Y-%m-%d")
        th        = day_task_min.get(d_str, 0) / 60
        cap       = day_cap_min.get(d_str, 0) / 60
        r         = (th / cap * 100) if cap else 0
        peak      = _peak_simultaneous(tasks, d_str)
        staff     = day_avail_staff.get(d_str, 0)
        ph        = "  [PUBLIC HOLIDAY]" if d_str in pub_set else ""
        print(
            f"    {day_name}: {th:5.1f}h / {cap:5.1f}h  ({r:3.0f}%)"
            f"  peak {peak:3d} / {staff:3d} staff{ph}"
        )
    print(f"  Tasks per skill:")
    for sk, cnt in sorted(skill_count.items()):
        print(f"    {sk:25s}: {cnt}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic WorkSchedule JSON files.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out",  default="out/")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    base_rng = random.Random(args.seed)
    seeds = [base_rng.randint(0, 2**31) for _ in range(10)]

    WEEK_A = date(2026, 11, 9)   # Mon — tiny, normal, overloaded, burnout
    WEEK_H = date(2026, 11, 2)   # Mon — holiday week
    CULTURE_DAY = date(2026, 11, 3)

    # ----- 1. tiny -----
    rng = random.Random(seeds[0])
    emps_tiny = make_employees(rng, 8, WEEK_A)
    tasks_tiny = make_tasks(
        rng, WEEK_A, emps_tiny, [],
        target_ratio=0.60,
        ensure_no_unassigned=True,
    )
    tiny = build_schedule("tiny", WEEK_A, emps_tiny, tasks_tiny, [])

    # ----- 2. normal -----
    rng = random.Random(seeds[1])
    emps_norm = make_employees(rng, 50, WEEK_A)
    tasks_norm = make_tasks(
        rng, WEEK_A, emps_norm, [],
        target_ratio=0.50,
        pinned_count=3,
        ensure_no_unassigned=True,
    )
    normal = build_schedule("normal", WEEK_A, emps_norm, tasks_norm, [])

    # ----- 3. overloaded -----
    rng = random.Random(seeds[2])
    emps_over = make_employees(rng, 50, WEEK_A)
    tasks_over = make_tasks(
        rng, WEEK_A, emps_over, [],
        target_ratio=1.25,
        ensure_no_unassigned=False,
        ensure_eligible=True,          # every task has a valid employee, just not enough capacity
    )
    overloaded = build_schedule("overloaded", WEEK_A, emps_over, tasks_over, [])

    # ----- 4. holiday -----
    rng = random.Random(seeds[3])
    emps_hol = make_employees(rng, 50, WEEK_H)
    add_approved_holidays(rng, emps_hol, WEEK_H, frac=0.10)
    pub_hol_str = [fmt_date(CULTURE_DAY)]
    tasks_hol = make_tasks(
        rng, WEEK_H, emps_hol, pub_hol_str,
        target_ratio=0.75,
        ensure_no_unassigned=True,
        include_public_holiday_tasks=True,
        n_holiday_tasks=20,
    )
    holiday = build_schedule("holiday", WEEK_H, emps_hol, tasks_hol, [CULTURE_DAY])

    # ----- 5. burnout -----
    # 30% of staff with 2–5 days carry-in; load ~0.55 of total capacity so that
    # health-first can meaningfully beat cost-first (task/healthy-capacity ratio ~0.9).
    rng = random.Random(seeds[4])
    emps_burn = make_employees(rng, 50, WEEK_A, burnout_mode=True)
    tasks_burn = make_tasks(
        rng, WEEK_A, emps_burn, [],
        target_ratio=0.55,
        ensure_no_unassigned=True,
    )
    burnout = build_schedule("burnout", WEEK_A, emps_burn, tasks_burn, [])

    # ----- Write + summarise -----
    scenarios = [
        ("tiny",       tiny),
        ("normal",     normal),
        ("overloaded", overloaded),
        ("holiday",    holiday),
        ("burnout",    burnout),
    ]

    for fname, schedule in scenarios:
        out_path = os.path.join(args.out, f"{fname}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(schedule, f, indent=2, ensure_ascii=False)
        print_summary(fname, schedule)
        print(f"  Written → {out_path}")

    print("\nAll scenarios generated.")
    _print_curl_commands()


def _print_curl_commands() -> None:
    print("\n--- Checkpoint 2 curl commands (Phase 1 model must be running) ---")
    print("# Start model:  cd model && mvn quarkus:dev")
    print()
    print("# Solve normal (30 s, health-first):")
    print('JOB_N=$(curl -s -X POST "http://localhost:8083/schedules?preset=health-first&limitSeconds=30" \\')
    print('  -H "Content-Type: application/json" -d @data-gen/out/normal.json)')
    print('echo "normal job: $JOB_N" && sleep 32')
    print('curl -s "http://localhost:8083/schedules/$JOB_N" | \\')
    print('  python3 -c "import sys,json; r=json.load(sys.stdin); print(\'score:\',r.get(\'score\')); print(\'unassigned:\',r.get(\'kpis\',{}).get(\'unassignedCount\',\'?\'))"')
    print()
    print("# Solve overloaded (30 s, health-first):")
    print('JOB_O=$(curl -s -X POST "http://localhost:8083/schedules?preset=health-first&limitSeconds=30" \\')
    print('  -H "Content-Type: application/json" -d @data-gen/out/overloaded.json)')
    print('echo "overloaded job: $JOB_O" && sleep 32')
    print('curl -s "http://localhost:8083/schedules/$JOB_O" | \\')
    print('  python3 -c "import sys,json; r=json.load(sys.stdin); print(\'score:\',r.get(\'score\')); print(\'unassigned:\',r.get(\'kpis\',{}).get(\'unassignedCount\',\'?\'))"')


if __name__ == "__main__":
    main()
