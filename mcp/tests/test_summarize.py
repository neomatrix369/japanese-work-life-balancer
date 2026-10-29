"""
Author: swami / sadhak001@gmail.com
Created: 2026-10-29
Scope: Unit tests for mcp/summarize.py pure functions.
       Tests use both hand-crafted fixture dicts and the real API sample
       fixture (mcp/tests/fixtures/sample_response.json) — no HTTP, no
       running model.
"""

import json
import sys
import os

# Allow importing summarize from the parent mcp/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from summarize import (
    broken_constraints_list,
    company_summary,
    employee_detail,
    employee_schedule,
    get_employee_map,
    kpi_delta,
    top_at_risk_employees,
    unassigned_by_reason,
    unassigned_total,
)

# ---------------------------------------------------------------------------
# Real API fixture (sample_response.json)
# ---------------------------------------------------------------------------

_FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "sample_response.json")

with open(_FIXTURE_PATH) as _f:
    SAMPLE_RESPONSE: dict = json.load(_f)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

KPIS_FIXTURE = {
    "healthyShare": 0.6,
    "atRiskCount": 2,
    "avgConsecutiveDays": 1.8,
    "idleHoursTotal": 32,
    "employeesWorking": 5,
    "totalLaborCost": 150000,
    "totalRevenue": 280000,
    "companyProfit": 130000,
    "unassignedCount": 3,
    "assignedTaskHours": 40,
}

PER_EMPLOYEE_LIST = [
    {
        "id": "E-001",
        "totalHours": 36,
        "idleHours": 4,
        "hoursPerDay": {"2026-11-09": 8, "2026-11-10": 8, "2026-11-11": 8, "2026-11-12": 6, "2026-11-13": 6},
        "laborCost": 60000,
        "revenue": 110000,
        "profit": 50000,
        "daysWorked": 5,
        "maxConsecutiveDays": 5,
        "atRisk": True,
    },
    {
        "id": "E-002",
        "totalHours": 16,
        "idleHours": 8,
        "hoursPerDay": {"2026-11-09": 8, "2026-11-10": 8},
        "laborCost": 30000,
        "revenue": 55000,
        "profit": 25000,
        "daysWorked": 2,
        "maxConsecutiveDays": 2,
        "atRisk": False,
    },
    {
        "id": "E-003",
        "totalHours": 24,
        "idleHours": 0,
        "hoursPerDay": {"2026-11-09": 8, "2026-11-10": 8, "2026-11-11": 8},
        "laborCost": 45000,
        "revenue": 90000,
        "profit": 45000,
        "daysWorked": 3,
        "maxConsecutiveDays": 3,
        "atRisk": True,
    },
]

PER_EMPLOYEE_MAP = {emp["id"]: emp for emp in PER_EMPLOYEE_LIST}

TASKS_FIXTURE = [
    {
        "id": "T-0001",
        "name": "Invoice reconciliation",
        "start": "2026-11-09T09:00:00",
        "durationMinutes": 120,
        "requiredSkills": ["accounting"],
        "employee": "E-001",
        "pinned": False,
    },
    {
        "id": "T-0002",
        "name": "VPN ticket",
        "start": "2026-11-09T13:00:00",
        "durationMinutes": 60,
        "requiredSkills": ["it-support"],
        "employee": "E-002",
        "pinned": False,
    },
    {
        "id": "T-0003",
        "name": "Expense review",
        "start": "2026-11-10T10:00:00",
        "durationMinutes": 90,
        "requiredSkills": ["accounting"],
        "employee": "E-001",
        "pinned": True,
    },
    {
        "id": "T-0004",
        "name": "Laptop setup",
        "start": "2026-11-10T14:00:00",
        "durationMinutes": 60,
        "requiredSkills": ["it-support"],
        "employee": None,  # unassigned
        "pinned": False,
    },
]

BROKEN_CONSTRAINTS_FIXTURE = [
    {"name": "Consecutive days risk", "level": "SOFT", "matchCount": 2, "score": "-960soft"},
    {"name": "Max hours per week", "level": "HARD", "matchCount": 1, "score": "-120hard"},
    {"name": "Requested day off", "level": "SOFT", "matchCount": 1, "score": "-480soft"},
]

UNASSIGNED_FIXTURE = [
    {"taskId": "T-0004", "reason": "NO_SKILLED_EMPLOYEE", "description": "No employee has all of: it-support"},
    {"taskId": "T-0005", "reason": "CAPACITY", "description": "All eligible employees are at their limits"},
    {"taskId": "T-0006", "reason": "CAPACITY", "description": "All eligible employees are at their limits"},
]

