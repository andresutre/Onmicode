import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { prettyCwd, projectKey, projectName } from "../../../shared/lib/paths";
import { agentSeriesKey, compareAgentSeries } from "./usageColors";
import type { UsageBucket, UsageHistory, UsageWindow } from "./usageHistory";
import {
  cacheSavings,
  costByType,
  modelPrice,
  modelPriceKey,
  type CostByType,
  type ModelPrice,
  type TokenCounts,
} from "./usagePrices";

export type UsageMetric = "tokens" | "cost";

export type UsageTotals = TokenCounts & {
  turns: number;
  /** Every token the models processed: input, cache reads and writes, output. */
  totalTokens: number;
  /** Estimated cost of the priced tokens only. */
  costUsd: number;
  cost: CostByType;
  cacheSavingsUsd: number;
  /** Tokens from models without a price, left out of `costUsd`. */
  unpricedTokens: number;
};

export type BreakdownRow = {
  key: string;
  label: string;
  /** The agent behind a model, or a project's full path. */
  detail?: string;
  /** Chart series that colours the row, for agent and model rows. */
  series?: string;
  totals: UsageTotals;
};

export type UsageDay = {
  day: string;
  totals: UsageTotals;
  /** Totals per chart series (agent, or the shared "Other"). */
  bySeries: Map<string, UsageTotals>;
};

export type UsageSummary = {
  totals: UsageTotals;
  /** Chart series present in the period, in stack order. */
  series: string[];
  days: UsageDay[];
  agents: BreakdownRow[];
  models: BreakdownRow[];
  projects: BreakdownRow[];
  sessions: number;
  unreported: UsageHistory["unreported"];
};

export function emptyTotals(): UsageTotals {
  return {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cacheSavingsUsd: 0,
    unpricedTokens: 0,
  };
}

function addBucket(
  totals: UsageTotals,
  bucket: UsageBucket,
  rate: ModelPrice | null,
): void {
  const tokens =
    bucket.inputTokens +
    bucket.outputTokens +
    bucket.cacheReadTokens +
    bucket.cacheWriteTokens;
  totals.turns += bucket.turns;
  totals.inputTokens += bucket.inputTokens;
  totals.outputTokens += bucket.outputTokens;
  totals.cacheReadTokens += bucket.cacheReadTokens;
  totals.cacheWriteTokens += bucket.cacheWriteTokens;
  totals.totalTokens += tokens;
  if (!rate) {
    totals.unpricedTokens += tokens;
    return;
  }
  const cost = costByType(bucket, rate);
  totals.cost.input += cost.input;
  totals.cost.output += cost.output;
  totals.cost.cacheRead += cost.cacheRead;
  totals.cost.cacheWrite += cost.cacheWrite;
  totals.costUsd += cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  totals.cacheSavingsUsd += cacheSavings(bucket, rate);
}

/**
 * One row per model, whatever label the picker gave it at the time. A
 * concrete id (`claude:opus-4.5`) is its own identity; a moving alias
 * (`claude:opus`, `pi:default`) is told apart by the label it was sent with.
 */
function modelIdentity(bucket: UsageBucket): string {
  const fromId = modelPriceKey(bucket.model);
  const key =
    /\d/.test(fromId) || !bucket.modelName
      ? fromId
      : modelPriceKey(bucket.modelName);
  return `${bucket.harness}\u0000${key}`;
}

function modelLabel(bucket: UsageBucket): string {
  if (bucket.modelName) return bucket.modelName;
  const colon = bucket.model.indexOf(":");
  return (
    (colon >= 0 ? bucket.model.slice(colon + 1) : bucket.model) || "Default"
  );
}

export function agentTitle(harness: string): string {
  return HARNESS_TITLE[harness as HarnessId] ?? harness;
}

export function summarizeUsage(
  history: UsageHistory,
  window: UsageWindow,
): UsageSummary {
  const totals = emptyTotals();
  const days: UsageDay[] = window.days.map((day) => ({
    day,
    totals: emptyTotals(),
    bySeries: new Map(),
  }));
  const agents = new Map<string, BreakdownRow>();
  const models = new Map<string, BreakdownRow>();
  const projects = new Map<string, BreakdownRow>();
  const rates = new Map<string, ModelPrice | null>();
  const series = new Set<string>();

  const row = (
    rows: Map<string, BreakdownRow>,
    key: string,
    make: () => Omit<BreakdownRow, "key" | "totals">,
  ) => {
    let entry = rows.get(key);
    if (!entry) {
      entry = { key, ...make(), totals: emptyTotals() };
      rows.set(key, entry);
    }
    return entry;
  };

  // Buckets arrive oldest first, so the last label seen is the current one.
  for (const bucket of history.buckets) {
    const rateKey = `${bucket.model}\u0000${bucket.modelName ?? ""}`;
    let rate = rates.get(rateKey);
    if (rate === undefined) {
      rate = modelPrice(bucket.model, bucket.modelName);
      rates.set(rateKey, rate);
    }
    const seriesKey = agentSeriesKey(bucket.harness);
    series.add(seriesKey);

    addBucket(totals, bucket, rate);
    const day = days[bucket.day];
    if (day) {
      addBucket(day.totals, bucket, rate);
      let daySeries = day.bySeries.get(seriesKey);
      if (!daySeries) {
        daySeries = emptyTotals();
        day.bySeries.set(seriesKey, daySeries);
      }
      addBucket(daySeries, bucket, rate);
    }
    addBucket(
      row(agents, bucket.harness, () => ({
        label: agentTitle(bucket.harness),
        series: seriesKey,
      })).totals,
      bucket,
      rate,
    );
    const model = row(models, modelIdentity(bucket), () => ({
      label: modelLabel(bucket),
      detail: agentTitle(bucket.harness),
      series: seriesKey,
    }));
    model.label = modelLabel(bucket);
    addBucket(model.totals, bucket, rate);
    addBucket(
      row(projects, projectKey(bucket.project), () => ({
        label: projectName(bucket.project),
        detail: prettyCwd(bucket.project),
      })).totals,
      bucket,
      rate,
    );
  }

  return {
    totals,
    series: [...series].sort(compareAgentSeries),
    days,
    agents: [...agents.values()],
    models: [...models.values()],
    projects: [...projects.values()],
    sessions: history.sessions,
    unreported: history.unreported,
  };
}

export function metricValue(totals: UsageTotals, metric: UsageMetric): number {
  return metric === "tokens" ? totals.totalTokens : totals.costUsd;
}

/** Nothing about this usage could be priced. */
export function isUnpriced(totals: UsageTotals): boolean {
  return totals.costUsd === 0 && totals.unpricedTokens > 0;
}

/** Largest first by the shown metric; ties, and unpriced rows, by tokens. */
export function sortRows(
  rows: BreakdownRow[],
  metric: UsageMetric,
): BreakdownRow[] {
  return [...rows].sort(
    (a, b) =>
      metricValue(b.totals, metric) - metricValue(a.totals, metric) ||
      b.totals.totalTokens - a.totals.totalTokens ||
      a.label.localeCompare(b.label),
  );
}

/**
 * A row's share of the period. A cost share needs a price: an unpriced row
 * has a token share but no cost share.
 */
export function rowShare(
  row: UsageTotals,
  all: UsageTotals,
  metric: UsageMetric,
): number | null {
  if (metric === "cost" && isUnpriced(row)) return null;
  const whole = metricValue(all, metric);
  return whole > 0 ? metricValue(row, metric) / whole : null;
}
