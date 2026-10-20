import { formatShare } from "./usageFormat";

export type ShareSegment = {
  label: string;
  value: number;
  /** Background class for the segment and its legend swatch. */
  tone: string;
};

/** One thin bar split by share, with every segment's value in the legend. */
export function UsageShareBar({
  title,
  segments,
  format,
}: {
  title: string;
  segments: ShareSegment[];
  format: (value: number) => string;
}) {
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h4 className="text-[12px] font-medium text-content/80">{title}</h4>
      <div
        role="img"
        aria-label={`${title}: ${visible
          .map((segment) => `${segment.label} ${format(segment.value)}`)
          .join(", ")}`}
        className="flex h-2 gap-0.5"
      >
        {visible.map((segment) => (
          <span
            key={segment.label}
            title={`${segment.label} · ${format(segment.value)} · ${formatShare(segment.value / total)}`}
            className={`h-full min-w-1 rounded-[2px] first:rounded-l-full last:rounded-r-full ${segment.tone}`}
            style={{ flex: `${segment.value} 1 0` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4">
        {visible.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`size-2 rounded-[2px] ${segment.tone}`}
            />
            <span className="text-content/50">{segment.label}</span>
            <span className="tabular-nums text-content/80">
              {format(segment.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
