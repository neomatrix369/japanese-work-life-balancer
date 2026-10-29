#!/usr/bin/env python3
"""
check.py — Static validator for generated WorkSchedule JSON files.

Usage:
    python3 check.py [out/tiny.json out/normal.json ...]

Rules checked (hard constraints from the spec):

1. Every task starts and ends within the 09:00–17:00 shift window.
2. Every task (on a non-public-holiday day, and when the scenario is not the
   holiday scenario with tasks intentionally placed on that day) has at least
   one employee who:
     a. Possesses all required skills.
     b. Has an availability window that fully covers [task.start, task.end].
     c. Is NOT on an approved holiday that day.
     d. Is NOT on a public holiday that day.
   (Tasks on public holidays in the holiday scenario are exempt from rule 2 —
   those are EXPECTED to be unassigned.)
3. Pinned tasks reference a valid employee id (one who exists in the schedule).
"""

import json
import os
import sys
from datetime import date, datetime, time


SHIFT_START = time(9, 0)
SHIFT_END   = time(17, 0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hm_to_min(hm: str) -> int:
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def _dt_to_min(dt_str: str) -> tuple[str, int]:
    """Return (date_str, minutes_since_midnight)."""
    dt = datetime.fromisoformat(dt_str)
    return dt.strftime("%Y-%m-%d"), dt.hour * 60 + dt.minute


def shift_start_min() -> int:
    return SHIFT_START.hour * 60 + SHIFT_START.minute  # 540


def shift_end_min() -> int:
    return SHIFT_END.hour * 60 + SHIFT_END.minute       # 1020


# ---------------------------------------------------------------------------
# Core check
# ---------------------------------------------------------------------------

def check_file(path: str) -> list[str]:
    """Return a list of error messages (empty = pass)."""
    with open(path, encoding="utf-8") as f:
        schedule = json.load(f)

    errors: list[str] = []

    employees   = schedule["employees"]
    tasks       = schedule["tasks"]
    pub_hols    = set(schedule.get("publicHolidays", []))

    emp_by_id   = {e["id"]: e for e in employees}
    ss_min      = shift_start_min()
    se_min      = shift_end_min()

    for task in tasks:
        tid      = task["id"]
        d_str, ts_min = _dt_to_min(task["start"])
        dur      = task["durationMinutes"]
        te_min   = ts_min + dur
        req      = set(task.get("requiredSkills", []))
        emp_id   = task.get("employee")
        pinned   = task.get("pinned", False)
        on_pub   = d_str in pub_hols

        # --- Rule 1: task inside shift ---
        if ts_min < ss_min or te_min > se_min:
            errors.append(
                f"[{tid}] Outside shift window: {task['start']} "
                f"+ {dur}min ends at {te_min} (shift={ss_min}–{se_min})"
            )

        # --- Rule 2: at least one eligible employee (skip public-holiday tasks) ---
        if not on_pub:
            eligible = _find_eligible_employees(
                employees, d_str, ts_min, te_min, req
            )
            if not eligible:
                errors.append(
                    f"[{tid}] No employee eligible on {d_str} "
                    f"{ts_min//60:02d}:{ts_min%60:02d}–{te_min//60:02d}:{te_min%60:02d} "
                    f"skills={sorted(req)}"
                )

        # --- Rule 3: pinned tasks reference a valid employee ---
        if pinned:
            if not emp_id:
                errors.append(f"[{tid}] Pinned but employee field is null/empty")
            elif emp_id not in emp_by_id:
                errors.append(f"[{tid}] Pinned to unknown employee id '{emp_id}'")
            else:
                # Also validate the pinned employee is actually eligible
                emp    = emp_by_id[emp_id]
                issues = _employee_issues(emp, d_str, ts_min, te_min, req)
                if issues:
                    errors.append(
                        f"[{tid}] Pinned to {emp_id} but they are ineligible: "
                        + "; ".join(issues)
                    )

    return errors


def _find_eligible_employees(
    employees: list[dict],
    d_str: str,
    ts_min: int,
    te_min: int,
    req: set[str],
) -> list[dict]:
    return [
        e for e in employees
        if not _employee_issues(e, d_str, ts_min, te_min, req)
    ]


def _employee_issues(
    emp: dict,
    d_str: str,
    ts_min: int,
    te_min: int,
    req: set[str],
) -> list[str]:
    """Return a list of reasons why emp cannot take this task (empty = eligible)."""
    issues = []

    # Skills
    emp_skills = set(emp.get("skills", []))
    missing    = req - emp_skills
    if missing:
        issues.append(f"missing skills {missing}")
        return issues  # no point checking further

    # Approved holiday
    if d_str in set(emp.get("approvedHolidays", [])):
        issues.append(f"approved holiday on {d_str}")
        return issues

    # Availability window
    window = _avail_window(emp, d_str)
    if window is None:
        issues.append(f"no availability on {d_str}")
        return issues

    ws_min, we_min = window
    if ts_min < ws_min or te_min > we_min:
        issues.append(
            f"availability {ws_min//60:02d}:{ws_min%60:02d}–"
            f"{we_min//60:02d}:{we_min%60:02d} doesn't cover task"
        )

    return issues


def _avail_window(emp: dict, d_str: str) -> tuple[int, int] | None:
    ss = shift_start_min()
    se = shift_end_min()
    for w in emp.get("availability", []):
        if w["date"] == d_str:
            ws = max(ss, _hm_to_min(w["start"]))
            we = min(se, _hm_to_min(w["end"]))
            if we > ws:
                return (ws, we)
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) > 1:
        paths = sys.argv[1:]
    else:
        # Default: all JSON files in out/
        out_dir = os.path.join(os.path.dirname(__file__), "out")
        paths   = sorted(
            os.path.join(out_dir, f)
            for f in os.listdir(out_dir)
            if f.endswith(".json")
        )

    if not paths:
        print("No JSON files found.")
        sys.exit(1)

    overall_ok = True
    for path in paths:
        fname  = os.path.basename(path)
        errors = check_file(path)
        if errors:
            overall_ok = False
            print(f"FAIL  {fname}  ({len(errors)} error(s))")
            for e in errors[:20]:  # cap output
                print(f"      {e}")
            if len(errors) > 20:
                print(f"      ... and {len(errors) - 20} more")
        else:
            # Quick stats
            with open(path, encoding="utf-8") as f:
                s = json.load(f)
            n_emp    = len(s["employees"])
            n_tasks  = len(s["tasks"])
            pub_hols = s.get("publicHolidays", [])
            n_pub_tasks = sum(1 for t in s["tasks"] if t["start"][:10] in set(pub_hols))
            n_pinned = sum(1 for t in s["tasks"] if t.get("pinned"))
            print(
                f"OK    {fname}  "
                f"emp={n_emp}  tasks={n_tasks}  "
                f"on_pub_holiday={n_pub_tasks}  pinned={n_pinned}"
            )

    if not overall_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
