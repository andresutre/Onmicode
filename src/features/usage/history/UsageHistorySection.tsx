import { useEffect, useId, useState } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { agentSeries } from "./usageColors";
import {
  formatCount,
  formatDay,
  formatShare,
  formatTokens,
  formatUsd,
} from "./usageFormat";
import {
  loadUsageHistory,
  USAGE_PERIODS,
  usageWindow,
  type UsagePeriod,
} from "./usageHistory";
import {
  agentTitle,
  isUnpriced,
  metricValue,
  rowShare,
  sortRows,
  summarizeUsage,
  type BreakdownRow,
  type UsageMetric,
  type UsageSummary,
  type UsageTotals,
} from "./usageSummary";
import { seriesLabel, UsageHistoryChart } from "./UsageHistoryChart";
import { UsageShareBar, type ShareSegment } from "./UsageShareBar";

type Breakdown = "agent" | "model" | "project" | "day";

const METRIC_KEY = "monocode.usageHistory.metric";
const PERIOD_KEY = "monocode.usageHistory.days";

const METRICS: { value: UsageMetric; label: string }[] = [
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
];

const BREAKDOWNS: { value: Breakdown; label: string }[] = [
  { value: "agent", label: "Agent" },
  { value: "model", label: "Model" },
  { value: "project", label: "Project" },
  { value: "day", label: "Day" },
];

/** Token types from quietest to loudest ink, as in the share bar's legend. */
const TYPE_TONES = {
  input: "bg-content/55",
  cacheRead: "bg-content/25",
  cacheWrite: "bg-content/75",
  output: "bg-content",
};

function storedMetric(): UsageMetric {
  try {
    return localStorage.getItem(METRIC_KEY) === "cost" ? "cost" : "tokens";
  } catch {
    return "tokens";
  }
}

function storedPeriod(): UsagePeriod {
  try {
    const days = Number(localStorage.getItem(PERIOD_KEY));
    return USAGE_PERIODS.find((period) => period === days) ?? 30;
  } catch {
    return 30;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; a full or blocked store changes nothing.
  }
}

type Loaded = { summary: UsageSummary; period: UsagePeriod };

/**
 * Tokens and estimated cost from every saved session, by day, agent, model
 * and project. Self-contained: it loads its own data and keeps its own
 * metric and period.
 */
