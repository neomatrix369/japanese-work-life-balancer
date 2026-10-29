"""
server.py — MCP server for the Japanese Work-Life Balancer.

Wraps the Timefold Quarkus REST API (default http://localhost:8083) with
seven tools and one resource so Claude can drive the solver end-to-end.

Run:
    uv run python server.py
or via the Makefile:
    make mcp
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import httpx
from mcp.server import MCPServer

from summarize import (
    broken_constraints_list,
    company_summary,
    employee_schedule,
    kpi_delta,
    top_at_risk_employees,
    unassigned_by_reason,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MODEL_URL: str = os.environ.get("MODEL_URL", "http://localhost:8083").rstrip("/")

mcp = MCPServer("Japanese Work-Life Balancer")

# ---------------------------------------------------------------------------
# HTTP helpers — all errors become clear RuntimeError messages
# ---------------------------------------------------------------------------

async def _get(path: str) -> Any:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{MODEL_URL}{path}")
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        raise RuntimeError(
            f"Model unreachable at {MODEL_URL}. "
            "Start the Quarkus solver first: make model"
        )
    except httpx.HTTPStatusError as e:
        raise RuntimeError(
            f"Model returned HTTP {e.response.status_code}: "
            f"{e.response.text[:300]}"
        )
    except httpx.TimeoutException:
        raise RuntimeError(f"Request to {MODEL_URL}{path} timed out.")


async def _post(path: str, params: dict[str, Any] | None = None) -> str:
    """POST with no body (scenario convenience endpoint); returns plain-text job id."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{MODEL_URL}{path}", params=params)
            r.raise_for_status()
            return r.text.strip().strip('"')
    except httpx.ConnectError:
        raise RuntimeError(
            f"Model unreachable at {MODEL_URL}. "
            "Start the Quarkus solver first: make model"
        )
    except httpx.HTTPStatusError as e:
        raise RuntimeError(
            f"Model returned HTTP {e.response.status_code}: "
            f"{e.response.text[:300]}"
        )
    except httpx.TimeoutException:
        raise RuntimeError(f"POST {MODEL_URL}{path} timed out.")


async def _delete(path: str) -> Any:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.delete(f"{MODEL_URL}{path}")
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            if "json" in ct:
                return r.json()
            return r.text
    except httpx.ConnectError:
        raise RuntimeError(
            f"Model unreachable at {MODEL_URL}. "
            "Start the Quarkus solver first: make model"
        )
    except httpx.HTTPStatusError as e:
        raise RuntimeError(
            f"Model returned HTTP {e.response.status_code}: "
            f"{e.response.text[:300]}"
        )
    except httpx.TimeoutException:
        raise RuntimeError(f"DELETE {MODEL_URL}{path} timed out.")


async def _poll_until_done(
    job_id: str,
    extra_wait: float = 30.0,
    poll_interval: float = 2.0,
) -> dict:
    """
    Poll /schedules/{id}/status until the solver is no longer active, then
    fetch and return the full /schedules/{id} response.

    extra_wait: seconds beyond the solver's own time limit before we give up.
    """
    deadline = time.monotonic() + extra_wait
    while time.monotonic() < deadline:
        status_obj = await _get(f"/schedules/{job_id}/status")
        status = str(status_obj.get("status", ""))
        if status not in ("SOLVING_ACTIVE", "SOLVING_SCHEDULED"):
            break
        await asyncio.sleep(poll_interval)
    return await _get(f"/schedules/{job_id}")


def _dumps(obj: Any) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
async def list_scenarios() -> str:
    """List the scenario names available on the solver service.

    Returns a JSON array of strings, e.g. ["tiny","normal","burnout",...].
    Each name can be passed to solve_schedule or compare_presets.
    """
    names = await _get("/demo-data")
    return _dumps(names)