FULL_RESPONSE = {
    "schedule": {
        "weekStart": "2026-11-09",
        "tasks": TASKS_FIXTURE,
        "employees": [],
    },
    "kpis": KPIS_FIXTURE,
    "perEmployee": PER_EMPLOYEE_LIST,
    "unassigned": UNASSIGNED_FIXTURE,
    "brokenConstraints": BROKEN_CONSTRAINTS_FIXTURE,
    "preset": "health-first",
    "status": "NOT_SOLVING",
    "score": "0hard/0medium/-1440soft",
}


# ---------------------------------------------------------------------------
# Tests: get_employee_map
# ---------------------------------------------------------------------------

class TestGetEmployeeMap:
    """Scenario: normalise perEmployee from list and map forms."""

    def test_list_form_indexes_by_id(self):
        # Given: perEmployee is a list with id fields
        # When: get_employee_map is called
        result = get_employee_map(FULL_RESPONSE)
        # Then: keys are employee ids
        assert set(result.keys()) == {"E-001", "E-002", "E-003"}
        assert result["E-001"]["totalHours"] == 36

    def test_map_form_passes_through(self):
        # Given: perEmployee is already a dict
        data = {**FULL_RESPONSE, "perEmployee": PER_EMPLOYEE_MAP}
        # When: get_employee_map is called
        result = get_employee_map(data)
        # Then: same mapping returned
        assert result["E-002"]["daysWorked"] == 2

    def test_missing_per_employee_returns_empty(self):
        # Given: no perEmployee key
        # When:
        result = get_employee_map({})
        # Then: empty dict
        assert result == {}

    def test_none_per_employee_returns_empty(self):
        # Given: perEmployee is None
        result = get_employee_map({"perEmployee": None})
        assert result == {}


# ---------------------------------------------------------------------------
# Tests: company_summary
# ---------------------------------------------------------------------------

class TestCompanySummary:
    """Scenario: extract compact company KPIs from the full response."""

    def test_extracts_all_kpi_fields(self):
        # Given: a full response with kpis
        # When:
        result = company_summary(FULL_RESPONSE)
        # Then: all expected fields are present
        assert result["status"] == "NOT_SOLVING"
        assert result["score"] == "0hard/0medium/-1440soft"
        assert result["preset"] == "health-first"
        assert result["totalLaborCost"] == 150000
        assert result["companyProfit"] == 130000
        assert result["healthyShare"] == 0.6
        assert result["atRiskCount"] == 2

    def test_missing_kpis_returns_none_values(self):
        # Given: response with no kpis field
        # When:
        result = company_summary({"status": "NOT_SOLVING"})
        # Then: numeric fields are None, status is present
        assert result["status"] == "NOT_SOLVING"
        assert result["totalLaborCost"] is None


# ---------------------------------------------------------------------------
# Tests: top_at_risk_employees
# ---------------------------------------------------------------------------

class TestTopAtRiskEmployees:
    """Scenario: return at-risk employees sorted by consecutive days."""

    def test_returns_only_at_risk(self):
        # Given: E-001 and E-003 are at risk, E-002 is not
        # When:
        result = top_at_risk_employees(FULL_RESPONSE)
        # Then: only at-risk employees appear
        ids = [e["id"] for e in result]
        assert "E-002" not in ids
        assert "E-001" in ids
        assert "E-003" in ids

    def test_sorted_by_consecutive_days_desc(self):
        # Given: E-001 has 5 days, E-003 has 3
        # When:
        result = top_at_risk_employees(FULL_RESPONSE)
        # Then: E-001 appears first
        assert result[0]["id"] == "E-001"
        assert result[0]["maxConsecutiveDays"] == 5

    def test_respects_n_limit(self):
        # Given: n=1
        # When:
        result = top_at_risk_employees(FULL_RESPONSE, n=1)
        # Then: only 1 employee returned
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Tests: unassigned_by_reason
# ---------------------------------------------------------------------------

