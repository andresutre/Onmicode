import { describe, expect, it } from "vitest";
import type { RateLimitWindow } from "../../providers/model/rateLimits";
import { elapsedShare, evenPacePercent, usagePace } from "./usagePace";

const now = Date.parse("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;

/** A 5-hour window with `hoursLeft` until it resets. */
function window(
  usedPercent: number,
  hoursLeft: number | null,
): RateLimitWindow {
  return {
    usedPercent,
    windowMinutes: 300,
    resetsAt: hoursLeft == null ? null : now + hoursLeft * HOUR,
  };
}

describe("elapsedShare", () => {
  it("measures how much of the window has passed", () => {
    expect(elapsedShare(window(0, 4), now)).toBeCloseTo(0.2);
    expect(elapsedShare(window(0, 1), now)).toBeCloseTo(0.8);
  });

  it("has no clock without a reset time or a length", () => {
    expect(elapsedShare(window(10, null), now)).toBeNull();
    expect(
      elapsedShare(
        { usedPercent: 10, windowMinutes: 0, resetsAt: now + HOUR },
        now,
      ),
    ).toBeNull();
  });

  it("ignores a snapshot whose window has already reset", () => {
    expect(elapsedShare(window(90, 0), now)).toBeNull();
    expect(elapsedShare(window(90, -1), now)).toBeNull();
  });

  it("clamps a reset further away than the window is long", () => {
    expect(elapsedShare(window(0, 7), now)).toBe(0);
  });
});

describe("usagePace", () => {
  it("is ahead when spending outruns the clock", () => {
    // 40% of the window gone, 60% of the quota spent.
    expect(usagePace(window(60, 3), now)).toBe("ahead");
  });

  it("is under when spending trails the clock", () => {
    expect(usagePace(window(10, 3), now)).toBe("under");
  });

  it("stays on pace within five points either side", () => {
    expect(usagePace(window(40, 3), now)).toBe("on");
    expect(usagePace(window(45, 3), now)).toBe("on");
    expect(usagePace(window(35, 3), now)).toBe("on");
    expect(usagePace(window(46, 3), now)).toBe("ahead");
    expect(usagePace(window(34, 3), now)).toBe("under");
  });

  it("reads out-of-range percentages as clamped", () => {
    expect(usagePace(window(140, 3), now)).toBe("ahead");
    expect(usagePace(window(-20, 3), now)).toBe("under");
  });

  it("has no verdict without a clock", () => {
    expect(usagePace(window(60, null), now)).toBeNull();
    expect(usagePace(window(60, 0), now)).toBeNull();
  });
});

describe("evenPacePercent", () => {
  it("marks the time gone on a bar that fills with use", () => {
    expect(evenPacePercent(window(0, 3), now, false)).toBe(40);
  });

  it("marks the time left on a bar that fills with what remains", () => {
    expect(evenPacePercent(window(0, 3), now, true)).toBe(60);
  });

  it("draws no line without a clock", () => {
    expect(evenPacePercent(window(0, null), now, true)).toBeNull();
  });
});
