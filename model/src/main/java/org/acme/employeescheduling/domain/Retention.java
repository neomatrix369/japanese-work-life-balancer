package org.acme.employeescheduling.domain;

/** Company retention rate after 1, 3 and 5 years. Report only (MOCK: figures come from synthetic data). */
public record Retention(double year1, double year3, double year5) {
}
