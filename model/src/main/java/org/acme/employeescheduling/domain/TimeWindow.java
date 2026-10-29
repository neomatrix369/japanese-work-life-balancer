package org.acme.employeescheduling.domain;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;

/** A time range on one date, e.g. an availability window or an "avoid these hours" window. */
public class TimeWindow {

    private LocalDate date;
    @JsonFormat(pattern = "HH:mm")
    private LocalTime start;
    @JsonFormat(pattern = "HH:mm")
    private LocalTime end;

    public TimeWindow() {
    }

    public TimeWindow(LocalDate date, LocalTime start, LocalTime end) {
        this.date = date;
        this.start = start;
        this.end = end;
    }

    /** Length of the window in minutes. */
    public long minutes() {
        return Math.max(0, Duration.between(start, end).toMinutes());
    }

    /** Minutes that the range [s, e) shares with this window. */
    public long overlapMinutes(LocalDateTime s, LocalDateTime e) {
        return overlap(s, e, date.atTime(start), date.atTime(end));
    }

    public static long overlap(LocalDateTime s1, LocalDateTime e1, LocalDateTime s2, LocalDateTime e2) {
        LocalDateTime s = s1.isAfter(s2) ? s1 : s2;
        LocalDateTime e = e1.isBefore(e2) ? e1 : e2;
        long minutes = Duration.between(s, e).toMinutes();
        return Math.max(0, minutes);
    }

    @JsonIgnore
    public boolean contains(LocalDateTime s, LocalDateTime e) {
        return !s.isBefore(date.atTime(start)) && !e.isAfter(date.atTime(end));
    }

    public LocalDate getDate() {
        return date;
    }

    public void setDate(LocalDate date) {
        this.date = date;
    }

    public LocalTime getStart() {
        return start;
    }

    public void setStart(LocalTime start) {
        this.start = start;
    }

    public LocalTime getEnd() {
        return end;
    }

    public void setEnd(LocalTime end) {
        this.end = end;
    }

    @Override
    public String toString() {
        return date + " " + start + "-" + end;
    }
}
