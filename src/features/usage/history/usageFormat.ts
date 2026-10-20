const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/** Dollars to the cent; a cost too small to show reads as under a cent. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) return "<$0.01";
  return USD.format(value);
}

/** Token counts as 950, 12.4K, 3.1M. */
export function formatTokens(value: number): string {
  return COMPACT.format(Math.max(0, Math.round(value)));
}

export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** A 0–1 share as a percentage; a sliver reads as `<0.1%`, never `0.0%`. */
export function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/** `2026-10-05` as `Oct 5`, without a time zone round trip. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return DAY_LABEL.format(new Date(year, month - 1, date));
}