class TestUnassignedByReason:
    """Scenario: count unassigned tasks by reason code."""

    def test_counts_by_reason(self):
        # Given: 1 NO_SKILLED_EMPLOYEE and 2 CAPACITY
        # When:
        result = unassigned_by_reason(FULL_RESPONSE)
        # Then: correct counts
        assert result["NO_SKILLED_EMPLOYEE"] == 1
        assert result["CAPACITY"] == 2

    def test_empty_unassigned_returns_empty_dict(self):
        # Given: no unassigned tasks
        data = {**FULL_RESPONSE, "unassigned": []}
        # When:
        result = unassigned_by_reason(data)
        # Then: empty
        assert result == {}

    def test_none_unassigned_returns_empty_dict(self):
        result = unassigned_by_reason({"unassigned": None})
        assert result == {}


# ---------------------------------------------------------------------------
# Tests: employee_detail
# ---------------------------------------------------------------------------

class TestEmployeeDetail:
    """Scenario: look up raw per-employee record by id."""

    def test_returns_correct_employee(self):
        # Given: E-002 is in perEmployee
        # When:
        result = employee_detail(FULL_RESPONSE, "E-002")
        # Then: the right record is returned
        assert result is not None
        assert result["daysWorked"] == 2
        assert result["atRisk"] is False

    def test_unknown_id_returns_none(self):
        # Given: E-999 does not exist
        # When:
        result = employee_detail(FULL_RESPONSE, "E-999")
        # Then: None
        assert result is None


# ---------------------------------------------------------------------------
# Tests: employee_schedule
# ---------------------------------------------------------------------------

class TestEmployeeSchedule:
    """Scenario: build compact schedule for one employee including their tasks."""

    def test_returns_kpis_and_tasks(self):
        # Given: E-001 has two tasks in TASKS_FIXTURE
        # When:
        result = employee_schedule(FULL_RESPONSE, "E-001")
        # Then: KPIs and exactly 2 tasks
        assert result is not None
        assert result["totalHours"] == 36
        assert result["atRisk"] is True
        assert result["taskCount"] == 2
        task_ids = {t["id"] for t in result["tasks"]}
        assert task_ids == {"T-0001", "T-0003"}

    def test_excludes_other_employees_tasks(self):
        # Given: E-002 only has T-0002
        # When:
        result = employee_schedule(FULL_RESPONSE, "E-002")
        # Then: only T-0002
        assert result["taskCount"] == 1
        assert result["tasks"][0]["id"] == "T-0002"

    def test_unassigned_tasks_not_included(self):
        # Given: T-0004 has employee=None
        # When: we look at E-001 (should have 2 tasks, not T-0004)
        result = employee_schedule(FULL_RESPONSE, "E-001")
        task_ids = {t["id"] for t in result["tasks"]}
        assert "T-0004" not in task_ids

    def test_unknown_employee_returns_none(self):
        # Given: E-999 does not exist
        # When:
        result = employee_schedule(FULL_RESPONSE, "E-999")
        # Then: None
        assert result is None


# ---------------------------------------------------------------------------
# Tests: broken_constraints_list
# ---------------------------------------------------------------------------

class TestBrokenConstraintsList:
    """Scenario: extract and order broken constraints, hard first."""

    def test_hard_constraint_comes_first(self):
        # Given: SOFT, HARD, SOFT in the fixture
        # When:
        result = broken_constraints_list(FULL_RESPONSE)
        # Then: HARD first
        assert result[0]["level"] == "HARD"
        assert result[0]["name"] == "Max hours per week"

    def test_all_three_constraints_returned(self):
        # Given: 3 broken constraints
        # When:
        result = broken_constraints_list(FULL_RESPONSE)
        # Then: all 3 returned
        assert len(result) == 3


# ---------------------------------------------------------------------------
# Tests: kpi_delta
# ---------------------------------------------------------------------------

class TestKpiDelta:
    """Scenario: compute numeric deltas between two company summaries."""

    def test_positive_delta_when_other_is_higher(self):
        # Given: base has atRiskCount=2, other has 4
        base = company_summary(FULL_RESPONSE)
        base["atRiskCount"] = 2
        other = {**base, "atRiskCount": 4}
        # When:
        delta = kpi_delta(base, other)
        # Then: delta is +2
        assert delta["atRiskCount"] == 2.0

    def test_negative_delta_when_other_is_lower(self):
        # Given: base has totalLaborCost=150000, other has 100000
        base = company_summary(FULL_RESPONSE)
        other = {**base, "totalLaborCost": 100000}
        # When:
        delta = kpi_delta(base, other)
        # Then: delta is -50000
        assert delta["totalLaborCost"] == -50000.0

    def test_none_when_field_missing_in_either(self):
        # Given: other has no healthyShare
        base = company_summary(FULL_RESPONSE)
        other = {**base}
        del other["healthyShare"]
        # When:
        delta = kpi_delta(base, other)
        # Then: None for that field
        assert delta["healthyShare"] is None


