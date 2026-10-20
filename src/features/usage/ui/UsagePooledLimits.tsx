import {
  formatResetDuration,
  formatUsagePercent,
} from "../../providers/model/rateLimits";
import { barClass } from "../../providers/ui/ProviderAccountUsage";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";
import { evenPacePercent } from "../model/usagePace";
import {
  poolRoomLabel,
  type PoolMember,
  type UsagePool,
  type UsagePoolSummary,
} from "../model/usagePools";
import { usageWindowTitle } from "../model/usageSections";

const EQUAL_WEIGHT =
  "Each account counts the same. Plans with larger allowances are not weighted, so this is an average, not a combined quota.";

const BLOCKED_BY = { session: "5-hour", weekly: "weekly", monthly: "monthly" };

/**
 * A provider's accounts read together: one tile per window kind with a
 * segment per account, how many still have room and when the next frees up.
 */
export function UsagePooledLimits({
  summary,
  now,
}: {
  summary: UsagePoolSummary;
  now: number;
}) {
  if (summary.pools.length === 0) return null;
  return (
    <div className="border-t border-content/5 px-4 py-3" data-usage-pooled>
      <div className="mb-2.5 flex items-baseline gap-1.5">
        <h4 className="text-[12px] font-medium text-content/85">
          All accounts
        </h4>
        <span className="text-[10px] text-content/35" title={EQUAL_WEIGHT}>
          {summary.included} combined, each counted equally
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2">
        {summary.pools.map((pool) => (
          <PoolTile key={pool.kind} pool={pool} now={now} />
        ))}
      </div>
      {summary.excluded.length > 0 ? (
        <p
          className="mt-2 truncate text-[10px] text-content/40"
          data-usage-pool-excluded
          title={summary.excluded
            .map((entry) => `${entry.label}: ${entry.reason}`)
            .join("\n")}
        >
          {summary.excluded.length}{" "}
          {summary.excluded.length === 1 ? "account" : "accounts"} not included:{" "}
          {summary.excluded
            .map((entry) => `${entry.label} (${entry.reason})`)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function PoolTile({ pool, now }: { pool: UsagePool; now: number }) {
  const showRemaining = useShowRemainingUsage();
  const title = usageWindowTitle(pool.kind, pool.members[0].window);
  const average = showRemaining
    ? 100 - pool.averageUsedPercent
    : pool.averageUsedPercent;
  const none = pool.withRoom === 0;
  return (
    <section
      className="rounded-lg bg-content/[0.045] px-3 py-2.5 ring-1 ring-inset ring-content/[0.06]"
      data-usage-pool={pool.kind}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h5 className="min-w-0 truncate text-[11px] font-medium text-content/65">
          {title}
        </h5>
        <span className="shrink-0 tabular-nums" title={EQUAL_WEIGHT}>
          <span className="text-[11px] text-content/45">avg </span>
          <span className="text-[13px] font-semibold text-content">
            {formatUsagePercent(average)}
          </span>{" "}
          <span className="text-[11px] text-content/45">
            {showRemaining ? "left" : "used"}
          </span>
        </span>
      </div>
      <div
        className="mt-2 grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${pool.members.length}, minmax(0, 1fr))`,
        }}
      >
        {pool.members.map((member) => (
          <PoolSegment
            key={member.key}
            member={member}
            title={title}
            now={now}
            showRemaining={showRemaining}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] leading-4">
        <span
          className={`shrink-0 ${none ? "font-medium text-red-400" : "text-content/50"}`}
        >
          {poolRoomLabel(pool.withRoom, pool.members.length)}
        </span>
        {pool.nextFreeAt != null ? (
          <span
            className="min-w-0 truncate text-right tabular-nums text-content/40"
            title={new Date(pool.nextFreeAt).toLocaleString()}
          >
            {pool.nextFreeAt <= now
              ? "Next account frees up now"
              : `Next account frees up in ${formatResetDuration(pool.nextFreeAt - now)}`}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function PoolSegment({
  member,
  title,
  now,
  showRemaining,
}: {
  member: PoolMember;
  title: string;
  now: number;
  showRemaining: boolean;
}) {
  const used = member.usedPercent;
  const shown = showRemaining ? 100 - used : used;
  const full = used >= 100;
  const marker = full
    ? null
    : evenPacePercent(member.window, now, showRemaining);
  const when =
    member.freesAt != null
      ? member.freesAt <= now
        ? "frees up now"
        : `frees up in ${formatResetDuration(member.freesAt - now)}`
      : member.window.resetsAt != null && member.window.resetsAt > now
        ? `resets in ${formatResetDuration(member.window.resetsAt - now)}`
        : null;
  const detail = [
    `${member.label}: ${formatUsagePercent(shown)} ${showRemaining ? "left" : "used"}`,
    member.blockedBy
      ? `held back by its spent ${BLOCKED_BY[member.blockedBy]} limit`
      : null,
    when,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="min-w-0" title={detail} data-usage-pool-member={member.key}>
      <div className="relative">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-content/10"
          role="progressbar"
          aria-label={`${member.label} ${title} ${showRemaining ? "remaining" : "used"}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={detail}
        >
          <span
            className={`block h-full rounded-full transition-[width] duration-300 ${barClass(used)}`}
            style={{ width: `${shown}%` }}
          />
        </div>
        {marker != null ? (
          <span
            aria-hidden
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-content/55"
            style={{ left: `${marker}%` }}
          />
        ) : null}
      </div>
      <div className="mt-1 flex min-w-0 items-baseline justify-between gap-1.5 text-[10px] leading-4">
        <span className="min-w-0 truncate text-content/50">{member.label}</span>
        <span
          className={`shrink-0 tabular-nums ${full ? "font-medium text-red-400" : "text-content/65"}`}
        >
          {member.blockedBy
            ? `${BLOCKED_BY[member.blockedBy]} spent`
            : formatUsagePercent(shown)}
        </span>
      </div>
    </div>
  );
}
