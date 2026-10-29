package org.acme.employeescheduling.kpi;

import java.time.LocalDateTime;
import java.util.List;
import java.util.TreeSet;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.Task;
import org.acme.employeescheduling.domain.WorkSchedule;

/** Explains why a task stayed unassigned. First matching reason wins. */
public final class UnassignedReasoner {

    public record UnassignedTask(String taskId, String name, LocalDateTime start, int durationMinutes,
            List<String> requiredSkills, String reason, String message) {
    }

    private UnassignedReasoner() {
    }

    public static List<UnassignedTask> explain(WorkSchedule schedule) {
        return schedule.getTasks().stream()
                .filter(task -> task.getEmployee() == null)
                .map(task -> explain(schedule, task))
                .toList();
    }

    static UnassignedTask explain(WorkSchedule schedule, Task task) {
        String reason;
        String message;
        List<Employee> skilled = schedule.getEmployees().stream()
                .filter(e -> e.hasAllSkills(task.getRequiredSkills()))
                .toList();
        if (schedule.getPublicHolidays().contains(task.date())) {
            reason = "PUBLIC_HOLIDAY";
            message = "Task falls on a public holiday";
        } else if (skilled.isEmpty()) {
            reason = "NO_SKILLED_EMPLOYEE";
            message = "No employee has all of: " + String.join(", ", new TreeSet<>(task.getRequiredSkills()));
        } else if (skilled.stream().noneMatch(e -> e.isAvailable(task.getStart(), task.end()))) {
            reason = "NO_SKILLED_EMPLOYEE_AVAILABLE";
            message = "No skilled employee is available at that time";
        } else {
            reason = "CAPACITY";
            message = "All eligible employees are at their limits or busy";
        }
        return new UnassignedTask(task.getId(), task.getName(), task.getStart(), task.getDurationMinutes(),
                List.copyOf(new TreeSet<>(task.getRequiredSkills())), reason, message);
    }
}
