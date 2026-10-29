package org.acme.employeescheduling.domain;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import ai.timefold.solver.core.api.domain.common.PlanningId;

import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;

/** Problem fact: a person who can be assigned tasks. All data is synthetic. */
@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")
public class Employee {

    @PlanningId
    private String id;
    private String name;
    private Set<String> skills = Set.of();
    private int hourlyRate;
    private int billingRate;
    private int maxHoursPerDay;
    private int maxHoursPerWeek;
    private int minRestHours;
    private List<TimeWindow> availability = List.of();
    private Set<LocalDate> daysOffRequested = Set.of();
    private List<TimeWindow> avoidHours = List.of();
    private int consecutiveDaysBeforeWeek;
    private Set<LocalDate> approvedHolidays = Set.of();
    private int holidayDaysRemaining;
    private double tenureYears;
    private int unplannedAbsenceDays3m;

    public Employee() {
    }

    public Employee(String id, String name, Set<String> skills) {
        this.id = id;
        this.name = name;
        this.skills = skills;
    }

    // ************************************************************************
    // Helpers
    // ************************************************************************

    /** The availability window on that date, or null if the employee is not available that day. */
    @JsonIgnore
    public TimeWindow windowOn(LocalDate date) {
        for (TimeWindow w : getAvailability()) {
            if (date.equals(w.getDate())) {
                return w;
            }
        }
        return null;
    }

    @JsonIgnore
    public long availableMinutesOn(LocalDate date) {
        TimeWindow w = windowOn(date);
        return w == null ? 0 : w.minutes();
    }

    /** True if [start, end) is fully inside the availability window and the day is not an approved holiday. */
    @JsonIgnore
    public boolean isAvailable(LocalDateTime start, LocalDateTime end) {
        LocalDate date = start.toLocalDate();
        if (getApprovedHolidays().contains(date)) {
            return false;
        }
        TimeWindow w = windowOn(date);
        return w != null && w.contains(start, end);
    }

    @JsonIgnore
    public boolean hasAllSkills(Set<String> required) {
        return getSkills().containsAll(required);
    }

    // ************************************************************************
    // Getters and setters (null-safe collections)
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

    public Set<String> getSkills() {
        return skills == null ? Set.of() : skills;
    }

    public void setSkills(Set<String> skills) {
        this.skills = skills;
    }

    public int getHourlyRate() {
        return hourlyRate;
    }

    public void setHourlyRate(int hourlyRate) {
        this.hourlyRate = hourlyRate;
    }

    public int getBillingRate() {
        return billingRate;
    }

    public void setBillingRate(int billingRate) {
        this.billingRate = billingRate;
    }

    public int getMaxHoursPerDay() {
        return maxHoursPerDay;
    }

    public void setMaxHoursPerDay(int maxHoursPerDay) {
        this.maxHoursPerDay = maxHoursPerDay;
    }

    public int getMaxHoursPerWeek() {
        return maxHoursPerWeek;
    }

    public void setMaxHoursPerWeek(int maxHoursPerWeek) {
        this.maxHoursPerWeek = maxHoursPerWeek;
    }

    public int getMinRestHours() {
        return minRestHours;
    }

    public void setMinRestHours(int minRestHours) {
        this.minRestHours = minRestHours;
    }

    public List<TimeWindow> getAvailability() {
        return availability == null ? List.of() : availability;
    }

    public void setAvailability(List<TimeWindow> availability) {
        this.availability = availability;
    }

    public Set<LocalDate> getDaysOffRequested() {
        return daysOffRequested == null ? Set.of() : daysOffRequested;
    }

    public void setDaysOffRequested(Set<LocalDate> daysOffRequested) {
        this.daysOffRequested = daysOffRequested;
    }

    public List<TimeWindow> getAvoidHours() {
        return avoidHours == null ? List.of() : avoidHours;
    }

    public void setAvoidHours(List<TimeWindow> avoidHours) {
        this.avoidHours = avoidHours;
    }

    public int getConsecutiveDaysBeforeWeek() {
        return consecutiveDaysBeforeWeek;
    }

    public void setConsecutiveDaysBeforeWeek(int consecutiveDaysBeforeWeek) {
        this.consecutiveDaysBeforeWeek = consecutiveDaysBeforeWeek;
    }

    public Set<LocalDate> getApprovedHolidays() {
        return approvedHolidays == null ? Set.of() : approvedHolidays;
    }

    public void setApprovedHolidays(Set<LocalDate> approvedHolidays) {
        this.approvedHolidays = approvedHolidays;
    }

    public int getHolidayDaysRemaining() {
        return holidayDaysRemaining;
    }

    public void setHolidayDaysRemaining(int holidayDaysRemaining) {
        this.holidayDaysRemaining = holidayDaysRemaining;
    }

    public double getTenureYears() {
        return tenureYears;
    }

    public void setTenureYears(double tenureYears) {
        this.tenureYears = tenureYears;
    }

    public int getUnplannedAbsenceDays3m() {
        return unplannedAbsenceDays3m;
    }

    public void setUnplannedAbsenceDays3m(int unplannedAbsenceDays3m) {
        this.unplannedAbsenceDays3m = unplannedAbsenceDays3m;
    }

    @Override
    public String toString() {
        return id;
    }

    @Override
    public boolean equals(Object o) {
        return this == o || (o instanceof Employee other && Objects.equals(id, other.id));
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}
