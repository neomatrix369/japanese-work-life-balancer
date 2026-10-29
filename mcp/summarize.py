"""
summarize.py — pure functions over the GET /schedules/{id} response dict.

Expected top-level shape:
    {
        "schedule":          { "weekStart", "tasks": [...], "employees": [...], ... },
        "kpis":              { company-level KPI fields },
        "perEmployee":       list[{...}]  OR  dict[employee_id, {...}],
        "shifts":            { date: [employee_id, ...] },
        "unassigned":        [ { "taskId", "reason", "description" }, ... ],
        "longevity":         { ... },
        "brokenConstraints": [ { "name", "level", "matchCount", "score" }, ... ],
        "preset":            str,
        "status":            str,
        "score":             str,
    }

All functions are defensive: missing / None fields return safe defaults.
"""

from __future__ import annotations


def get_employee_map(data: dict) -> dict[str, dict]:
    """Normalise perEmployee to {employee_id: employee_data} regardless of whether
    the server returns a list or a map.

    List form:   [{id: "E-001", ...}, ...]
    Map form:    {"E-001": {...}, ...}
    """
    per_emp = (data or {}).get("perEmployee")
    if not per_emp:
        return {}
    if isinstance(per_emp, list):
        result: dict[str, dict] = {}
        for i, emp in enumerate(per_emp):
            if not isinstance(emp, dict):
                continue
            # Prefer explicit id fields; fall back to index-based key
            eid = emp.get("id") or emp.get("employeeId") or str(i)
            result[str(eid)] = emp
        return result
    if isinstance(per_emp, dict):
        return per_emp
    return {}


# ---------------------------------------------------------------------------
# Company-level summary
# ---------------------------------------------------------------------------

def company_summary(data: dict) -> dict:
    """Compact company KPIs plus solve metadata."""
    kpis = (data or {}).get("kpis") or {}
    return {
        "status": data.get("status"),
        "score": data.get("score"),
        "preset": data.get("preset"),
        # Health
        "healthyShare": kpis.get("healthyShare"),
        "atRiskCount": kpis.get("atRiskCount"),
        "avgConsecutiveDays": kpis.get("avgConsecutiveDays"),
        "idleHoursTotal": kpis.get("idleHoursTotal"),
        "employeesWorking": kpis.get("employeesWorking"),
        # Business
        "totalLaborCost": kpis.get("totalLaborCost"),
        "totalRevenue": kpis.get("totalRevenue"),
        "companyProfit": kpis.get("companyProfit"),
        "unassignedCount": kpis.get("unassignedCount"),
        "assignedTaskHours": kpis.get("assignedTaskHours"),
    }


# ---------------------------------------------------------------------------
# At-risk employees
# ---------------------------------------------------------------------------

def top_at_risk_employees(data: dict, n: int = 5) -> list[dict]:
    """Return the top N at-risk employees sorted by maxConsecutiveDays descending."""
    emp_map = get_employee_map(data)
    at_risk = []
    for emp_id, emp in emp_map.items():
        if not isinstance(emp, dict):
            continue
        if emp.get("atRisk"):
            at_risk.append({
                "id": emp_id,
                "name": emp.get("name"),
                "maxConsecutiveDays": emp.get("maxConsecutiveDays", 0),
                "totalHours": emp.get("totalHours"),
                "laborCost": emp.get("laborCost"),
                "profit": emp.get("profit"),
                "daysWorked": emp.get("daysWorked"),
            })
    at_risk.sort(key=lambda x: (x["maxConsecutiveDays"] or 0), reverse=True)
    return at_risk[:n]


# ---------------------------------------------------------------------------
# Unassigned tasks
# ---------------------------------------------------------------------------

def unassigned_by_reason(data: dict) -> dict[str, int]:
    """Count unassigned tasks grouped by reason code."""
    unassigned = (data or {}).get("unassigned") or []
    counts: dict[str, int] = {}
    for item in unassigned:
        if not isinstance(item, dict):
            continue
        reason = item.get("reason") or "UNKNOWN"
        counts[str(reason)] = counts.get(str(reason), 0) + 1
    return counts