@mcp.tool()
async def solve_schedule(
    scenario: str,
    preset: str = "health-first",
    time_limit_seconds: int = 30,
    wait: bool = True,
) -> str:
    """Start solving a named scenario and optionally wait for the result.

    Args:
        scenario: Scenario name from list_scenarios (e.g. "burnout").
        preset: Constraint weight preset — "health-first" (default), "balanced",
                or "cost-first".
        time_limit_seconds: Solver time budget in seconds (5–60).
        wait: If True, poll until solving completes and return the plan summary.
              If False, return the job id immediately for later polling.

    Returns compact JSON: job id (wait=False) or plan summary (wait=True).
    """
    limit = max(5, min(60, time_limit_seconds))
    job_id = await _post(
        f"/schedules/scenario/{scenario}",
        params={"preset": preset, "limitSeconds": limit},
    )
    if not wait:
        return _dumps({"jobId": job_id})

    data = await _poll_until_done(job_id, extra_wait=limit + 30)
    summary = company_summary(data)
    summary["jobId"] = job_id
    summary["atRiskEmployees"] = top_at_risk_employees(data)
    summary["unassignedByReason"] = unassigned_by_reason(data)
    return _dumps(summary)


@mcp.tool()
async def get_plan_summary(job_id: str) -> str:
    """Get the current plan summary for a solve job.

    Returns: score, status, company KPIs, top-5 at-risk employees,
    and unassigned task counts by reason. Never dumps individual tasks.

    Args:
        job_id: Job id returned by solve_schedule or compare_presets.
    """
    data = await _get(f"/schedules/{job_id}")
    summary = company_summary(data)
    summary["atRiskEmployees"] = top_at_risk_employees(data)
    summary["unassignedByReason"] = unassigned_by_reason(data)
    return _dumps(summary)


@mcp.tool()
async def get_employee_schedule(job_id: str, employee_id: str) -> str:
    """Get one employee's schedule, KPIs and tasks from a solved plan.

    Returns hours per day, consecutive days, labor cost, profit, and up to
    20 assigned tasks (id, name, start, duration). Never dumps other employees.

    Args:
        job_id: Job id returned by solve_schedule.
        employee_id: Employee id in "E-NNN" format (e.g. "E-001").
    """
    data = await _get(f"/schedules/{job_id}")
    detail = employee_schedule(data, employee_id)
    if detail is None:
        return _dumps({"error": f"Employee '{employee_id}' not found in job {job_id}."})
    return _dumps(detail)


@mcp.tool()
async def explain_score(job_id: str) -> str:
    """Return the broken-constraints list for a solve job.

    Shows constraint name, level (HARD/MEDIUM/SOFT), match count and score
    contribution. Hard constraints appear first. A healthy plan shows 0 hard.

    Args:
        job_id: Job id returned by solve_schedule.
    """
    data = await _get(f"/schedules/{job_id}")
    constraints = broken_constraints_list(data)
    return _dumps({
        "score": data.get("score"),
        "preset": data.get("preset"),
        "brokenConstraints": constraints,
        "hardCount": sum(1 for c in constraints if str(c.get("level", "")).upper() == "HARD"),
    })


@mcp.tool()
async def compare_presets(
    scenario: str,
    presets: list[str] | None = None,
    time_limit_seconds: int = 10,
) -> str:
    """Solve one scenario under multiple constraint presets and compare KPIs.

    Solves sequentially (one preset at a time) and returns a side-by-side
    table of company KPIs plus deltas relative to the first preset.

    Args:
        scenario: Scenario name from list_scenarios (e.g. "burnout").
        presets: List of preset names to compare. Defaults to
                 ["cost-first", "health-first"].
        time_limit_seconds: Solver budget per preset in seconds (5–60).
    """
    if not presets:
        presets = ["cost-first", "health-first"]

    limit = max(5, min(60, time_limit_seconds))
    results: dict[str, dict] = {}

    for preset in presets:
        job_id = await _post(
            f"/schedules/scenario/{scenario}",
            params={"preset": preset, "limitSeconds": limit},
        )
        data = await _poll_until_done(job_id, extra_wait=limit + 30)
        summary = company_summary(data)
        summary["jobId"] = job_id
        results[preset] = summary

    # Deltas are always relative to the first preset
    base_key = presets[0]
    base = results[base_key]
    deltas: dict[str, dict] = {}
    for preset, summary in results.items():
        if preset != base_key:
            deltas[preset] = kpi_delta(base, summary)

    return _dumps({
        "scenario": scenario,
        "presetsRun": presets,
        "results": results,
        "deltasVs": base_key,
        "deltas": deltas,
    })