# ===========================================================================
# Real-API fixture tests (sample_response.json)
# ===========================================================================

class TestRealFixtureGetEmployeeMap:
    """
    Scenario: get_employee_map handles the real API shape where perEmployee
    is a list of objects with employeeId (not id).
    """

    def test_returns_8_employees(self):
        ### Given: sample_response.json with 8 employees in perEmployee
        ### When: get_employee_map is called
        result = get_employee_map(SAMPLE_RESPONSE)
        ### Then: all 8 employees are indexed by their id
        assert len(result) == 8

    def test_keys_match_employee_ids(self):
        ### Given: perEmployee uses employeeId field
        ### When:
        result = get_employee_map(SAMPLE_RESPONSE)
        ### Then: expected ids are all present
        expected_ids = {"E-001", "E-002", "E-003", "E-004", "E-005", "E-006", "E-007", "E-008"}
        assert set(result.keys()) == expected_ids

    def test_name_is_accessible(self):
        ### Given: each perEmployee entry has a name field
        ### When:
        result = get_employee_map(SAMPLE_RESPONSE)
        ### Then: name is accessible via the map
        assert result["E-008"]["name"] == "Sakamoto Rin"
        assert result["E-001"]["name"] == "Aoki Haruto"


class TestRealFixtureCompanySummary:
    """
    Scenario: company_summary extracts the correct KPIs from the real API response.
    """

    def test_at_risk_count_is_5(self):
        ### Given: sample response with kpis.atRiskCount == 5
        ### When:
        result = company_summary(SAMPLE_RESPONSE)
        ### Then:
        assert result["atRiskCount"] == 5

    def test_employees_working_is_8(self):
        ### Given: kpis.employeesWorking == 8
        ### When:
        result = company_summary(SAMPLE_RESPONSE)
        ### Then:
        assert result["employeesWorking"] == 8

    def test_unassigned_count_is_10(self):
        ### Given: kpis.unassignedCount == 10
        ### When:
        result = company_summary(SAMPLE_RESPONSE)
        ### Then:
        assert result["unassignedCount"] == 10

    def test_score_string(self):
        ### Given: top-level score field in the real response
        ### When:
        result = company_summary(SAMPLE_RESPONSE)
        ### Then: score parses correctly
        assert result["score"] == "0hard/-10medium/-67364soft"

    def test_status_not_solving(self):
        ### Given: status field
        ### When:
        result = company_summary(SAMPLE_RESPONSE)
        ### Then:
        assert result["status"] == "NOT_SOLVING"


class TestRealFixtureTopAtRisk:
    """
    Scenario: top_at_risk_employees identifies the 5 at-risk employees from
    the real response and includes their names.
    """

    def test_returns_5_at_risk_employees(self):
        ### Given: perEmployee contains 5 entries where atRisk == True
        ### When:
        result = top_at_risk_employees(SAMPLE_RESPONSE)
        ### Then: exactly 5 employees returned
        assert len(result) == 5

    def test_at_risk_ids_correct(self):
        ### Given: real response
        ### When:
        result = top_at_risk_employees(SAMPLE_RESPONSE)
        ### Then: correct set of at-risk employee ids
        ids = {e["id"] for e in result}
        assert ids == {"E-001", "E-002", "E-004", "E-007", "E-008"}

    def test_name_included_in_output(self):
        ### Given: name field is present in perEmployee records
        ### When:
        result = top_at_risk_employees(SAMPLE_RESPONSE)
        ### Then: every entry has a non-None name
        for entry in result:
            assert entry["name"] is not None, f"name missing for {entry['id']}"

    def test_sorted_by_consecutive_days_desc(self):
        ### Given: E-008 has maxConsecutiveDays==8, highest of all at-risk
        ### When:
        result = top_at_risk_employees(SAMPLE_RESPONSE)
        ### Then: E-008 is first
        assert result[0]["id"] == "E-008"
        assert result[0]["maxConsecutiveDays"] == 8
        assert result[0]["name"] == "Sakamoto Rin"


