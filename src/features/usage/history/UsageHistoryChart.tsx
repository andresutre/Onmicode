import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Popover } from "../../../shared/ui/Popover";
import { agentSeries, OTHER_AGENTS } from "./usageColors";
import { formatDay, formatTokens, formatUsd } from "./usageFormat";
import {
  agentTitle,
  emptyTotals,
  metricValue,
  type UsageDay,
  type UsageMetric,
} from "./usageSummary";

const PLOT_HEIGHT = 168;
/** Room above the top gridline, so a peak column's rounded cap shows. */
const PLOT_TOP = 6;
const AXIS_WIDTH = 48;
const MAX_BAR_WIDTH = 24;
/** Surface gap between stacked segments. */
const SEGMENT_GAP = 2;
const TICKS = 4;
/** Column width that fits a centred "Oct 20" label. */
const LABEL_ROOM = 48;
const FALLBACK_WIDTH = 640;
const EMPTY = emptyTotals();

export function seriesLabel(key: string): string {
  return key === OTHER_AGENTS ? "Other agents" : agentTitle(key);
}

/** Round axis steps (1, 2, 2.5 or 5 times a power of ten) covering `peak`. */
export function niceScale(
  peak: number,
  count = TICKS,
): { max: number; ticks: number[] } {
  if (!(peak > 0)) return { max: 1, ticks: [0] };
  const raw = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate >= raw * (1 - 1e-9)) ?? 10 * magnitude;
  const steps = Math.ceil(peak / step - 1e-9);
  const ticks = Array.from(
    { length: steps + 1 },
    (_, index) => Math.round(index * step * 1e9) / 1e9,
  );
  return { max: ticks[ticks.length - 1], ticks };
}

/** Days to label on the x axis: every day for a week, else four. */
export function axisDays(count: number): number[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index);
  const last = count - 1;
  return [0, Math.round(last / 3), Math.round((2 * last) / 3), last];
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** A column segment with a 4px rounded cap and a square base. */
function cappedBar(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    "Z",
  ].join(" ");
}

type Active = { index: number; rect: DOMRect };

/**
 * Daily columns stacked by agent. Hover or arrow keys show one day's split
 * in a tooltip; the breakdown's day table carries the same numbers for
 * anyone who cannot use either.
 */
