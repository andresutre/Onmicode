import { beforeEach, expect, it, vi } from "vitest";
import { loadUsageHistory, usageWindow } from "./usageHistory";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

beforeEach(() => mocks.invoke.mockReset());

it("covers the last calendar days up to the end of today", () => {
  const now = new Date(2026, 9, 20, 15, 30);
  const window = usageWindow(7, now);

  expect(window.days).toEqual([
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ]);
  expect(window.dayStarts).toHaveLength(8);
  expect(window.dayStarts[0]).toBe(new Date(2026, 9, 14).getTime());
  expect(window.dayStarts[7]).toBe(new Date(2026, 9, 21).getTime());
  expect(now.getTime()).toBeGreaterThanOrEqual(window.dayStarts[6]);
  expect(now.getTime()).toBeLessThan(window.dayStarts[7]);
});

it("crosses month and year boundaries on local midnights", () => {
  const window = usageWindow(3, new Date(2026, 0, 1, 9));
  expect(window.days).toEqual(["2025-12-30", "2025-12-31", "2026-01-01"]);
  for (const start of window.dayStarts) {
    const midnight = new Date(start);
    expect([midnight.getHours(), midnight.getMinutes()]).toEqual([0, 0]);
  }
});

it("asks Rust for the period's day boundaries", async () => {
  const history = { buckets: [], sessions: 0, unreported: [] };
  mocks.invoke.mockResolvedValue(history);
  const window = usageWindow(7, new Date(2026, 9, 20));

  await expect(loadUsageHistory(window)).resolves.toBe(history);
  expect(mocks.invoke).toHaveBeenCalledWith("usage_history", {
    request: { dayStarts: window.dayStarts },
  });
});
