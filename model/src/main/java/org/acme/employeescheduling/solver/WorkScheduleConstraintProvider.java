package org.acme.employeescheduling.solver;

import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.sum;
import static ai.timefold.solver.core.api.score.stream.ConstraintCollectors.toSet;
import static ai.timefold.solver.core.api.score.stream.Joiners.equal;
import static ai.timefold.solver.core.api.score.stream.Joiners.overlapping;

import java.time.LocalDate;

import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.Task;
import org.acme.employeescheduling.domain.TimeWindow;

/**
 * All constraints. Names are part of the API contract (presets, UI and MCP refer to them) — see {@link Names}.
 * Soft penalty units: minutes, except Labor cost (per ¥100). See model/README.md.
 */
public class WorkScheduleConstraintProvider implements ConstraintProvider {

    /** Constraint names, exactly as in the build spec. */
    public static final class Names {
        public static final String REQUIRED_SKILLS = "Required skills";
        public static final String AVAILABILITY = "Availability";
        public static final String APPROVED_HOLIDAY = "Approved holiday";
        public static final String PUBLIC_HOLIDAY = "Public holiday";
        public static final String TASK_WITHIN_SHIFT = "Task within shift";
        public static final String ONE_TASK_AT_A_TIME = "One task at a time";
        public static final String MAX_HOURS_PER_DAY = "Max hours per day";
        public static final String MAX_HOURS_PER_WEEK = "Max hours per week";
        public static final String MINIMUM_REST = "Minimum rest";
        public static final String UNASSIGNED_TASK = "Unassigned task";
        public static final String IDLE_HOURS = "Idle hours";
        public static final String LABOR_COST = "Labor cost";
        public static final String REQUESTED_DAY_OFF = "Requested day off";
        public static final String AVOIDED_HOURS = "Avoided hours";
        public static final String CONSECUTIVE_DAYS_RISK = "Consecutive days risk";

        public static final java.util.List<String> HARD = java.util.List.of(REQUIRED_SKILLS, AVAILABILITY,
                APPROVED_HOLIDAY, PUBLIC_HOLIDAY, TASK_WITHIN_SHIFT, ONE_TASK_AT_A_TIME, MAX_HOURS_PER_DAY,
                MAX_HOURS_PER_WEEK, MINIMUM_REST);
        public static final java.util.List<String> MEDIUM = java.util.List.of(UNASSIGNED_TASK);
        public static final java.util.List<String> SOFT = java.util.List.of(IDLE_HOURS, LABOR_COST,
                REQUESTED_DAY_OFF, AVOIDED_HOURS, CONSECUTIVE_DAYS_RISK);

        private Names() {
        }
    }