def unassigned_total(data: dict) -> int:
    """Total count of unassigned tasks."""
    return sum(unassigned_by_reason(data).values())


# ---------------------------------------------------------------------------
# Employee detail
# ---------------------------------------------------------------------------

def employee_detail(data: dict, employee_id: str) -> dict | None:
    """Return per-employee KPI record for the given id, or None if not found."""
    emp_map = get_employee_map(data)
    return emp_map.get(employee_id)


def employee_schedule(data: dict, employee_id: str) -> dict | None:
    """
    Return a compact schedule summary for one employee:
    - KPI fields from perEmployee
    - Their tasks (id, name, start, duration) limited to 20 entries

    Task.employee is serialised as the employee id string
    (via @JsonIdentityReference(alwaysAsId=true)).
    """
    emp_data = employee_detail(data, employee_id)
    if emp_data is None:
        return None

    schedule = (data or {}).get("schedule") or {}
    all_tasks: list[dict] = schedule.get("tasks") or []

    emp_tasks = []
    for t in all_tasks:
        if not isinstance(t, dict):
            continue
        # Task.employee is always serialised as an id string via
        # @JsonIdentityReference(alwaysAsId = true)
        if str(t.get("employee") or "") == employee_id:
            emp_tasks.append({
                "id": t.get("id"),
                "name": t.get("name"),
                "start": t.get("start"),
                "durationMinutes": t.get("durationMinutes"),
                "requiredSkills": t.get("requiredSkills"),
                "pinned": t.get("pinned", False),
            })

    return {
        "employeeId": employee_id,
        "name": emp_data.get("name"),
        "totalHours": emp_data.get("totalHours"),
        "idleHours": emp_data.get("idleHours"),
        "hoursPerDay": emp_data.get("hoursPerDay"),
        "laborCost": emp_data.get("laborCost"),
        "revenue": emp_data.get("revenue"),
        "profit": emp_data.get("profit"),
        "daysWorked": emp_data.get("daysWorked"),
        "maxConsecutiveDays": emp_data.get("maxConsecutiveDays"),
        "atRisk": emp_data.get("atRisk"),
        "taskCount": len(emp_tasks),
        "tasks": emp_tasks[:20],  # cap; never dump all tasks
    }


# ---------------------------------------------------------------------------
# Broken constraints
# ---------------------------------------------------------------------------

def broken_constraints_list(data: dict) -> list[dict]:
    """Return broken constraint records (non-zero score only), hard first."""
    raw: list = (data or {}).get("brokenConstraints") or []
    result = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        # Include only records where score != 0 (the server should already filter,
        # but be defensive)
        score = c.get("score")
        if score not in (None, "0", 0, "0hard/0medium/0soft"):
            result.append(c)
        elif score is None:
            # If server omits score, include anyway (server said it was broken)
            result.append(c)
    # Sort: HARD first, then MEDIUM, then SOFT
    level_order = {"HARD": 0, "MEDIUM": 1, "SOFT": 2}
    result.sort(key=lambda x: level_order.get(str(x.get("level", "")).upper(), 9))
    return result


# ---------------------------------------------------------------------------
# KPI delta (for compare_presets)
# ---------------------------------------------------------------------------

def kpi_delta(base: dict, other: dict) -> dict:
    """
    Return field-level deltas (other − base) for numeric company KPI fields.
    Positive delta means 'other' is higher.
    """
    numeric_fields = [
        "healthyShare", "atRiskCount", "avgConsecutiveDays", "idleHoursTotal",
        "employeesWorking", "totalLaborCost", "totalRevenue", "companyProfit",
        "unassignedCount", "assignedTaskHours",
    ]
    delta: dict[str, float | None] = {}
    for field in numeric_fields:
        bv = base.get(field)
        ov = other.get(field)
        if bv is not None and ov is not None:
            try:
                delta[field] = round(float(ov) - float(bv), 4)
            except (TypeError, ValueError):
                delta[field] = None
        else:
            delta[field] = None
    return delta