export function UsageHistorySection({
  className = "",
}: {
  className?: string;
}) {
  const [metric, setMetric] = useState<UsageMetric>(storedMetric);
  const [period, setPeriod] = useState<UsagePeriod>(storedPeriod);
  const [breakdown, setBreakdown] = useState<Breakdown>("agent");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const titleId = useId();

  useEffect(() => {
    let current = true;
    const range = usageWindow(period);
    setLoading(true);
    loadUsageHistory(range)
      .then((history) => {
        if (!current) return;
        setLoaded({ summary: summarizeUsage(history, range), period });
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [period, reload]);

  const chooseMetric = (next: UsageMetric) => {
    setMetric(next);
    store(METRIC_KEY, next);
  };
  const choosePeriod = (next: UsagePeriod) => {
    setPeriod(next);
    store(PERIOD_KEY, String(next));
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading}
      className={`flex min-w-0 flex-col gap-5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-[13px] font-medium text-content">
          Usage history
        </h2>
        <div className="flex items-center gap-2">
          <Segmented
            label="Usage metric"
            value={metric}
            options={METRICS}
            onChange={chooseMetric}
          />
          <Segmented
            label="Usage period"
            value={String(period)}
            options={USAGE_PERIODS.map((days) => ({
              value: String(days),
              label: `${days}d`,
              title: `Last ${days} days`,
            }))}
            onChange={(value) => choosePeriod(Number(value) as UsagePeriod)}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => setReload((count) => count + 1)}
            aria-label="Refresh usage history"
            title="Refresh usage history"
            className="grid size-7 place-items-center rounded-md text-content/40 transition-transform duration-150 hover:bg-content/10 hover:text-content active:scale-[0.96] disabled:opacity-40"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>

      {loaded ? (
        <div
          className={`flex min-w-0 flex-col gap-6 transition-opacity ${
            loading ? "opacity-50 delay-150" : ""
          }`}
        >
          {error ? <LoadError message={error} /> : null}
          <UsageOverview
            summary={loaded.summary}
            period={loaded.period}
            metric={metric}
            breakdown={breakdown}
            onBreakdown={setBreakdown}
          />
        </div>
      ) : error ? (
        <LoadError
          message={error}
          onRetry={() => setReload((count) => count + 1)}
        />
      ) : (
        <UsageSkeleton />
      )}
    </section>
  );
}

function UsageOverview({
  summary,
  period,
  metric,
  breakdown,
  onBreakdown,
}: {
  summary: UsageSummary;
  period: UsagePeriod;
  metric: UsageMetric;
  breakdown: Breakdown;
  onBreakdown: (next: Breakdown) => void;
}) {
  const { totals } = summary;
  const format = metric === "tokens" ? formatTokens : formatUsd;

  if (totals.turns === 0) {
    return (
      <div className="flex flex-col gap-2 py-8 text-center text-[12px] text-content/50">
        <p>No token usage recorded in the last {period} days.</p>
        <UsageNotes summary={summary} metric={metric} />
      </div>
    );
  }

  const unpricedShare =
    totals.totalTokens > 0 ? totals.unpricedTokens / totals.totalTokens : 0;
  const rows =
    breakdown === "agent"
      ? summary.agents
      : breakdown === "model"
        ? summary.models
        : summary.projects;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[32px] font-semibold leading-none text-content">
            {format(metricValue(totals, metric))}
          </span>
          <span className="text-[12px] text-content/50">
            {metric === "tokens" ? "tokens processed" : "estimated"}
          </span>
        </div>
        <p className="text-[12px] text-content/50">
          {plural(summary.sessions, "session")} · {plural(totals.turns, "turn")}
          {metric === "cost"
            ? ` · API list prices${
                unpricedShare > 0
                  ? `, ${formatShare(unpricedShare)} of tokens unpriced`
                  : ""
              }`
            : ` · ${totals.unpricedTokens > 0 ? "≥ " : ""}${formatUsd(totals.costUsd)} estimated`}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[12px] font-medium text-content/80">
            {metric === "tokens"
              ? "Daily processed tokens"
              : "Daily estimated cost"}
          </h3>
          {summary.series.length > 1 ? (
            <ul
              aria-label="Agents"
              className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-content/50"
            >
              {summary.series.map((key) => (
                <li key={key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`size-2 rounded-[2px] ${agentSeries(key).swatch}`}
                  />
                  {seriesLabel(key)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <UsageHistoryChart
          days={summary.days}
          series={summary.series}
          metric={metric}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[12px] font-medium text-content/80">Totals</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Processed tokens"
            value={formatTokens(totals.totalTokens)}
          />
          <Stat
            label="Cached input"
            value={formatTokens(totals.cacheReadTokens)}
          />
          <Stat
            label="Uncached input"
            value={formatTokens(totals.inputTokens)}
          />
          <Stat label="Output" value={formatTokens(totals.outputTokens)} />
          <Stat
            label="Cache savings"
            value={formatUsd(totals.cacheSavingsUsd)}
            title="Cache reads priced as plain input, less what they cost"
          />
        </dl>
      </div>

      <UsageShareBar
        title={metric === "tokens" ? "Tokens by type" : "Cost by type"}
        format={format}
        segments={typeSegments(totals, metric)}
      />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[12px] font-medium text-content/80">Breakdown</h3>
          <Segmented
            label="Usage breakdown"
            value={breakdown}
            options={BREAKDOWNS}
            onChange={onBreakdown}
          />
        </div>
        {breakdown === "day" ? (
          <DayTable summary={summary} />
        ) : (
          <BreakdownTable
            rows={sortRows(rows, metric)}
            totals={totals}
            metric={metric}
            nameLabel={
              BREAKDOWNS.find((option) => option.value === breakdown)!.label
            }
          />
        )}
      </div>

      <UsageNotes summary={summary} metric={metric} />
    </>
  );
}

function typeSegments(
  totals: UsageTotals,
  metric: UsageMetric,
): ShareSegment[] {
  const values =
    metric === "tokens"
      ? {
          input: totals.inputTokens,
          cacheRead: totals.cacheReadTokens,
          cacheWrite: totals.cacheWriteTokens,
          output: totals.outputTokens,
        }
      : totals.cost;
  return [
    { label: "Input", value: values.input, tone: TYPE_TONES.input },
    {
      label: "Cache read",
      value: values.cacheRead,
      tone: TYPE_TONES.cacheRead,
    },
    {
      label: "Cache write",
      value: values.cacheWrite,
      tone: TYPE_TONES.cacheWrite,
    },
    { label: "Output", value: values.output, tone: TYPE_TONES.output },
  ];
}

function CostCell({ totals }: { totals: UsageTotals }) {
  if (isUnpriced(totals)) {
    return <span className="text-content/40">Unpriced</span>;
  }
  if (totals.unpricedTokens > 0) {
    return (
      <span
        title={`Leaves out ${formatTokens(totals.unpricedTokens)} tokens from unpriced models`}
      >
        ≥ {formatUsd(totals.costUsd)}
      </span>
    );
  }
  return <>{formatUsd(totals.costUsd)}</>;
}

function BreakdownTable({
  rows,
  totals,
  metric,
  nameLabel,
}: {
  rows: BreakdownRow[];
  totals: UsageTotals;
  metric: UsageMetric;
  nameLabel: string;
}) {
  const peak = Math.max(
    0,
    ...rows.map((row) => metricValue(row.totals, metric)),
  );
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-stroke text-right text-[11px] text-content/40">
          <th scope="col" className="w-full py-1.5 text-left font-normal">
            {nameLabel}
          </th>
          <th
            scope="col"
            className="hidden py-1.5 pl-4 font-normal sm:table-cell"
          >
            Turns
          </th>
          <th scope="col" className="py-1.5 pl-4 font-normal">
            Tokens
          </th>
          <th scope="col" className="py-1.5 pl-4 font-normal">
            Cost
          </th>
          <th scope="col" className="py-1.5 pl-4 font-normal">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const value = metricValue(row.totals, metric);
          const share = rowShare(row.totals, totals, metric);
          return (
            <tr
              key={row.key}
              className="border-b border-stroke text-right tabular-nums text-content/60"
            >
              <td className="max-w-0 py-2 text-left">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="truncate text-content"
                    title={row.detail ?? row.label}
                  >
                    {row.label}
                  </span>
                  {row.detail && row.series ? (
                    // The agent name gives way before the model name does.
                    <span className="min-w-0 shrink-[4] truncate text-[11px] text-content/40">
                      {row.detail}
                    </span>
                  ) : null}
                </div>
                {value > 0 && peak > 0 ? (
                  <div aria-hidden className="mt-1 h-0.5 max-w-48">
                    <div
                      className={`h-full rounded-full ${
                        row.series
                          ? agentSeries(row.series).swatch
                          : "bg-content/40"
                      }`}
                      style={{ width: `max(0.5rem, ${(value / peak) * 100}%)` }}
                    />
                  </div>
                ) : null}
              </td>
              <td className="hidden py-2 pl-4 sm:table-cell">
                {formatCount(row.totals.turns)}
              </td>
              <td className="py-2 pl-4">
                {formatTokens(row.totals.totalTokens)}
              </td>
              <td className="py-2 pl-4 text-content">
                <CostCell totals={row.totals} />
              </td>
              <td className="py-2 pl-4">
                {share == null ? "" : formatShare(share)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The chart as a table, newest day first, days without activity left out. */
function DayTable({ summary }: { summary: UsageSummary }) {
  const days = summary.days.filter((day) => day.totals.turns > 0).reverse();
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-stroke text-right text-[11px] text-content/40">
          <th
            scope="col"
            className="whitespace-nowrap py-1.5 text-left font-normal"
          >
            Day
          </th>
          <th
            scope="col"
            className="hidden w-full py-1.5 pl-4 text-left font-normal md:table-cell"
          >
            Agents
          </th>
          <th scope="col" className="py-1.5 pl-4 font-normal">
            Turns
          </th>
          <th scope="col" className="py-1.5 pl-4 font-normal">
            Tokens
          </th>
          <th scope="col" className="py-1.5 pl-4 font-normal">
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {days.map((day) => (
          <tr
            key={day.day}
            className="border-b border-stroke text-right tabular-nums text-content/60"
          >
            <td className="py-2 text-left text-content">
              {formatDay(day.day)}
            </td>
            <td className="hidden max-w-0 truncate py-2 pl-4 text-left md:table-cell">
              {summary.series
                .filter((key) => (day.bySeries.get(key)?.turns ?? 0) > 0)
                .map(seriesLabel)
                .join(", ")}
            </td>
            <td className="py-2 pl-4">{formatCount(day.totals.turns)}</td>
            <td className="py-2 pl-4">
              {formatTokens(day.totals.totalTokens)}
            </td>
            <td className="py-2 pl-4 text-content">
              <CostCell totals={day.totals} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UsageNotes({
  summary,
  metric,
}: {
  summary: UsageSummary;
  metric: UsageMetric;
}) {
  const unpriced = summary.models.filter(
    (row) => row.totals.unpricedTokens > 0,
  );
  const unreported = summary.unreported.map(
    (entry) =>
      `${agentTitle(entry.harness)} (${plural(entry.sessions, "session")})`,
  );
  return (
    <div className="flex flex-col gap-1 text-[11px] leading-4 text-content/40">
      {metric === "cost" && summary.totals.turns > 0 ? (
        <p>
          Costs are estimates at standard API list prices. Subscriptions,
          long-context and fast-mode rates bill differently.
        </p>
      ) : null}
      {unpriced.length > 0 ? (
        <p>
          No price for {listOf(unpriced.map((row) => row.label))}, so{" "}
          {formatTokens(summary.totals.unpricedTokens)} tokens are left out of
          the cost.
        </p>
      ) : null}
      {unreported.length > 0 ? (
        <p>Not counted: {listOf(unreported)} recorded no token counts.</p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <dt className="text-[11px] text-content/50">{label}</dt>
      <dd className="text-[15px] font-medium text-content">{value}</dd>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`rounded-[5px] px-2.5 py-1 ${
            value === option.value
              ? "bg-selection text-content"
              : "text-content/50 hover:text-content"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 text-[12px] text-content/50">
      <p role="alert">Couldn't load usage history: {message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md px-2 py-1 text-content/70 hover:bg-content/10 hover:text-content"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-2">
        <div className="h-8 w-36 rounded bg-content/10" />
        <div className="h-3 w-48 rounded bg-content/10" />
      </div>
      <div className="ml-12 h-[168px] rounded bg-content/10" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <div className="h-3 w-20 rounded bg-content/10" />
            <div className="h-4 w-14 rounded bg-content/10" />
          </div>
        ))}
      </div>
      <div className="h-32 rounded bg-content/10" />
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
