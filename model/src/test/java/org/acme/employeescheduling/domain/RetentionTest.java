package org.acme.employeescheduling.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

/**
 * Author: computed retention (replaces the invented 88/74/63% figures).
 * Created: 2026-10-30.
 * Scope: plain JUnit for the Kaplan–Meier retention computed from current staff tenure and leaver history.
 */
class RetentionTest {

    private static Employee staff(double tenureYears) {
        Employee e = new Employee("E", "E", Set.of());
        e.setTenureYears(tenureYears);
        return e;
    }

    /**
     * Scenario: one early and one mid-career leaver among long-serving staff.
     * Slice: Kaplan–Meier step at each leaving time.
     * Given three staff with 10 years' tenure and leavers after 0.5 and 2 years,
     * when retention is computed,
     * then year 1 is 4/5 and years 3 and 5 are 4/5 × 3/4.
     */
    @Test
    void multipliesSurvivalAtEachLeavingTime() {
        // -- Given --
        List<Employee> employees = List.of(staff(10), staff(10), staff(10));
        List<Leaver> leavers = List.of(new Leaver("L-001", 0.5), new Leaver("L-002", 2.0));

        // -- When --
        Retention retention = Retention.fromHistory(employees, leavers);

        // -- Then --
        assertThat(retention).isEqualTo(new Retention(0.8, 0.6, 0.6));
    }

    /**
     * Scenario: recent hires have not yet reached the horizon.
     * Slice: censoring — staff count as at risk only up to their tenure.
     * Given one hire of 0.5 years and one of 4 years, and a leaver after 2 years,
     * when retention is computed,
     * then the 0.5-year hire is not at risk at year 2, so year 3 is 1 − 1/2.
     */
    @Test
    void recentHiresAreNotCountedPastTheirTenure() {
        // -- Given --
        List<Employee> employees = List.of(staff(0.5), staff(4));
        List<Leaver> leavers = List.of(new Leaver("L-001", 2.0));

        // -- When --
        Retention retention = Retention.fromHistory(employees, leavers);

        // -- Then --
        assertThat(retention.year1()).isEqualTo(1.0);
        assertThat(retention.year3()).isEqualTo(0.5);
    }

    /**
     * Scenario: input without leaver history.
     * Slice: no invented figures.
     * Given current staff only, when retention is computed, then it is not reported.
     */
    @Test
    void isNotReportedWithoutLeaverHistory() {
        assertThat(Retention.fromHistory(List.of(staff(3)), null)).isNull();
    }
}