class TestRealFixtureUnassignedByReason:
    """
    Scenario: unassigned_by_reason counts correctly from the real response,
    and the total matches kpis.unassignedCount.
    """

    def test_all_reasons_are_capacity(self):
        ### Given: all 10 unassigned tasks have reason CAPACITY
        ### When:
        result = unassigned_by_reason(SAMPLE_RESPONSE)
        ### Then: only CAPACITY key present
        assert set(result.keys()) == {"CAPACITY"}

    def test_capacity_count_is_10(self):
        ### Given: 10 unassigned tasks
        ### When:
        result = unassigned_by_reason(SAMPLE_RESPONSE)
        ### Then:
        assert result["CAPACITY"] == 10

    def test_total_matches_kpis_unassigned_count(self):
        ### Given: kpis.unassignedCount == 10
        ### When:
        total = unassigned_total(SAMPLE_RESPONSE)
        kpi_count = SAMPLE_RESPONSE["kpis"]["unassignedCount"]
        ### Then: they agree
        assert total == kpi_count

    def test_reason_counts_sum_to_unassigned_count(self):
        ### Given: unassigned_by_reason returns counts per reason
        ### When:
        counts = unassigned_by_reason(SAMPLE_RESPONSE)
        ### Then: sum of all reason counts equals kpis.unassignedCount
        assert sum(counts.values()) == SAMPLE_RESPONSE["kpis"]["unassignedCount"]


class TestRealFixtureEmployeeSchedule:
    """
    Scenario: employee_schedule returns name + correct tasks from the real
    response (schedule.tasks filtered by employee id).
    """

    def test_e008_has_name(self):
        ### Given: E-008 is "Sakamoto Rin"
        ### When:
        result = employee_schedule(SAMPLE_RESPONSE, "E-008")
        ### Then:
        assert result is not None
        assert result["name"] == "Sakamoto Rin"

    def test_e008_task_count(self):
        ### Given: schedule.tasks has tasks assigned to E-008
        ### When:
        result = employee_schedule(SAMPLE_RESPONSE, "E-008")
        ### Then: count matches tasks in fixture assigned to E-008
        tasks_e008 = [
            t for t in SAMPLE_RESPONSE["schedule"]["tasks"]
            if t.get("employee") == "E-008"
        ]
        assert result["taskCount"] == len(tasks_e008)

    def test_e008_hours_match_per_employee(self):
        ### Given: perEmployee E-008 totalHours == 36.5
        ### When:
        result = employee_schedule(SAMPLE_RESPONSE, "E-008")
        ### Then:
        assert result["totalHours"] == 36.5

    def test_e008_at_risk(self):
        ### Given: E-008 atRisk == True
        ### When:
        result = employee_schedule(SAMPLE_RESPONSE, "E-008")
        ### Then:
        assert result["atRisk"] is True

    def test_employee_id_in_result(self):
        ### Given: any valid employee
        ### When:
        result = employee_schedule(SAMPLE_RESPONSE, "E-001")
        ### Then: employeeId echoed back
        assert result["employeeId"] == "E-001"
        assert result["name"] == "Aoki Haruto"

    def test_unknown_employee_returns_none(self):
        ### Given: E-999 not in the fixture
        ### When:
        result = employee_schedule(SAMPLE_RESPONSE, "E-999")
        ### Then:
        assert result is None


class TestRealFixtureBrokenConstraints:
    """
    Scenario: broken_constraints_list processes the real response where
    score is an integer (not a string) and matchCount may be null.
    """

    def test_returns_all_5_constraints(self):
        ### Given: 5 entries in brokenConstraints
        ### When:
        result = broken_constraints_list(SAMPLE_RESPONSE)
        ### Then: all 5 are returned
        assert len(result) == 5

    def test_medium_constraint_comes_before_soft(self):
        ### Given: "Unassigned task" is MEDIUM, rest are SOFT
        ### When:
        result = broken_constraints_list(SAMPLE_RESPONSE)
        ### Then: first entry is MEDIUM
        assert result[0]["level"] == "MEDIUM"
        assert result[0]["name"] == "Unassigned task"

    def test_null_match_count_is_tolerated(self):
        ### Given: matchCount is null in the real response
        ### When:
        result = broken_constraints_list(SAMPLE_RESPONSE)
        ### Then: none raise, matchCount is None
        for c in result:
            assert "matchCount" in c  # key present; value may be None

    def test_integer_scores_are_included(self):
        ### Given: scores are integers like -10, -57600
        ### When:
        result = broken_constraints_list(SAMPLE_RESPONSE)
        ### Then: all have non-zero score
        for c in result:
            assert c.get("score") not in (0, "0", None, "0hard/0medium/0soft")