    static final long DAY_OFF_PENALTY = 480L;

    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[] {
                // Hard
                requiredSkills(factory),
                availability(factory),
                approvedHoliday(factory),
                publicHoliday(factory),
                taskWithinShift(factory),
                oneTaskAtATime(factory),
                maxHoursPerDay(factory),
                maxHoursPerWeek(factory),
                minimumRest(factory),
                // Medium
                unassignedTask(factory),
                // Soft
                idleHours(factory),
                laborCost(factory),
                requestedDayOff(factory),
                avoidedHours(factory),
                consecutiveDaysRisk(factory)
        };
    }

    // ************************************************************************
    // Hard constraints
    // ************************************************************************

    Constraint requiredSkills(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(task -> missingSkills(task) > 0)
                .penalize(HardMediumSoftScore.ONE_HARD, WorkScheduleConstraintProvider::missingSkills)
                .asConstraint(Names.REQUIRED_SKILLS);
    }

    Constraint availability(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(task -> minutesOutsideAvailability(task) > 0)
                .penalize(HardMediumSoftScore.ONE_HARD, WorkScheduleConstraintProvider::minutesOutsideAvailability)
                .asConstraint(Names.AVAILABILITY);
    }

    Constraint approvedHoliday(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(task -> task.getEmployee().getApprovedHolidays().contains(task.date()))
                .penalize(HardMediumSoftScore.ONE_HARD, Task::getDurationMinutes)
                .asConstraint(Names.APPROVED_HOLIDAY);
    }

    Constraint publicHoliday(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(Task::isOnPublicHoliday)
                .penalize(HardMediumSoftScore.ONE_HARD, Task::getDurationMinutes)
                .asConstraint(Names.PUBLIC_HOLIDAY);
    }

    Constraint taskWithinShift(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(task -> minutesOutsideShift(task) > 0)
                .penalize(HardMediumSoftScore.ONE_HARD, WorkScheduleConstraintProvider::minutesOutsideShift)
                .asConstraint(Names.TASK_WITHIN_SHIFT);
    }

    Constraint oneTaskAtATime(ConstraintFactory factory) {
        return factory.forEachUniquePair(Task.class,
                equal(Task::getEmployee),
                overlapping(Task::getStart, Task::end))
                .penalize(HardMediumSoftScore.ONE_HARD,
                        (a, b) -> TimeWindow.overlap(a.getStart(), a.end(), b.getStart(), b.end()))
                .asConstraint(Names.ONE_TASK_AT_A_TIME);
    }

    Constraint maxHoursPerDay(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .groupBy(Task::getEmployee, Task::date, sum(Task::getDurationMinutes))
                .filter((employee, date, minutes) -> minutes > employee.getMaxHoursPerDay() * 60L)
                .penalize(HardMediumSoftScore.ONE_HARD,
                        (employee, date, minutes) -> minutes - employee.getMaxHoursPerDay() * 60L)
                .asConstraint(Names.MAX_HOURS_PER_DAY);
    }

    Constraint maxHoursPerWeek(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .groupBy(Task::getEmployee, sum(Task::getDurationMinutes))
                .filter((employee, minutes) -> minutes > employee.getMaxHoursPerWeek() * 60L)
                .penalize(HardMediumSoftScore.ONE_HARD,
                        (employee, minutes) -> minutes - employee.getMaxHoursPerWeek() * 60L)
                .asConstraint(Names.MAX_HOURS_PER_WEEK);
    }

    Constraint minimumRest(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                // Only employees whose rest requirement can be broken by a fixed shift at all.
                .filter(task -> task.getEmployee().getMinRestHours() * 60L > 24L * 60L - task.getShiftMinutes())
                .groupBy(Task::getEmployee, Task::getShiftMinutes, toSet(Task::getDayIndex))
                .filter((employee, shiftMinutes, days) -> missingRest(employee, shiftMinutes, days) > 0)
                .penalize(HardMediumSoftScore.ONE_HARD, WorkScheduleConstraintProvider::missingRest)
                .asConstraint(Names.MINIMUM_REST);
    }

    // ************************************************************************
    // Medium constraints
    // ************************************************************************

    Constraint unassignedTask(ConstraintFactory factory) {
        return factory.forEachIncludingUnassigned(Task.class)
                .filter(task -> task.getEmployee() == null)
                .penalize(HardMediumSoftScore.ONE_MEDIUM)
                .asConstraint(Names.UNASSIGNED_TASK);
    }

    // ************************************************************************
    // Soft constraints
    // ************************************************************************

    Constraint idleHours(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .groupBy(Task::getEmployee, Task::date, sum(Task::getDurationMinutes))
                .filter((employee, date, minutes) -> idleMinutes(employee, date, minutes) > 0)
                .penalize(HardMediumSoftScore.ONE_SOFT, WorkScheduleConstraintProvider::idleMinutes)
                .asConstraint(Names.IDLE_HOURS);
    }

    Constraint laborCost(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .penalize(HardMediumSoftScore.ONE_SOFT, WorkScheduleConstraintProvider::laborCostPer100Yen)
                .asConstraint(Names.LABOR_COST);
    }

    Constraint requestedDayOff(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(task -> task.getEmployee().getDaysOffRequested().contains(task.date()))
                .groupBy(Task::getEmployee, Task::date)
                .penalize(HardMediumSoftScore.ONE_SOFT, (employee, date) -> DAY_OFF_PENALTY)
                .asConstraint(Names.REQUESTED_DAY_OFF);
    }

    Constraint avoidedHours(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .filter(task -> avoidedMinutes(task) > 0)
                .penalize(HardMediumSoftScore.ONE_SOFT, WorkScheduleConstraintProvider::avoidedMinutes)
                .asConstraint(Names.AVOIDED_HOURS);
    }

    Constraint consecutiveDaysRisk(ConstraintFactory factory) {
        return factory.forEach(Task.class)
                .groupBy(Task::getEmployee, toSet(Task::getDayIndex))
                .filter((employee, days) -> consecutivePenalty(employee, days) > 0)
                .penalize(HardMediumSoftScore.ONE_SOFT, WorkScheduleConstraintProvider::consecutivePenalty)
                .asConstraint(Names.CONSECUTIVE_DAYS_RISK);
    }

    // ************************************************************************
    // Pure helpers (also used by tests and KPIs)
    // ************************************************************************

    static long missingSkills(Task task) {
        return task.getRequiredSkills().stream()
                .filter(skill -> !task.getEmployee().getSkills().contains(skill))
                .count();
    }

    static long minutesOutsideAvailability(Task task) {
        TimeWindow window = task.getEmployee().windowOn(task.date());
        if (window == null) {
            return task.getDurationMinutes();
        }
        return task.getDurationMinutes() - window.overlapMinutes(task.getStart(), task.end());
    }

    static long minutesOutsideShift(Task task) {
        LocalDate date = task.date();
        long inside = TimeWindow.overlap(task.getStart(), task.end(),
                date.atTime(task.getShiftStart()), date.atTime(task.getShiftEnd()));
        return task.getDurationMinutes() - inside;
    }

    static long missingRest(Employee employee, long shiftMinutes, java.util.Set<Integer> days) {
        return ConsecutiveDays.missingRestHours(days, employee.getConsecutiveDaysBeforeWeek(),
                employee.getMinRestHours(), shiftMinutes);
    }

    static long idleMinutes(Employee employee, LocalDate date, long taskMinutes) {
        return Math.max(0, employee.availableMinutesOn(date) - taskMinutes);
    }

    public static long laborCostPer100Yen(Task task) {
        return Math.round(task.getEmployee().getHourlyRate() * task.getDurationMinutes() / 60.0 / 100.0);
    }

    static long avoidedMinutes(Task task) {
        long total = 0;
        for (TimeWindow window : task.getEmployee().getAvoidHours()) {
            if (task.date().equals(window.getDate())) {
                total += window.overlapMinutes(task.getStart(), task.end());
            }
        }
        return total;
    }

    static long consecutivePenalty(Employee employee, java.util.Set<Integer> days) {
        return ConsecutiveDays.penalty(days, employee.getConsecutiveDaysBeforeWeek());
    }
}
