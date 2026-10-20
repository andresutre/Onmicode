import {
  clampUsedPercent,
  type RateLimitWindow,
} from "../../providers/model/rateLimits";

/**
 * Pace compares how much of a window is spent with how much of it has
 * passed. Adapted from T3 Code's usage limits (MIT, see NOTICE).
 */
export type UsagePace = "ahead" | "on" | "under";

/** Points either side of even spending that still read as on pace. */
export const PACE_TOLERANCE_PERCENT = 5;

export const PACE_COPY: Record<UsagePace, { label: string; detail: string }> = {
  ahead: {
    label: "Ahead of pace",
    detail:
      "Spending faster than the window passes. At this rate it runs out before it resets.",
  },
  on: {
    label: "On pace",
    detail: "Spending in step with the window.",
  },
  under: {
    label: "Under pace",
    detail: "Headroom left for the rest of the window.",
  },
};

/**
 * Share of the window already behind us, 0 to 1. Null without a reset time,
 * and once the reset has passed: the snapshot then describes an old window.
 */
export function elapsedShare(
  window: RateLimitWindow,
  now: number,
): number | null {
  if (window.resetsAt == null || window.windowMinutes <= 0) return null;
  if (window.resetsAt <= now) return null;
  const length = window.windowMinutes * 60_000;
  return Math.max(0, Math.min(1, (length - (window.resetsAt - now)) / length));
}

export function usagePace(
  window: RateLimitWindow,
  now: number,
): UsagePace | null {
  const elapsed = elapsedShare(window, now);
  if (elapsed == null) return null;
  const gap = clampUsedPercent(window.usedPercent) - elapsed * 100;
  if (gap > PACE_TOLERANCE_PERCENT) return "ahead";
  if (gap < -PACE_TOLERANCE_PERCENT) return "under";
  return "on";
}

/**
 * Where even spending sits on a bar, as a percent of its width. A bar that
 * fills with what is left marks the time left; one that fills with what is
 * used marks the time gone.
 */
export function evenPacePercent(
  window: RateLimitWindow,
  now: number,
  showRemaining: boolean,
): number | null {
  const elapsed = elapsedShare(window, now);
  if (elapsed == null) return null;
  return Math.round((showRemaining ? 1 - elapsed : elapsed) * 100);
}
