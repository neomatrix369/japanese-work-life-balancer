package org.acme.employeescheduling.solver;

import static org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names.CONSECUTIVE_DAYS_RISK;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;
import ai.timefold.solver.core.config.solver.termination.TerminationConfig;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.Task;
import org.acme.employeescheduling.domain.TimeWindow;
import org.acme.employeescheduling.domain.WorkSchedule;
import org.acme.employeescheduling.kpi.KpiCalculator;
import org.junit.jupiter.api.Test;

/**
 * Author: model audit (health-first has no visible effect).
 * Created: 2026-10-29.
 * Scope: plain JUnit (no Quarkus boot; one sub-second 5-task solve) evidence that the health model rewards shorter runs, that presets
 * reach the score, and that the KPIs count runs exactly like the constraint.
 */
class HealthModelAuditTest {

    private static final LocalDate MON = LocalDate.of(2026, 11, 9);

    private static final ConstraintVerifier<WorkScheduleConstraintProvider, WorkSchedule> VERIFIER =
            ConstraintVerifier.build(new WorkScheduleConstraintProvider(), WorkSchedule.class, Task.class);

    private static final SolutionManager<WorkSchedule, HardMediumSoftScore> SOLUTION_MANAGER =
            SolutionManager.create(SolverFactory.create(new SolverConfig()
                    .withSolutionClass(WorkSchedule.class)
                    .withEntityClasses(Task.class)
                    .withConstraintProviderClass(WorkScheduleConstraintProvider.class)));

    private static Employee employee(String id, int hourlyRate, int carryIn) {
        Employee e = new Employee(id, id, Set.of());
        List<TimeWindow> availability = new ArrayList<>();
        for (int d = 0; d < 5; d++) {
            availability.add(new TimeWindow(MON.plusDays(d), LocalTime.of(9, 0), LocalTime.of(17, 0)));
        }
        e.setAvailability(availability);
        e.setHourlyRate(hourlyRate);
        e.setMaxHoursPerDay(8);
        e.setMaxHoursPerWeek(40);
        e.setMinRestHours(12);
        e.setConsecutiveDaysBeforeWeek(carryIn);
        return e;
    }

    private static Task fullDay(String id, int day, Employee employee) {
        Task t = new Task(id, LocalDateTime.of(MON.plusDays(day), LocalTime.of(9, 0)), 480, Set.of(), employee);
        t.setWeekStart(MON);
        return t;
    }

    private static WorkSchedule schedule(List<Employee> employees, List<Task> tasks, String preset) {
        WorkSchedule s = new WorkSchedule();
        s.setWeekStart(MON);
        s.setEmployees(employees);
        s.setTasks(tasks);
        return s.prepare(Presets.get(preset));
    }

    /**
     * Soft score of a plan built so that only Consecutive days risk can be non-zero: hourlyRate 0 (no labor cost),
     * full 8h days inside 8h windows (no idle), no day-off requests or avoided hours. (score analysis is an
     * enterprise feature in Timefold 2.x, so {@code update()} is used instead of {@code analyze()}.)
     */
    private static long consecutiveOnlySoft(WorkSchedule schedule) {
        HardMediumSoftScore score = SOLUTION_MANAGER.update(schedule);
        assertThat(score.hardScore()).isZero();
        return score.softScore();
    }

