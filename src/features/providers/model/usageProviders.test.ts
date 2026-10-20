import { describe, expect, it } from "vitest";
import { idleRateLimits } from "./rateLimits";
import {
  hasUsageToShow,
  otherUsageProvidersFor,
  usageProvidersFor,
} from "./usageProviders";

describe("usage providers", () => {
  it("shows the session's own provider in full and keeps the rest beside it", () => {
    expect(usageProvidersFor("codex")).toEqual(["codex"]);
    expect(otherUsageProvidersFor("codex")).toEqual([
      "claude",
      "opencode",
      "devin",
    ]);
  });

  it("keeps every provider in reach for an agent without usage of its own", () => {
    for (const harness of ["pi", "cursor", undefined] as const) {
      expect(usageProvidersFor(harness)).toEqual([]);
      expect(otherUsageProvidersFor(harness)).toEqual([
        "claude",
        "codex",
        "opencode",
        "devin",
      ]);
    }
  });

  it("counts a provider as having usage once any window is known", () => {
    const empty = idleRateLimits("claude");
    expect(hasUsageToShow(empty)).toBe(false);
    expect(
      hasUsageToShow({
        ...empty,
        weekly: { usedPercent: 40, windowMinutes: 10_080, resetsAt: null },
      }),
    ).toBe(true);
  });
});
