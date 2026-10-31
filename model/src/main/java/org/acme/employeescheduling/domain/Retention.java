package org.acme.employeescheduling.domain;

import java.util.List;

/** Share of hires still employed after 1, 3 and 5 years. Report only. */
public record Retention(double year1, double year3, double year5) {

    /**
     * Kaplan–Meier retention from current staff (still employed at their tenure) and leavers (left after N years).
     * Returns null when there is no leaver history, because current staff alone cannot show who left.
     */
    public static Retention fromHistory(List<Employee> employees, List<Leaver> leavers) {
        if (leavers == null) {
            return null;
        }
        return new Retention(
                survival(employees, leavers, 1),
                survival(employees, leavers, 3),
                survival(employees, leavers, 5));
    }

    private static double survival(List<Employee> employees, List<Leaver> leavers, double years) {
        double survival = 1.0;
        for (double t : leavers.stream().mapToDouble(Leaver::leftAfterYears).filter(t -> t < years).distinct().sorted()
                .toArray()) {
            long left = leavers.stream().filter(l -> l.leftAfterYears() == t).count();
            long atRisk = employees.stream().filter(e -> e.getTenureYears() >= t).count()
                    + leavers.stream().filter(l -> l.leftAfterYears() >= t).count();
            survival *= 1.0 - left / (double) atRisk;
        }
        return Math.round(survival * 1000.0) / 1000.0;
    }
}
