import { invoke } from "@tauri-apps/api/core";

/** Token totals for one day, agent, model and project, summed in Rust. */
export type UsageBucket = {
  /** Index into `UsageWindow.days`. */
  day: number;
  harness: string;
  /** Saved model id, e.g. `claude:opus-4.5`. */
  model: string;
  /** Picker label the turns were sent with, when recorded. */
  modelName?: string;
  /** Session project directory. */
  project: string;
  turns: number;
  /** Input that was neither read from nor written to the cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type UsageHistory = {
  buckets: UsageBucket[];
  /** Sessions with at least one counted turn in the period. */
  sessions: number;
  /** Sessions active in the period that recorded no token usage at all. */
  unreported: { harness: string; sessions: number }[];
};

export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export type UsageWindow = {
  /** Local calendar days, oldest first, as `YYYY-MM-DD`. */
  days: string[];
  /** Local midnights: day `i` covers `[dayStarts[i], dayStarts[i + 1])`. */
  dayStarts: number[];
};

/**
 * The last `days` calendar days in the viewer's time zone, ending today.
 * Midnights come from calendar arithmetic, so a day across a DST change is
 * 23 or 25 hours long rather than shifting every boundary after it.
 */
export function usageWindow(days: number, now = new Date()): UsageWindow {
  const window: UsageWindow = { days: [], dayStarts: [] };
  for (let offset = days - 1; offset >= -1; offset -= 1) {
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - offset,
    );
    window.dayStarts.push(midnight.getTime());
    if (offset >= 0) window.days.push(localDay(midnight));
  }
  return window;
}

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function loadUsageHistory(window: UsageWindow): Promise<UsageHistory> {
  return invoke<UsageHistory>("usage_history", {
    request: { dayStarts: window.dayStarts },
  });
}
