package org.acme.employeescheduling.solver;

import static org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names.AVOIDED_HOURS;
import static org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names.CONSECUTIVE_DAYS_RISK;
import static org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names.IDLE_HOURS;
import static org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names.LABOR_COST;
import static org.acme.employeescheduling.solver.WorkScheduleConstraintProvider.Names.REQUESTED_DAY_OFF;

import java.util.LinkedHashMap;
import java.util.Map;

import ai.timefold.solver.core.api.domain.solution.ConstraintWeightOverrides;
import ai.timefold.solver.core.api.score.HardMediumSoftScore;

/**
 * Weight presets. Only soft weights change; hard and medium constraints keep their default weight (1) in every
 * preset because they are not listed here.
 */
public final class Presets {

    public static final String HEALTH_FIRST = "health-first";
    public static final String BALANCED = "balanced";
    public static final String COST_FIRST = "cost-first";
    public static final String DEFAULT = HEALTH_FIRST;

    /** Soft weights per preset: idle, labor cost, requested day off, avoided hours, consecutive days risk. */
    public static final Map<String, Map<String, Long>> SOFT_WEIGHTS = new LinkedHashMap<>();

    static {
        SOFT_WEIGHTS.put(HEALTH_FIRST, weights(1, 1, 3, 2, 10));
        SOFT_WEIGHTS.put(BALANCED, weights(1, 1, 1, 1, 1));
        // Consecutive days risk = 0: report only, as in the original PRD.
        SOFT_WEIGHTS.put(COST_FIRST, weights(3, 5, 1, 1, 0));
    }

    public static final Map<String, ConstraintWeightOverrides<HardMediumSoftScore>> PRESETS = new LinkedHashMap<>();

    static {
        SOFT_WEIGHTS.forEach((name, weights) -> {
            Map<String, HardMediumSoftScore> scores = new LinkedHashMap<>();
            weights.forEach((constraint, weight) -> scores.put(constraint, HardMediumSoftScore.ofSoft(weight)));
            PRESETS.put(name, ConstraintWeightOverrides.of(scores));
        });
    }

    private Presets() {
    }

    private static Map<String, Long> weights(long idle, long labor, long dayOff, long avoided, long consecutive) {
        Map<String, Long> map = new LinkedHashMap<>();
        map.put(IDLE_HOURS, idle);
        map.put(LABOR_COST, labor);
        map.put(REQUESTED_DAY_OFF, dayOff);
        map.put(AVOIDED_HOURS, avoided);
        map.put(CONSECUTIVE_DAYS_RISK, consecutive);
        return map;
    }

    public static boolean exists(String name) {
        return PRESETS.containsKey(name);
    }

    public static ConstraintWeightOverrides<HardMediumSoftScore> get(String name) {
        ConstraintWeightOverrides<HardMediumSoftScore> overrides = PRESETS.get(name == null ? DEFAULT : name);
        if (overrides == null) {
            throw new IllegalArgumentException("Unknown preset: " + name + ". Use one of " + PRESETS.keySet());
        }
        return overrides;
    }
}
