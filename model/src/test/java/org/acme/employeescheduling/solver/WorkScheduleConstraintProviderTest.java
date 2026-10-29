package org.acme.employeescheduling.solver;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import jakarta.inject.Inject;

import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.Task;
import org.acme.employeescheduling.domain.TimeWindow;
import org.acme.employeescheduling.domain.WorkSchedule;
import org.junit.jupiter.api.Test;

import io.quarkus.test.junit.QuarkusTest;

/** One "penalizes" and one "doesn't penalize" case per hard constraint, plus Unassigned task and Consecutive days risk. */
@QuarkusTest
class WorkScheduleConstraintProviderTest {

    private static final LocalDate MON = LocalDate.of(2026, 11, 9);
    private static final LocalDate TUE = MON.plusDays(1);
    private static final LocalDate WED = MON.plusDays(2);

    @Inject
    ConstraintVerifier<WorkScheduleConstraintProvider, WorkSchedule> verifier;

    private static Employee employee(String id, String... skills) {
        Employee e = new Employee(id, id, Set.of(skills));
        List<TimeWindow> availability = new ArrayList<>();
        for (int d = 0; d < 7; d++) {
            availability.add(new TimeWindow(MON.plusDays(d), LocalTime.of(9, 0), LocalTime.of(17, 0)));
        }
        e.setAvailability(availability);
        e.setMaxHoursPerDay(8);
        e.setMaxHoursPerWeek(40);
        e.setMinRestHours(11);
        return e;
    }

    private static Task task(String id, LocalDate date, int hour, int minute, int minutes, Employee employee,
            String... skills) {
        Task t = new Task(id, LocalDateTime.of(date, LocalTime.of(hour, minute)), minutes, Set.of(skills), employee);
        t.setWeekStart(MON);
        return t;
    }

    @Test
    void requiredSkills() {
        Employee amy = employee("E-001", "sales");
        verifier.verifyThat(WorkScheduleConstraintProvider::requiredSkills)
                .given(amy, task("T-1", MON, 9, 0, 60, amy, "sales", "design"))
                .penalizesBy(1);
        verifier.verifyThat(WorkScheduleConstraintProvider::requiredSkills)
                .given(amy, task("T-1", MON, 9, 0, 60, amy, "sales"))
                .penalizesBy(0);
    }

    @Test
    void availability() {
        Employee amy = employee("E-001");
        amy.setAvailability(List.of(new TimeWindow(MON, LocalTime.of(10, 0), LocalTime.of(17, 0))));
        verifier.verifyThat(WorkScheduleConstraintProvider::availability)
                .given(amy, task("T-1", MON, 9, 0, 120, amy), task("T-2", TUE, 10, 0, 90, amy))
                .penalizesBy(60 + 90);
        verifier.verifyThat(WorkScheduleConstraintProvider::availability)
                .given(amy, task("T-1", MON, 10, 0, 120, amy))
                .penalizesBy(0);
    }

    @Test
    void approvedHoliday() {
        Employee amy = employee("E-001");
        amy.setApprovedHolidays(Set.of(MON));
        verifier.verifyThat(WorkScheduleConstraintProvider::approvedHoliday)
                .given(amy, task("T-1", MON, 9, 0, 60, amy))
                .penalizesBy(60);
        verifier.verifyThat(WorkScheduleConstraintProvider::approvedHoliday)
                .given(amy, task("T-1", TUE, 9, 0, 60, amy))
                .penalizesBy(0);
    }

    @Test
    void publicHoliday() {
        Employee amy = employee("E-001");
        Task onHoliday = task("T-1", MON, 9, 0, 90, amy);
        onHoliday.setOnPublicHoliday(true);
        verifier.verifyThat(WorkScheduleConstraintProvider::publicHoliday)
                .given(amy, onHoliday)
                .penalizesBy(90);
        verifier.verifyThat(WorkScheduleConstraintProvider::publicHoliday)
                .given(amy, task("T-2", TUE, 9, 0, 90, amy))
                .penalizesBy(0);
    }

    @Test
    void taskWithinShift() {
        Employee amy = employee("E-001");
        verifier.verifyThat(WorkScheduleConstraintProvider::taskWithinShift)
                .given(amy, task("T-1", MON, 16, 0, 120, amy))
                .penalizesBy(60);
        verifier.verifyThat(WorkScheduleConstraintProvider::taskWithinShift)
                .given(amy, task("T-1", MON, 15, 0, 120, amy))
                .penalizesBy(0);
    }

    @Test
    void oneTaskAtATime() {
        Employee amy = employee("E-001");
        Employee beth = employee("E-002");
        verifier.verifyThat(WorkScheduleConstraintProvider::oneTaskAtATime)
                .given(amy, beth, task("T-1", MON, 9, 0, 120, amy), task("T-2", MON, 10, 0, 120, amy))
                .penalizesBy(60);
        verifier.verifyThat(WorkScheduleConstraintProvider::oneTaskAtATime)
                .given(amy, beth, task("T-1", MON, 9, 0, 120, amy), task("T-2", MON, 10, 0, 120, beth))
                .penalizesBy(0);
    }

