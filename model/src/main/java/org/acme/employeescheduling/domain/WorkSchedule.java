package org.acme.employeescheduling.domain;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import ai.timefold.solver.core.api.domain.solution.ConstraintWeightOverrides;
import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.solver.SolverStatus;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;

/** Planning solution: one week (7 days from weekStart) of tasks to assign to employees. */
@PlanningSolution
public class WorkSchedule {

    private String name;
    private LocalDate weekStart;
    @JsonFormat(pattern = "HH:mm")
    private LocalTime shiftStart = LocalTime.of(9, 0);
    @JsonFormat(pattern = "HH:mm")
    private LocalTime shiftEnd = LocalTime.of(17, 0);
    private List<LocalDate> publicHolidays = List.of();
    private Retention retention;

    @ProblemFactCollectionProperty
    @ValueRangeProvider
    private List<Employee> employees;

    @PlanningEntityCollectionProperty
    private List<Task> tasks;

    @PlanningScore
    private HardMediumSoftScore score;

    // Detected by Timefold by type; set server-side from the requested preset, never via JSON.
    @JsonIgnore
    private ConstraintWeightOverrides<HardMediumSoftScore> constraintWeightOverrides;

    private SolverStatus solverStatus;

    public WorkSchedule() {
    }

    /**
     * Copies schedule-level context (weekStart, shift times, public holiday flag) onto each task and sets the
     * constraint weights. Call once before solving or analyzing.
     */
    public WorkSchedule prepare(ConstraintWeightOverrides<HardMediumSoftScore> overrides) {
        this.constraintWeightOverrides = overrides;
        Set<LocalDate> holidays = new HashSet<>(getPublicHolidays());
        for (Task task : getTasks()) {
            task.setWeekStart(weekStart);
            task.setShiftStart(shiftStart);
            task.setShiftEnd(shiftEnd);
            task.setOnPublicHoliday(holidays.contains(task.date()));
        }
        return this;
    }

    @JsonIgnore
    public List<LocalDate> weekDates() {
        return weekStart.datesUntil(weekStart.plusDays(7)).toList();
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public LocalDate getWeekStart() {
        return weekStart;
    }

    public void setWeekStart(LocalDate weekStart) {
        this.weekStart = weekStart;
    }

    public LocalTime getShiftStart() {
        return shiftStart;
    }

    public void setShiftStart(LocalTime shiftStart) {
        this.shiftStart = shiftStart;
    }

    public LocalTime getShiftEnd() {
        return shiftEnd;
    }

    public void setShiftEnd(LocalTime shiftEnd) {
        this.shiftEnd = shiftEnd;
    }

    public List<LocalDate> getPublicHolidays() {
        return publicHolidays == null ? List.of() : publicHolidays;
    }

    public void setPublicHolidays(List<LocalDate> publicHolidays) {
        this.publicHolidays = publicHolidays;
    }

    public Retention getRetention() {
        return retention;
    }

    public void setRetention(Retention retention) {
        this.retention = retention;
    }

    public List<Employee> getEmployees() {
        return employees == null ? List.of() : employees;
    }

    public void setEmployees(List<Employee> employees) {
        this.employees = employees;
    }

    public List<Task> getTasks() {
        return tasks == null ? List.of() : tasks;
    }

    public void setTasks(List<Task> tasks) {
        this.tasks = tasks;
    }

    public HardMediumSoftScore getScore() {
        return score;
    }

    public void setScore(HardMediumSoftScore score) {
        this.score = score;
    }

    @JsonIgnore
    public ConstraintWeightOverrides<HardMediumSoftScore> getConstraintWeightOverrides() {
        return constraintWeightOverrides;
    }

    @JsonIgnore
    public void setConstraintWeightOverrides(ConstraintWeightOverrides<HardMediumSoftScore> constraintWeightOverrides) {
        this.constraintWeightOverrides = constraintWeightOverrides;
    }

    public SolverStatus getSolverStatus() {
        return solverStatus;
    }

    public void setSolverStatus(SolverStatus solverStatus) {
        this.solverStatus = solverStatus;
    }
}
