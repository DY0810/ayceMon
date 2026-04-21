import { describe, expect, it } from "vitest";

import {
  formatActivityRelative,
  formatActivityUnits,
} from "./format-activity";

describe("formatActivityUnits", () => {
  it("formats integer units as ×N", () => {
    expect(formatActivityUnits(1, null)).toBe("×1");
    expect(formatActivityUnits(3, null)).toBe("×3");
  });

  it("formats fractional units with one decimal", () => {
    expect(formatActivityUnits(0.5, null)).toBe("×0.5");
    expect(formatActivityUnits(2.5, null)).toBe("×2.5");
  });

  it("shows grams for grams-only entries (units=0, grams>0)", () => {
    expect(formatActivityUnits(0, 120)).toBe("120g");
    expect(formatActivityUnits(0, 45.6)).toBe("46g"); // rounds to whole
  });

  it("falls back to ×0 when both units and grams are zero", () => {
    // Defensive: the tracker's log-eaten gate prevents this from the UI,
    // so it can only arrive via a direct DB write.
    expect(formatActivityUnits(0, 0)).toBe("×0");
    expect(formatActivityUnits(0, null)).toBe("×0");
  });
});

describe("formatActivityRelative", () => {
  const anchor = Date.parse("2026-04-18T12:00:00Z");

  it("renders 'just now' for sub-60s deltas", () => {
    expect(formatActivityRelative("2026-04-18T12:00:00Z", anchor)).toBe(
      "just now",
    );
    expect(formatActivityRelative("2026-04-18T11:59:20Z", anchor)).toBe(
      "just now",
    );
    // 59s is still "just now" — one second shy of the minute threshold.
    expect(formatActivityRelative("2026-04-18T11:59:01Z", anchor)).toBe(
      "just now",
    );
  });

  it("advances to minute at exactly 60s, not before", () => {
    // 59s → "just now"; 60s → "1m ago" via Intl (numeric: "always" so no
    // natural-language substitution).
    expect(formatActivityRelative("2026-04-18T11:59:00Z", anchor)).toMatch(
      /1m ago|1 min\. ago|1 minute ago/,
    );
  });

  it("holds a minute unit until the next full minute (no rounding jump)", () => {
    // Regression guard: a previous implementation used chained Math.round
    // and advanced to "1h ago" 30 seconds early at 59m 30s.
    const almostAnHour = Date.parse("2026-04-18T11:00:30Z"); // 59m 30s ago
    expect(formatActivityRelative("2026-04-18T11:00:30Z", anchor)).toMatch(
      /59m ago|59 min\. ago|59 minutes ago/,
    );
    expect(
      formatActivityRelative(new Date(almostAnHour).toISOString(), anchor),
    ).not.toMatch(/1h|1 hr|1 hour/);
  });

  it("advances to hour at exactly 60 full minutes", () => {
    // 60m = 1h
    expect(formatActivityRelative("2026-04-18T11:00:00Z", anchor)).toMatch(
      /1h ago|1 hr\. ago|1 hour ago/,
    );
  });

  it("holds hour unit until the next full hour", () => {
    // 23h 55m ago should still be "23h ago", not "1d ago"
    expect(formatActivityRelative("2026-04-17T12:05:00Z", anchor)).toMatch(
      /23h ago|23 hr\. ago|23 hours ago/,
    );
  });

  it("advances to day at exactly 24 full hours", () => {
    expect(formatActivityRelative("2026-04-17T12:00:00Z", anchor)).toMatch(
      /1d ago|1 day ago/,
    );
  });

  it("clamps negative deltas (future timestamps) to 'just now'", () => {
    // Clock skew between client and server shouldn't render "in 5s".
    expect(formatActivityRelative("2026-04-18T12:00:10Z", anchor)).toBe(
      "just now",
    );
  });

  it("returns empty string for invalid ISO input", () => {
    expect(formatActivityRelative("not-a-date", anchor)).toBe("");
  });
});
