package org.acme.employeescheduling.kpi;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.Retention;
import org.acme.employeescheduling.domain.Task;
import org.acme.employeescheduling.domain.WorkSchedule;
import org.acme.employeescheduling.solver.ConsecutiveDays;

/** Plain-Java KPIs computed from a (solved or partially solved) schedule. Money in integer JPY. */
public final class KpiCalculator {

    public record EmployeeKpis(
            String employeeId,
            String name,
            Map<String, Double> hoursPerDay,
            Map<String, Integer> runDayPerDate,
            double totalHours,
            double idleHours,
            long laborCost,
            long revenue,
            long profit,
            int daysWorked,
            int maxConsecutiveDays,
            boolean atRisk,
            int holidaysTakenThisWeek,
            int holidaysRemainingAfter,
            int maxHoursPerDay,
            int maxHoursPerWeek,
            double tenureYears,
            int unplannedAbsenceDays3m) {
    }

    public record CompanyKpis(
            long totalLaborCost,
            long totalRevenue,
            long companyProfit,
            double idleHoursTotal,
            int unassignedCount,
            double assignedTaskHours,
            double healthyShare,
            double avgConsecutiveDays,
            int atRiskCount,
            int employeesWorking) {
    }

    public record Longevity(
            double avgTenureYears,
            int totalUnplannedAbsenceDays,
            double avgUnplannedAbsenceDays,
            Retention retention) {
    }

    public record Result(
            CompanyKpis kpis,
            List<EmployeeKpis> perEmployee,
            Map<String, List<String>> shifts,
            Longevity longevity) {
    }

    private KpiCalculator() {
    }

    public static Result calculate(WorkSchedule schedule) {
        LocalDate weekStart = schedule.getWeekStart();
        List<LocalDate> week = schedule.weekDates();
        Set<LocalDate> publicHolidays = new HashSet<>(schedule.getPublicHolidays());

        Map<Employee, List<Task>> tasksByEmployee = new HashMap<>();
        int unassigned = 0;
        for (Task task : schedule.getTasks()) {
            if (task.getEmployee() == null) {
                unassigned++;
            } else {
                tasksByEmployee.computeIfAbsent(task.getEmployee(), e -> new ArrayList<>()).add(task);
            }
        }

        Map<String, List<String>> shifts = new LinkedHashMap<>();
        week.forEach(date -> shifts.put(date.toString(), new ArrayList<>()));

        List<EmployeeKpis> perEmployee = new ArrayList<>();
        long totalLabor = 0;
        long totalRevenue = 0;
        double idleTotal = 0;
        long assignedMinutes = 0;
        int atRiskCount = 0;
        int working = 0;
        long consecutiveSum = 0;

        for (Employee employee : schedule.getEmployees()) {
            List<Task> tasks = tasksByEmployee.getOrDefault(employee, List.of());
            Map<LocalDate, Long> minutesPerDate = new HashMap<>();
            long laborCost = 0;
            long revenue = 0;
            long minutes = 0;
            for (Task task : tasks) {
                minutesPerDate.merge(task.date(), (long) task.getDurationMinutes(), Long::sum);
                minutes += task.getDurationMinutes();
                laborCost += Math.round(employee.getHourlyRate() * task.getDurationMinutes() / 60.0);
                revenue += Math.round(employee.getBillingRate() * task.getDurationMinutes() / 60.0);
            }

            Map<String, Double> hoursPerDay = new LinkedHashMap<>();
            Set<Integer> workedDays = new HashSet<>();
            double idleMinutes = 0;
            for (LocalDate date : week) {
                long m = minutesPerDate.getOrDefault(date, 0L);
                hoursPerDay.put(date.toString(), hours(m));
                if (m > 0) {
                    workedDays.add((int) (date.toEpochDay() - weekStart.toEpochDay()));
                    idleMinutes += Math.max(0, employee.availableMinutesOn(date) - m);
                    shifts.get(date.toString()).add(employee.getId());
                }
            }

            int carryIn = employee.getConsecutiveDaysBeforeWeek();
            int maxRun = ConsecutiveDays.maxRun(workedDays, carryIn);
            boolean atRisk = maxRun >= ConsecutiveDays.AT_RISK_DAYS;
            Map<String, Integer> runDayPerDate = new LinkedHashMap<>();
            ConsecutiveDays.positions(workedDays, carryIn)
                    .forEach((day, pos) -> runDayPerDate.put(weekStart.plusDays(day).toString(), pos));

            int holidaysTaken = (int) employee.getApprovedHolidays().stream()
                    .filter(d -> !d.isBefore(weekStart) && d.isBefore(weekStart.plusDays(7)))
                    .filter(d -> !publicHolidays.contains(d))
                    .count();

            perEmployee.add(new EmployeeKpis(
                    employee.getId(),
                    employee.getName(),
                    hoursPerDay,
                    runDayPerDate,
                    hours(minutes),
                    round2(idleMinutes / 60.0),
                    laborCost,
                    revenue,
                    revenue - laborCost,
                    workedDays.size(),
                    maxRun,
                    atRisk,
                    holidaysTaken,
                    employee.getHolidayDaysRemaining() - holidaysTaken,
                    employee.getMaxHoursPerDay(),
                    employee.getMaxHoursPerWeek(),
                    employee.getTenureYears(),
                    employee.getUnplannedAbsenceDays3m()));

            totalLabor += laborCost;
            totalRevenue += revenue;
            idleTotal += idleMinutes;
            assignedMinutes += minutes;
            consecutiveSum += maxRun;
            if (atRisk) {
                atRiskCount++;
            }
            if (!workedDays.isEmpty()) {
                working++;
            }
        }

        int employeeCount = schedule.getEmployees().size();
        CompanyKpis kpis = new CompanyKpis(
                totalLabor,
                totalRevenue,
                totalRevenue - totalLabor,
                round2(idleTotal / 60.0),
                unassigned,
                hours(assignedMinutes),
                employeeCount == 0 ? 1.0 : round4((employeeCount - atRiskCount) / (double) employeeCount),
                employeeCount == 0 ? 0.0 : round2(consecutiveSum / (double) employeeCount),
                atRiskCount,
                working);

        int totalAbsence = schedule.getEmployees().stream().mapToInt(Employee::getUnplannedAbsenceDays3m).sum();
        Longevity longevity = new Longevity(
                round2(schedule.getEmployees().stream().mapToDouble(Employee::getTenureYears).average().orElse(0)),
                totalAbsence,
                employeeCount == 0 ? 0 : round2(totalAbsence / (double) employeeCount),
                Retention.fromHistory(schedule.getEmployees(), schedule.getLeavers()));

        return new Result(kpis, perEmployee, shifts, longevity);
    }

    private static double hours(long minutes) {
        return round2(minutes / 60.0);
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static double round4(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