export function UsageHistoryChart({
  days,
  series,
  metric,
}: {
  days: UsageDay[];
  series: string[];
  metric: UsageMetric;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<(SVGRectElement | null)[]>([]);
  const width = Math.max(1, useWidth(plotRef));
  const [active, setActive] = useState<Active | null>(null);
  const format = metric === "tokens" ? formatTokens : formatUsd;

  const columns = days.map((day) =>
    series.map((key) => metricValue(day.bySeries.get(key) ?? EMPTY, metric)),
  );
  const totals = columns.map((values) =>
    values.reduce((sum, value) => sum + value, 0),
  );
  const peak = Math.max(0, ...totals);
  const scale = niceScale(peak);
  const toY = (value: number) =>
    PLOT_HEIGHT - (value / scale.max) * (PLOT_HEIGHT - PLOT_TOP);
  const band = width / Math.max(1, days.length);
  const barWidth = Math.max(1, Math.min(MAX_BAR_WIDTH, band * 0.72));

  const peakIndex = totals.indexOf(peak);
  const title = metric === "tokens" ? "processed tokens" : "estimated cost";
  const summary =
    days.length === 0
      ? `Daily ${title}`
      : `Daily ${title} by agent, ${formatDay(days[0].day)} to ${formatDay(days[days.length - 1].day)}.` +
        (peak > 0
          ? ` Highest: ${format(peak)} on ${formatDay(days[peakIndex].day)}.`
          : "");

  const show = (index: number) => {
    const column = columnRefs.current[index];
    if (column) setActive({ index, rect: column.getBoundingClientRect() });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (days.length === 0) return;
    const current = active?.index ?? days.length - 1;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, current - 1)
        : event.key === "ArrowRight"
          ? Math.min(days.length - 1, current + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? days.length - 1
              : null;
    if (next == null) return;
    event.preventDefault();
    show(next);
  };

  const activeDay = active ? days[active.index] : undefined;
  const activeValues = active ? columns[active.index] : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex">
        <div
          className="relative shrink-0"
          style={{ width: AXIS_WIDTH, height: PLOT_HEIGHT }}
          aria-hidden
        >
          {peak > 0
            ? scale.ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-2 -translate-y-1/2 text-[10px] leading-none tabular-nums text-content/40"
                  style={{ top: toY(tick) }}
                >
                  {tick === 0 ? "0" : format(tick)}
                </span>
              ))
            : null}
        </div>
        <div
          ref={plotRef}
          role="group"
          tabIndex={0}
          aria-label={`${summary} Use the arrow keys to read each day.`}
          className="relative min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent"
          style={{ height: PLOT_HEIGHT }}
          onPointerLeave={() => setActive(null)}
          onFocus={() => {
            if (!active && days.length > 0) show(days.length - 1);
          }}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <svg
            width={width}
            height={PLOT_HEIGHT}
            className="block overflow-visible"
            // The focusable group above names the chart; one label is enough.
            aria-hidden
          >
            {scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={width}
                y1={toY(tick) - 0.5}
                y2={toY(tick) - 0.5}
                strokeWidth={1}
                className={
                  tick === 0 ? "stroke-content/20" : "stroke-content/8"
                }
              />
            ))}
            {active ? (
              <rect
                x={active.index * band}
                y={0}
                width={band}
                height={PLOT_HEIGHT}
                className="fill-content/6"
              />
            ) : null}
            {columns.map((values, index) => {
              const x = index * band + (band - barWidth) / 2;
              const segments: { key: string; top: number; bottom: number }[] =
                [];
              let base = PLOT_HEIGHT;
              values.forEach((value, slot) => {
                if (value <= 0) return;
                const top = toY(value) - (PLOT_HEIGHT - base);
                segments.push({ key: series[slot], top, bottom: base });
                base = top;
              });
              return (
                <g key={days[index].day}>
                  {segments.map((segment, position) => {
                    const capped = position === segments.length - 1;
                    const height = segment.bottom - segment.top;
                    // Leave the gap only where the segment can spare it.
                    const top =
                      !capped && height > SEGMENT_GAP + 1
                        ? segment.top + SEGMENT_GAP
                        : segment.top;
                    const fill = agentSeries(segment.key).fill;
                    return capped ? (
                      <path
                        key={segment.key}
                        d={cappedBar(x, top, barWidth, segment.bottom - top)}
                        className={fill}
                      />
                    ) : (
                      <rect
                        key={segment.key}
                        x={x}
                        y={top}
                        width={barWidth}
                        height={segment.bottom - top}
                        className={fill}
                      />
                    );
                  })}
                </g>
              );
            })}
            {days.map((day, index) => (
              <rect
                key={day.day}
                ref={(element) => {
                  columnRefs.current[index] = element;
                }}
                x={index * band}
                y={0}
                width={band}
                height={PLOT_HEIGHT}
                fill="transparent"
                onPointerEnter={() => show(index)}
              />
            ))}
          </svg>
          {active && activeDay && activeValues ? (
            <Popover
              anchor={active.rect}
              side="top"
              align="center"
              className="pointer-events-none w-max min-w-36 px-2.5 py-2"
            >
              <UsageDayTooltip
                day={activeDay.day}
                total={totals[active.index]}
                rows={series
                  .map((key, slot) => ({ key, value: activeValues[slot] }))
                  .filter((row) => row.value > 0)
                  .reverse()}
                format={format}
              />
            </Popover>
          ) : null}
          <div className="sr-only" aria-live="polite">
            {active && activeDay
              ? `${formatDay(activeDay.day)}: ${format(totals[active.index])}`
              : ""}
          </div>
        </div>
      </div>
      <div
        className="relative h-3 text-[10px] leading-3 text-content/40"
        style={{ marginLeft: AXIS_WIDTH }}
        aria-hidden
      >
        {axisDays(days.length).map((index) => {
          // A label sits under its column unless the columns are too narrow
          // to hold it; then the outer two align to the plot's edges.
          const start = index === 0 && band < LABEL_ROOM;
          const end = index === days.length - 1 && band < LABEL_ROOM;
          const edge = start
            ? "translate-x-0"
            : end
              ? "-translate-x-full"
              : "-translate-x-1/2";
          const left = start
            ? 0
            : end
              ? (index + 1) * band
              : (index + 0.5) * band;
          return (
            <span
              key={index}
              className={`absolute top-0 whitespace-nowrap ${edge}`}
              style={{ left }}
            >
              {formatDay(days[index].day)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function UsageDayTooltip({
  day,
  total,
  rows,
  format,
}: {
  day: string;
  total: number;
  rows: { key: string; value: number }[];
  format: (value: number) => string;
}) {
  return (
    <div className="text-[11px] leading-4">
      <div className="text-content/50">{formatDay(day)}</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-4">
        <span className="text-[13px] font-medium tabular-nums text-content">
          {format(total)}
        </span>
        <span className="text-content/50">Total</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-content/50">
            <span
              aria-hidden
              className={`h-0.5 w-2.5 rounded-full ${agentSeries(row.key).swatch}`}
            />
            {seriesLabel(row.key)}
          </span>
          {/* One agent's value is the total above; don't say it twice. */}
          {rows.length > 1 ? (
            <span className="tabular-nums text-content">
              {format(row.value)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