@mcp.tool()
async def stop_solving(job_id: str) -> str:
    """Stop an in-progress solve and return the current best plan summary.

    Args:
        job_id: Job id returned by solve_schedule with wait=False.
    """
    raw = await _delete(f"/schedules/{job_id}")
    # DELETE returns the current best schedule (with or without KPIs).
    # If the response already has kpis, summarise it directly.
    if isinstance(raw, dict) and raw.get("kpis"):
        return _dumps(company_summary(raw))
    # Otherwise the job was already done; the returned value is informational.
    return _dumps({"jobId": job_id, "stopped": True, "response": str(raw)[:500]})


# ---------------------------------------------------------------------------
# Resource
# ---------------------------------------------------------------------------

@mcp.resource("prd://summary", mime_type="text/plain")
def prd_summary() -> str:
    """Short plain-text summary of the problem and constraints.

    Describes the Japanese Work-Life Balancer scheduling problem,
    its hard/medium/soft constraints, and the available presets.
    """
    return """\
Japanese Work-Life Balancer — Problem Summary
=============================================

PROBLEM
Assign office tasks to employees for a 7-day work week without violating
labour laws or employee health boundaries, while optimising for one of three
business priorities.

HARD CONSTRAINTS (never violated)
- Required skills: employee must have all skills the task needs
- Availability: task must fall inside the employee's available time window
- Approved holiday: no tasks on an employee's approved holiday
- Public holiday: no tasks on public holidays
- Task within shift: tasks must start ≥ 09:00 and end ≤ 17:00
- One task at a time: no overlapping tasks for the same employee
- Max hours per day: per-employee daily hour cap
- Max hours per week: per-employee weekly hour cap
- Minimum rest: required gap between shift ends and next shift start

MEDIUM CONSTRAINTS
- Unassigned task: prefer all tasks to be covered (1 penalty per unassigned)

SOFT CONSTRAINTS (weights differ by preset)
- Idle hours: minimise unutilised available time
- Labor cost: minimise wage spend (per ¥100)
- Requested day off: respect soft day-off wishes (480 min penalty per date)
- Avoided hours: avoid time windows the employee prefers not to work
- Consecutive days risk: penalise runs of 3+ consecutive days ((L-2)×480)

PRESETS
- health-first (default): highest weight on consecutive days risk and
  requested days off; chosen to protect employee wellbeing.
- balanced: equal weights across all soft constraints (PRD baseline).
- cost-first: highest weights on idle hours and labour cost; consecutive
  days risk weight is 0 (reported only), reproducing the original PRD
  cost-only behaviour.

SCENARIOS
tiny, normal, overloaded, holiday, burnout
(Use list_scenarios to confirm which are loaded.)

KPI FIELDS
Company: healthyShare, atRiskCount, avgConsecutiveDays, totalLaborCost,
         totalRevenue, companyProfit, idleHoursTotal, unassignedCount,
         assignedTaskHours, employeesWorking
Per employee: totalHours, idleHours, hoursPerDay, laborCost, revenue,
              profit, daysWorked, maxConsecutiveDays, atRisk

MONEY
All monetary values are in JPY. The UI converts to USD/GBP with mock FX rates.
"""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    mcp.run(
        transport="streamable-http",
        host="0.0.0.0",
        port=8765,
        streamable_http_path="/mcp",
    )


if __name__ == "__main__":
    main()
