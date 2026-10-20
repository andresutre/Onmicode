import { describe, expect, it } from "vitest";
import { axisDays, niceScale } from "./UsageHistoryChart";
import {
  usageWindow,
  type UsageBucket,
  type UsageHistory,
} from "./usageHistory";
import { isUnpriced, rowShare, sortRows, summarizeUsage } from "./usageSummary";

const window = usageWindow(3, new Date(2026, 9, 20, 12));

function bucket(overrides: Partial<UsageBucket>): UsageBucket {
  return {
    day: 0,
    harness: "claude",
    model: "claude:opus-4.5",
    project: "/work/app",
    turns: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

// Rust sends buckets oldest day first.
const history: UsageHistory = {
  buckets: [
    bucket({
      modelName: "Opus 4.5",
      turns: 2,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 2_000_000,
    }),
    bucket({
      day: 1,
      modelName: "Claude Opus 4.5",
      project: "/work/lib",
      outputTokens: 1_000,
    }),
    bucket({
      day: 2,
      harness: "codex",
      model: "codex:gpt-5",
      modelName: "GPT-5",
      inputTokens: 1_000_000,
    }),
    bucket({
      day: 2,
      harness: "pi",
      model: "pi:default",
      modelName: "Default",
      project: "/work/lib",
      outputTokens: 500_000,
    }),
    bucket({
      day: 2,
      harness: "hermes",
      model: "hermes:default",
      outputTokens: 10,
    }),
  ],
  sessions: 4,
  unreported: [{ harness: "cursor", sessions: 2 }],
};

describe("summarizeUsage", () => {
  const summary = summarizeUsage(history, window);

  it("totals tokens and prices only what has a price", () => {
    expect(summary.totals.turns).toBe(6);
    expect(summary.totals.totalTokens).toBe(4_601_010);
    // Opus 4.5: $5 input + $2.50 output + $1 cache reads, then $0.025 more
    // output; GPT-5: $1.25 input.
    expect(summary.totals.costUsd).toBeCloseTo(9.775);
    expect(summary.totals.cost.cacheRead).toBeCloseTo(1);
    expect(summary.totals.cacheSavingsUsd).toBeCloseTo(9);
    expect(summary.totals.unpricedTokens).toBe(500_010);
    expect(summary.sessions).toBe(4);
    expect(summary.unreported).toEqual([{ harness: "cursor", sessions: 2 }]);
  });

  it("puts each bucket on its day, stacked by agent in palette order", () => {
    expect(summary.series).toEqual(["claude", "codex", "pi", "other"]);
    expect(summary.days.map((day) => day.day)).toEqual(window.days);
    expect(summary.days[0].totals.turns).toBe(2);
    expect(summary.days[2].bySeries.get("codex")?.totalTokens).toBe(1_000_000);
    expect(summary.days[2].bySeries.get("other")?.outputTokens).toBe(10);
  });

  it("merges a model's labels into one row named by the latest", () => {
    const opus = summary.models.find((row) => row.key.startsWith("claude"));
    expect(opus).toMatchObject({
      label: "Claude Opus 4.5",
      detail: "Claude Code",
      series: "claude",
    });
    expect(opus?.totals.turns).toBe(3);
  });

  it("keeps an alias's generations apart by the label they were sent with", () => {
    const aliased = summarizeUsage(
      {
        buckets: [
          bucket({
            model: "claude:opus",
            modelName: "Opus 4.8",
            outputTokens: 1_000_000,
          }),
          bucket({
            model: "claude:opus",
            modelName: "Opus 5.5",
            outputTokens: 1_000_000,
          }),
        ],
        sessions: 1,
        unreported: [],
      },
      window,
    );
    expect(
      aliased.models.map((row) => [row.label, row.totals.costUsd]),
    ).toEqual([
      ["Opus 4.8", 25],
      ["Opus 5.5", 20],
    ]);
  });

  it("groups by agent and project", () => {
    expect(summary.agents.map((row) => row.label)).toEqual([
      "Claude Code",
      "Codex",
      "Pi",
      "Hermes Agent",
    ]);
    expect(
      summary.projects.map((row) => [row.label, row.detail, row.totals.turns]),
    ).toEqual([
      ["app", "/work/app", 4],
      ["lib", "/work/lib", 2],
    ]);
  });

  it("sorts by the shown metric and leaves unpriced rows without a cost share", () => {
    const byCost = sortRows(summary.agents, "cost");
    expect(byCost.map((row) => row.key)).toEqual([
      "claude",
      "codex",
      "pi",
      "hermes",
    ]);
    const pi = byCost[2];
    expect(isUnpriced(pi.totals)).toBe(true);
    expect(rowShare(pi.totals, summary.totals, "cost")).toBeNull();
    expect(rowShare(pi.totals, summary.totals, "tokens")).toBeCloseTo(
      500_000 / 4_601_010,
    );
  });
});

describe("chart scale", () => {
  it("rounds the axis up to clean steps", () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0] });
    expect(niceScale(37)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceScale(0.37)).toEqual({
      max: 0.4,
      ticks: [0, 0.1, 0.2, 0.3, 0.4],
    });
    expect(niceScale(4_601_010).ticks).toEqual([0, 2e6, 4e6, 6e6]);
  });

  it("labels every day of a week and four days of longer periods", () => {
    expect(axisDays(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(axisDays(30)).toEqual([0, 10, 19, 29]);
    expect(axisDays(90)).toEqual([0, 30, 59, 89]);
  });
});
