package org.acme.employeescheduling.kpi;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ai.timefold.solver.core.api.domain.solution.ConstraintWeightOverrides;
import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.score.analysis.ConstraintAnalysis;
import ai.timefold.solver.core.api.score.analysis.ScoreAnalysis;
import ai.timefold.solver.core.api.solver.ScoreAnalysisFetchPolicy;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.SolutionUpdatePolicy;

import org.acme.employeescheduling.domain.WorkSchedule;
import org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Flattens the score into a list of non-zero constraints, hard first.
 * <p>
 * Timefold 2.x Community Edition does not include score analysis (it is a commercial feature). With the
 * enterprise profile and a license we use {@link SolutionManager#analyze}; otherwise we fall back to a weight probe:
 * recompute the score once per constraint with only that constraint weighted. The fallback cannot count matches,
 * so {@code matchCount} is null there.
 */
public final class BrokenConstraints {

    private static final Logger LOGGER = LoggerFactory.getLogger(BrokenConstraints.class);
    private static volatile boolean analysisAvailable = true;

    /** {@code score} is the (negative) impact on the constraint's own level; matchCount is null in Community. */
    public record BrokenConstraint(String name, String level, Integer matchCount, long score) {
    }

    private BrokenConstraints() {
    }

    public static List<BrokenConstraint> compute(SolutionManager<WorkSchedule, HardMediumSoftScore> solutionManager,
            WorkSchedule schedule) {
        if (analysisAvailable) {
            try {
                return from(solutionManager.analyze(schedule, ScoreAnalysisFetchPolicy.FETCH_MATCH_COUNT,
                        SolutionUpdatePolicy.NO_UPDATE));
            } catch (IllegalStateException e) {
                // Community Edition: score analysis is a commercial feature, so use the weight probe below.
                analysisAvailable = false;
                LOGGER.warn("Score analysis unavailable ({}). Using the weight-probe fallback.", e.getMessage());
            }
        }
        return probe(solutionManager, schedule);
    }

    public static List<BrokenConstraint> from(ScoreAnalysis<HardMediumSoftScore> analysis) {
        List<BrokenConstraint> list = new ArrayList<>();
        for (ConstraintAnalysis<HardMediumSoftScore> c : analysis.constraintAnalyses()) {
            list.add(toBroken(c.constraintRef().id(), c.matchCount(), c.score()));
        }
        return sorted(list);
    }

    /** Community fallback: one score calculation per constraint, all other weights set to zero. */
    static List<BrokenConstraint> probe(SolutionManager<WorkSchedule, HardMediumSoftScore> solutionManager,
            WorkSchedule schedule) {
        ConstraintWeightOverrides<HardMediumSoftScore> preset = schedule.getConstraintWeightOverrides();
        Map<String, HardMediumSoftScore> weights = new LinkedHashMap<>();
        Names.HARD.forEach(n -> weights.put(n, HardMediumSoftScore.ONE_HARD));
        Names.MEDIUM.forEach(n -> weights.put(n, HardMediumSoftScore.ONE_MEDIUM));
        Names.SOFT.forEach(n -> {
            HardMediumSoftScore w = preset == null ? null : preset.getConstraintWeight(n);
            weights.put(n, w == null ? HardMediumSoftScore.ONE_SOFT : w);
        });

        List<BrokenConstraint> list = new ArrayList<>();
        for (String target : weights.keySet()) {
            if (weights.get(target).equals(HardMediumSoftScore.ZERO)) {
                continue; // disabled by the preset
            }
            Map<String, HardMediumSoftScore> only = new LinkedHashMap<>();
            weights.forEach((n, w) -> only.put(n, n.equals(target) ? w : HardMediumSoftScore.ZERO));
            WorkSchedule copy = shallowCopy(schedule);
            copy.setConstraintWeightOverrides(ConstraintWeightOverrides.of(only));
            HardMediumSoftScore score = solutionManager.update(copy, SolutionUpdatePolicy.UPDATE_SCORE_ONLY);
            list.add(toBroken(target, null, score));
        }
        return sorted(list);
    }

    private static WorkSchedule shallowCopy(WorkSchedule s) {
        WorkSchedule c = new WorkSchedule();
        c.setName(s.getName());
        c.setWeekStart(s.getWeekStart());
        c.setShiftStart(s.getShiftStart());
        c.setShiftEnd(s.getShiftEnd());
        c.setPublicHolidays(s.getPublicHolidays());
        c.setRetention(s.getRetention());
        c.setEmployees(s.getEmployees());
        c.setTasks(s.getTasks());
        return c;
    }

    private static BrokenConstraint toBroken(String name, Integer matchCount, HardMediumSoftScore s) {
        String level;
        long value;
        if (s.hardScore() != 0) {
            level = "HARD";
            value = s.hardScore();
        } else if (s.mediumScore() != 0) {
            level = "MEDIUM";
            value = s.mediumScore();
        } else {
            level = "SOFT";
            value = s.softScore();
        }
        return new BrokenConstraint(name, level, matchCount, value);
    }

    private static List<BrokenConstraint> sorted(List<BrokenConstraint> list) {
        return list.stream()
                .filter(b -> b.score() != 0)
                .sorted(Comparator.comparingInt((BrokenConstraint b) -> levelOrder(b.level()))
                        .thenComparingLong(BrokenConstraint::score))
                .toList();
    }

    private static int levelOrder(String level) {
        return switch (level) {
            case "HARD" -> 0;
            case "MEDIUM" -> 1;
            default -> 2;
        };
    }
}
