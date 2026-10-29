package org.acme.employeescheduling.solver;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.time.Duration;

import jakarta.inject.Inject;

import ai.timefold.solver.core.api.solver.SolverConfigOverride;
import ai.timefold.solver.core.api.solver.SolverManager;

import org.acme.employeescheduling.domain.WorkSchedule;
import org.acme.employeescheduling.kpi.KpiCalculator;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.quarkus.test.junit.QuarkusTest;

@QuarkusTest
class TinySolveTest {

    @Inject
    SolverManager<WorkSchedule> solverManager;

    @Inject
    ObjectMapper objectMapper;

    @Test
    void solvesTinyWithoutBreakingHardConstraints() throws Exception {
        WorkSchedule problem;
        try (InputStream in = getClass().getResourceAsStream("/tiny.json")) {
            problem = objectMapper.readValue(in, WorkSchedule.class);
        }
        problem.prepare(Presets.get(Presets.HEALTH_FIRST));

        WorkSchedule solution = solverManager.solveBuilder()
                .withProblemId("tiny-test")
                .withProblem(problem)
                .withConfigOverride(new SolverConfigOverride().withTerminationSpentLimit(Duration.ofSeconds(5)))
                .run()
                .getFinalBestSolution();

        KpiCalculator.Result kpis = KpiCalculator.calculate(solution);
        System.out.println("tiny.json score = " + solution.getScore() + ", kpis = " + kpis.kpis());

        assertThat(solution.getScore().hardScore()).isZero();
        // The pinned task keeps its employee.
        assertThat(solution.getTasks().stream().filter(t -> t.isPinned())
                .allMatch(t -> t.getEmployee() != null && "E-001".equals(t.getEmployee().getId()))).isTrue();
    }
}
