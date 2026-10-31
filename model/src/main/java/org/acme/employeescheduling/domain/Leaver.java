package org.acme.employeescheduling.domain;

/** A former employee, kept only as the years they served before leaving. Report only, never planned. */
public record Leaver(String id, double leftAfterYears) {
}