    @Test
    void maxHoursPerDay() {
        Employee amy = employee("E-001");
        amy.setMaxHoursPerDay(4);
        verifier.verifyThat(WorkScheduleConstraintProvider::maxHoursPerDay)
                .given(amy, task("T-1", MON, 9, 0, 180, amy), task("T-2", MON, 13, 0, 120, amy))
                .penalizesBy(60);
        verifier.verifyThat(WorkScheduleConstraintProvider::maxHoursPerDay)
                .given(amy, task("T-1", MON, 9, 0, 180, amy), task("T-2", TUE, 13, 0, 120, amy))
                .penalizesBy(0);
    }

    @Test
    void maxHoursPerWeek() {
        Employee amy = employee("E-001");
        amy.setMaxHoursPerWeek(20);
        List<Object> facts = new ArrayList<>(List.of(amy));
        for (int d = 0; d < 5; d++) {
            facts.add(task("T-" + d, MON.plusDays(d), 9, 0, 300, amy));
        }
        verifier.verifyThat(WorkScheduleConstraintProvider::maxHoursPerWeek)
                .given(facts.toArray())
                .penalizesBy(5 * 300 - 20 * 60);
        verifier.verifyThat(WorkScheduleConstraintProvider::maxHoursPerWeek)
                .given(amy, task("T-1", MON, 9, 0, 480, amy), task("T-2", TUE, 9, 0, 480, amy))
                .penalizesBy(0);
    }

    @Test
    void minimumRest() {
        Employee amy = employee("E-001");
        amy.setMinRestHours(24); // 09-17 shift leaves 16h rest between consecutive days -> 8h missing
        verifier.verifyThat(WorkScheduleConstraintProvider::minimumRest)
                .given(amy, task("T-1", MON, 9, 0, 60, amy), task("T-2", TUE, 9, 0, 60, amy))
                .penalizesBy(8);
        verifier.verifyThat(WorkScheduleConstraintProvider::minimumRest)
                .given(amy, task("T-1", MON, 9, 0, 60, amy), task("T-2", WED, 9, 0, 60, amy))
                .penalizesBy(0);
    }

    @Test
    void unassignedTask() {
        Employee amy = employee("E-001");
        verifier.verifyThat(WorkScheduleConstraintProvider::unassignedTask)
                .given(amy, task("T-1", MON, 9, 0, 60, null), task("T-2", MON, 11, 0, 60, amy))
                .penalizesBy(1);
        verifier.verifyThat(WorkScheduleConstraintProvider::unassignedTask)
                .given(amy, task("T-2", MON, 11, 0, 60, amy))
                .penalizesBy(0);
    }

    @Test
    void consecutiveDaysRisk() {
        Employee amy = employee("E-001");
        // Mon-Wed = run of 3 -> (3-2)*480 + one-off at-risk charge
        verifier.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, task("T-1", MON, 9, 0, 60, amy), task("T-2", TUE, 9, 0, 60, amy),
                        task("T-3", WED, 9, 0, 60, amy))
                .penalizesBy(480 + ConsecutiveDays.AT_RISK_PERSON_PENALTY);
        // Mon + Wed: two runs of 1
        verifier.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, task("T-1", MON, 9, 0, 60, amy), task("T-3", WED, 9, 0, 60, amy))
                .penalizesBy(0);
    }

    @Test
    void consecutiveDaysRiskCountsCarryIn() {
        Employee amy = employee("E-001");
        amy.setConsecutiveDaysBeforeWeek(3);
        // 3 days before the week + Mon + Tue = run of 5 -> (5-2)*480 + one-off at-risk charge
        verifier.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, task("T-1", MON, 9, 0, 60, amy), task("T-2", TUE, 9, 0, 60, amy))
                .penalizesBy(3 * 480 + ConsecutiveDays.AT_RISK_PERSON_PENALTY);
        // Off on Monday: the carry-in run has ended.
        verifier.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, task("T-2", TUE, 9, 0, 60, amy))
                .penalizesBy(0);
    }

    @Test
    void consecutiveDaysRiskChargesEachAtRiskPersonOnce() {
        Employee amy = employee("E-001");
        Employee beth = employee("E-002");
        LocalDate thu = MON.plusDays(3);
        LocalDate fri = MON.plusDays(4);
        LocalDate sat = MON.plusDays(5);
        // Amy: two runs of 3 (Mon-Wed, Fri-Sun) -> 2 extra days, but only one at-risk charge.
        // Beth: Mon + Wed + Fri -> healthy, no charge.
        verifier.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, beth,
                        task("T-1", MON, 9, 0, 60, amy), task("T-2", TUE, 9, 0, 60, amy),
                        task("T-3", WED, 9, 0, 60, amy), task("T-4", fri, 9, 0, 60, amy),
                        task("T-5", sat, 9, 0, 60, amy), task("T-6", sat.plusDays(1), 9, 0, 60, amy),
                        task("T-7", MON, 11, 0, 60, beth), task("T-8", WED, 11, 0, 60, beth),
                        task("T-9", fri, 11, 0, 60, beth))
                .penalizesBy(2 * 480 + ConsecutiveDays.AT_RISK_PERSON_PENALTY);
        // Mon-Tue, Wed off, Thu-Fri: runs of 2 only -> healthy, no charge at all.
        verifier.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, task("T-1", MON, 9, 0, 60, amy), task("T-2", TUE, 9, 0, 60, amy),
                        task("T-4", thu, 9, 0, 60, amy), task("T-5", fri, 9, 0, 60, amy))
                .penalizesBy(0);
    }
}
