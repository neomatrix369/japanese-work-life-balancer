package org.acme.employeescheduling.rest;

import java.util.List;
import java.util.Map;

import org.acme.employeescheduling.domain.WorkSchedule;
import org.acme.employeescheduling.kpi.BrokenConstraints.BrokenConstraint;
import org.acme.employeescheduling.kpi.KpiCalculator.CompanyKpis;
import org.acme.employeescheduling.kpi.KpiCalculator.EmployeeKpis;
import org.acme.employeescheduling.kpi.KpiCalculator.Longevity;
import org.acme.employeescheduling.kpi.UnassignedReasoner.UnassignedTask;

/** Response of GET /schedules/{jobId}. Field names are the API contract for the UI and MCP server. */
public record ScheduleResponse(
        WorkSchedule schedule,
        CompanyKpis kpis,
        List<EmployeeKpis> perEmployee,
        Map<String, List<String>> shifts,
        List<UnassignedTask> unassigned,
        Longevity longevity,
        List<BrokenConstraint> brokenConstraints,
        String preset,
        String status,
        String score) {

    /** Response of GET /schedules/{jobId}/status. */
    public record Status(String status, String score, String preset) {
    }
}