    @Test
    void shorteningARunStrictlyLowersThePenalty() {
        // Scenario: Mon-Fri run, then Wed removed; carry-in only extends a run that starts on Monday.
        // Slice: item 1 of the audit.
        // Given/When/Then per assertion below.
        assertThat(ConsecutiveDays.penalty(Set.of(0, 1, 2, 3, 4), 0)).isEqualTo(3 * 480);
        assertThat(ConsecutiveDays.penalty(Set.of(0, 1, 3, 4), 0)).isZero();
        assertThat(ConsecutiveDays.penalty(Set.of(0, 1, 2, 3), 0)).isEqualTo(2 * 480);
        // Carry-in 2: Mon-Fri = run 7 -> 5*480; drop Mon -> Tue-Fri run 4 (carry gone) -> 2*480.
        assertThat(ConsecutiveDays.penalty(Set.of(0, 1, 2, 3, 4), 2)).isEqualTo(5 * 480);
        assertThat(ConsecutiveDays.penalty(Set.of(1, 2, 3, 4), 2)).isEqualTo(2 * 480);
        // Carry-in 2, only Mon worked: run 3 -> 480 (Mon itself is risky after 2 days before the week).
        assertThat(ConsecutiveDays.penalty(Set.of(0), 2)).isEqualTo(480);

        // Same through the real constraint stream.
        Employee amy = employee("E-001", 2500, 0);
        VERIFIER.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, fullDay("T-0", 0, amy), fullDay("T-1", 1, amy), fullDay("T-2", 2, amy),
                        fullDay("T-3", 3, amy), fullDay("T-4", 4, amy))
                .penalizesBy(3 * 480);
        VERIFIER.verifyThat(WorkScheduleConstraintProvider::consecutiveDaysRisk)
                .given(amy, fullDay("T-0", 0, amy), fullDay("T-1", 1, amy),
                        fullDay("T-3", 3, amy), fullDay("T-4", 4, amy))
                .penalizesBy(0);
    }

    @Test
    void movingWednesdayAwayIsANetSoftGainUnderHealthFirst() {
        // Scenario: Amy works Mon-Fri (full 8h days); Ben (pricier) is free all week. Move Amy's Wed task to Ben.
        // Slice: item 2 (other soft constraints vs the health penalty) and item 3 (presets reach the score).
        // Given the same two plans scored under health-first and cost-first,
        // When we compare the score of "Amy keeps Wed" vs "Ben takes Wed",
        // Then health-first prefers Ben by ~14400 soft and cost-first prefers Amy only by the labor difference.
        Employee amy = employee("E-001", 2500, 0);
        Employee ben = employee("E-002", 4000, 0);
        for (String preset : List.of(Presets.HEALTH_FIRST, Presets.COST_FIRST)) {
            List<Task> keep = List.of(fullDay("T-0", 0, amy), fullDay("T-1", 1, amy), fullDay("T-2", 2, amy),
                    fullDay("T-3", 3, amy), fullDay("T-4", 4, amy));
            List<Task> moved = List.of(fullDay("T-0", 0, amy), fullDay("T-1", 1, amy), fullDay("T-2", 2, ben),
                    fullDay("T-3", 3, amy), fullDay("T-4", 4, amy));
            HardMediumSoftScore before = SOLUTION_MANAGER.update(schedule(List.of(amy, ben), keep, preset));
            HardMediumSoftScore after = SOLUTION_MANAGER.update(schedule(List.of(amy, ben), moved, preset));
            long delta = after.softScore() - before.softScore();
            System.out.printf("[audit] %s: keep=%s moved=%s delta=%d%n", preset, before, after, delta);
            // Labor: (4000-2500) * 8h / 100 = 120 per labor weight unit.
            if (preset.equals(Presets.HEALTH_FIRST)) {
                assertThat(delta).isEqualTo(10 * 3 * 480 - 120);
            } else {
                assertThat(delta).isEqualTo(-5 * 120);
            }
        }
    }

    @Test
    void presetWeightsReachTheConsecutiveConstraintScore() {
        // Scenario: identical plan, three presets. Slice: item 3.
        Employee amy = employee("E-001", 0, 2);
        List<Employee> employees = List.of(amy);
        long raw = 5 * 480; // carry 2 + Mon-Fri = run of 7
        for (var entry : Presets.SOFT_WEIGHTS.entrySet()) {
            List<Task> tasks = List.of(fullDay("T-0", 0, amy), fullDay("T-1", 1, amy), fullDay("T-2", 2, amy),
                    fullDay("T-3", 3, amy), fullDay("T-4", 4, amy));
            long soft = consecutiveOnlySoft(schedule(employees, tasks, entry.getKey()));
            System.out.printf("[audit] %s consecutive soft = %d%n", entry.getKey(), soft);
            assertThat(soft).isEqualTo(-raw * entry.getValue().get(CONSECUTIVE_DAYS_RISK));
        }
    }

    @Test
    void kpiRunsMatchTheConstraintRuns() {
        // Scenario: carry-in, Monday off, gaps. Slice: item 4.
        // Given employees with assorted carry-in and day patterns,
        // When KPIs and the balanced-preset constraint score are computed,
        // Then atRisk <=> penalty > 0 per employee, and the summed constraint score equals the KPI-side penalty.
        int[][] patterns = { { 0, 1, 2, 3, 4 }, { 1, 2, 3, 4 }, { 0, 1, 3, 4 }, { 0 }, { 0, 2, 4 }, { 4, 5, 6 } };
        int[] carry = { 0, 3, 1, 2, 0, 5 };
        List<Employee> employees = new ArrayList<>();
        List<Task> tasks = new ArrayList<>();
        long expectedPenalty = 0;
        for (int i = 0; i < patterns.length; i++) {
            Employee e = employee("E-00" + i, 0, carry[i]);
            List<TimeWindow> all = new ArrayList<>();
            for (int d = 0; d < 7; d++) {
                all.add(new TimeWindow(MON.plusDays(d), LocalTime.of(9, 0), LocalTime.of(17, 0)));
            }
            e.setAvailability(all);
            employees.add(e);
            Set<Integer> days = new HashSet<>();
            for (int d : patterns[i]) {
                tasks.add(fullDay("T-" + i + d, d, e));
                days.add(d);
            }
            expectedPenalty += ConsecutiveDays.penalty(days, carry[i]);
        }
        WorkSchedule s = schedule(employees, tasks, Presets.BALANCED);
        KpiCalculator.Result kpis = KpiCalculator.calculate(s);
        for (int i = 0; i < patterns.length; i++) {
            Set<Integer> days = new HashSet<>();
            for (int d : patterns[i]) {
                days.add(d);
            }
            var k = kpis.perEmployee().get(i);
            assertThat(k.atRisk()).as(k.employeeId()).isEqualTo(ConsecutiveDays.penalty(days, carry[i]) > 0);
        }
        // Expected max runs: 5, 4 (Mon off -> no carry), 3 (carry1+Mon,Tue), 3, 1, 3.
        assertThat(kpis.perEmployee().stream().map(KpiCalculator.EmployeeKpis::maxConsecutiveDays).toList())
                .containsExactly(5, 4, 3, 3, 1, 3);
        assertThat(consecutiveOnlySoft(s)).isEqualTo(-expectedPenalty);
    }

    @Test
    void theSolverHonoursThePresetWeights() {
        // Scenario: 5 full-day tasks Mon-Fri, cheap Amy and pricier Ben, both free Mon-Fri.
        // Slice: item 3 end to end (weights set by prepare() are read by a real Solver, not only by SolutionManager).
        // Given the same problem solved under cost-first and then health-first with one SolverFactory,
        // When each solve finishes (5 tasks, terminates in well under a second),
        // Then cost-first gives all five days to cheap Amy (run of 5) and health-first leaves nobody at risk.
        SolverFactory<WorkSchedule> factory = SolverFactory.create(new SolverConfig()
                .withSolutionClass(WorkSchedule.class)
                .withEntityClasses(Task.class)
                .withConstraintProviderClass(WorkScheduleConstraintProvider.class)
                .withTerminationConfig(new TerminationConfig()
                        .withUnimprovedSpentLimit(Duration.ofMillis(300))
                        .withSpentLimit(Duration.ofSeconds(3))));
        for (String preset : List.of(Presets.COST_FIRST, Presets.HEALTH_FIRST)) {
            Employee amy = employee("E-001", 2500, 0);
            Employee ben = employee("E-002", 4000, 0);
            List<Task> tasks = new ArrayList<>();
            for (int d = 0; d < 5; d++) {
                tasks.add(fullDay("T-" + d, d, null));
            }
            WorkSchedule solved = factory.buildSolver().solve(schedule(List.of(amy, ben), tasks, preset));
            KpiCalculator.Result kpis = KpiCalculator.calculate(solved);
            System.out.printf("[audit] solver %s: score=%s atRisk=%d%n", preset, solved.getScore(),
                    kpis.kpis().atRiskCount());
            assertThat(solved.getScore().mediumScore()).isZero();
            if (preset.equals(Presets.COST_FIRST)) {
                assertThat(kpis.kpis().atRiskCount()).isEqualTo(1);
            } else {
                assertThat(kpis.kpis().atRiskCount()).isZero();
            }
        }
    }
}
