package org.acme.employeescheduling.domain;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Set;

import ai.timefold.solver.core.api.domain.common.PlanningId;
import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.entity.PlanningPin;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;

import com.fasterxml.jackson.annotation.JsonIdentityReference;
import com.fasterxml.jackson.annotation.JsonIgnore;

/** Planning entity: a task with a fixed start time. The solver only decides who does it. */
@PlanningEntity
public class Task {

    @PlanningId
    private String id;
    private String name;
    private LocalDateTime start;
    private int durationMinutes;
    private Set<String> requiredSkills = Set.of();

    @PlanningVariable(allowsUnassigned = true)
    @JsonIdentityReference(alwaysAsId = true)
    private Employee employee;

    @PlanningPin
    private boolean pinned;

    // Schedule-level context copied onto each task server-side (see WorkSchedule.prepare()).
    // Not part of the JSON contract.
    @JsonIgnore
    private LocalDate weekStart;
    @JsonIgnore
    private LocalTime shiftStart = LocalTime.of(9, 0);
    @JsonIgnore
    private LocalTime shiftEnd = LocalTime.of(17, 0);
    @JsonIgnore
    private boolean onPublicHoliday;

    public Task() {
    }

    public Task(String id, LocalDateTime start, int durationMinutes, Set<String> requiredSkills, Employee employee) {
        this.id = id;
        this.name = id;
        this.start = start;
        this.durationMinutes = durationMinutes;
        this.requiredSkills = requiredSkills;
        this.employee = employee;
    }

    // ************************************************************************
    // Helpers
    // ************************************************************************

    public LocalDateTime end() {
        return start.plusMinutes(durationMinutes);
    }

    public LocalDate date() {
        return start.toLocalDate();
    }

    public int dayIndex(LocalDate weekStart) {
        return (int) ChronoUnit.DAYS.between(weekStart, date());
    }

    /** Day index relative to the stored weekStart (0 = Monday of the planning week). */
    @JsonIgnore
    public int getDayIndex() {
        return dayIndex(weekStart);
    }

    public boolean overlaps(Task other) {
        return start.isBefore(other.end()) && other.start.isBefore(end());
    }

    @JsonIgnore
    public long getShiftMinutes() {
        return ChronoUnit.MINUTES.between(shiftStart, shiftEnd);
    }

    // ************************************************************************
    // Getters and setters
    // ************************************************************************

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public LocalDateTime getStart() {
        return start;
    }

    public void setStart(LocalDateTime start) {
        this.start = start;
    }

    public int getDurationMinutes() {
        return durationMinutes;
    }

    public void setDurationMinutes(int durationMinutes) {
        this.durationMinutes = durationMinutes;
    }

    public Set<String> getRequiredSkills() {
        return requiredSkills == null ? Set.of() : requiredSkills;
    }

    public void setRequiredSkills(Set<String> requiredSkills) {
        this.requiredSkills = requiredSkills;
    }

    public Employee getEmployee() {
        return employee;
    }

    public void setEmployee(Employee employee) {
        this.employee = employee;
    }

    public boolean isPinned() {
        return pinned;
    }

    public void setPinned(boolean pinned) {
        this.pinned = pinned;
    }

    @JsonIgnore
    public LocalDate getWeekStart() {
        return weekStart;
    }

    @JsonIgnore
    public void setWeekStart(LocalDate weekStart) {
        this.weekStart = weekStart;
    }

    @JsonIgnore
    public LocalTime getShiftStart() {
        return shiftStart;
    }

    @JsonIgnore
    public void setShiftStart(LocalTime shiftStart) {
        this.shiftStart = shiftStart;
    }

    @JsonIgnore
    public LocalTime getShiftEnd() {
        return shiftEnd;
    }

    @JsonIgnore
    public void setShiftEnd(LocalTime shiftEnd) {
        this.shiftEnd = shiftEnd;
    }

    @JsonIgnore
    public boolean isOnPublicHoliday() {
        return onPublicHoliday;
    }

    @JsonIgnore
    public void setOnPublicHoliday(boolean onPublicHoliday) {
        this.onPublicHoliday = onPublicHoliday;
    }

    @Override
    public String toString() {
        return id + "@" + start;
    }

    @Override
    public boolean equals(Object o) {
        return this == o || (o instanceof Task other && Objects.equals(id, other.id));
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}
