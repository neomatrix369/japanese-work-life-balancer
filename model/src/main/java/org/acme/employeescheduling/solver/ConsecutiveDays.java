package org.acme.employeescheduling.solver;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Pure helpers over a set of worked day indexes (0 = weekStart). Shared by the constraints and the KPIs so both
 * count runs the same way.
 * <p>
 * Carry-in rule: {@code carryIn} days worked right before the week extend a run only if that run starts on day 0.
 * If the employee is off on day 0, the old run has ended and does not count.
 */
public final class ConsecutiveDays {

    /** Penalty per day over the healthy limit (one full shift = 480 minutes). */
    public static final long PENALTY_PER_EXTRA_DAY = 480L;
    public static final int AT_RISK_DAYS = 3;

    private ConsecutiveDays() {
    }

    /** Lengths of all runs of consecutive worked days, in day order, including carry-in. */
    public static List<Integer> runs(Set<Integer> days, int carryIn) {
        List<Integer> runs = new ArrayList<>();
        Integer runStart = null;
        Integer previous = null;
        for (int day : new TreeSet<>(days)) {
            if (previous == null || day != previous + 1) {
                if (previous != null) {
                    runs.add(length(runStart, previous, carryIn));
                }
                runStart = day;
            }
            previous = day;
        }
        if (previous != null) {
            runs.add(length(runStart, previous, carryIn));
        }
        return runs;
    }

    private static int length(int runStart, int runEnd, int carryIn) {
        return runEnd - runStart + 1 + (runStart == 0 ? Math.max(0, carryIn) : 0);
    }

    public static int maxRun(Set<Integer> days, int carryIn) {
        return runs(days, carryIn).stream().mapToInt(Integer::intValue).max().orElse(0);
    }

    /**
     * One-off charge per at-risk employee (any run of 3+ days), on top of the per-extra-day charge.
     * <p>
     * Why: the extra-day charge alone sums days across people, while the KPI counts people. Without this charge the
     * solver happily trims run lengths of many people and leaves all of them at risk. 2400 = five full shifts, so
     * making one person fully healthy is worth as much as removing five extra days spread over others.
     */
    public static final long AT_RISK_PERSON_PENALTY = 5 * PENALTY_PER_EXTRA_DAY;

    /**
     * {@code sum over runs of (L - 2) * 480} for runs of length L >= 3, plus {@link #AT_RISK_PERSON_PENALTY} once
     * if the employee has any such run (the same definition as the {@code atRisk} KPI).
     */
    public static long penalty(Set<Integer> days, int carryIn) {
        long total = 0;
        boolean atRisk = false;
        for (int length : runs(days, carryIn)) {
            if (length >= AT_RISK_DAYS) {
                total += (length - (AT_RISK_DAYS - 1)) * PENALTY_PER_EXTRA_DAY;
                atRisk = true;
            }
        }
        return atRisk ? total + AT_RISK_PERSON_PENALTY : total;
    }

    /** For each worked day: its position in its run (1 = first day), including carry-in. */
    public static Map<Integer, Integer> positions(Set<Integer> days, int carryIn) {
        Map<Integer, Integer> positions = new LinkedHashMap<>();
        Integer previous = null;
        int position = 0;
        for (int day : new TreeSet<>(days)) {
            if (previous != null && day == previous + 1) {
                position++;
            } else {
                position = 1 + (day == 0 ? Math.max(0, carryIn) : 0);
            }
            positions.put(day, position);
            previous = day;
        }
        return positions;
    }

    /**
     * Missing rest hours between consecutive worked days. Rest between day d1 and d2 = (d2 - d1) * 24h - shift
     * length. If the employee worked the day before the week (carryIn > 0), day -1 counts as worked.
     */
    public static long missingRestHours(Set<Integer> days, int carryIn, int minRestHours, long shiftMinutes) {
        TreeSet<Integer> worked = new TreeSet<>(days);
        if (carryIn > 0) {
            worked.add(-1);
        }
        long missingMinutes = 0;
        Integer previous = null;
        for (int day : worked) {
            if (previous != null) {
                long restMinutes = (day - previous) * 24L * 60L - shiftMinutes;
                missingMinutes += Math.max(0, minRestHours * 60L - restMinutes);
            }
            previous = day;
        }
        return (missingMinutes + 59) / 60;
    }
}
