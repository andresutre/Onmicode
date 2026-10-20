import { describe, expect, it } from "vitest";
import { planStepCount } from "./PlanStepsBurst";
import { shouldCelebrateTurn } from "./turnCelebration";

describe("turn celebrations", () => {
  it("celebrates only a turn sent moments ago", () => {
    const now = 1_000_000;
    expect(shouldCelebrateTurn("fresh", now - 500, now)).toBe(true);
    expect(shouldCelebrateTurn("old", now - 60_000, now)).toBe(false);
    expect(shouldCelebrateTurn("unknown", undefined, now)).toBe(false);
  });

  it("fits a short plan into a narrow bubble and caps a wide one", () => {
    expect(planStepCount(40)).toBe(2);
    expect(planStepCount(260)).toBe(4);
    expect(planStepCount(900)).toBe(6);
  });
});
