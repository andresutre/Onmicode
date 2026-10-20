import {
  clampUsedPercent,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../../providers/model/rateLimits";
import {
  usageAccountState,
  usageWindows,
  type UsageWindowKind,
} from "./usageSections";

/**
 * One provider's accounts read together, one pool per window kind, after
 * T3 Code's pooled limits. Plans differ in size and no provider reports an
 * allowance in absolute terms, so every account counts equally: the pooled
 * figure is an average of shares, not a combined quota.
 */

const KIND_ORDER: UsageWindowKind[] = ["session", "weekly", "monthly"];

export type PoolAccountInput = {
  key: string;
  label: string;
  limits: ProviderRateLimits | undefined;
};

export type PoolMember = {
  key: string;
  label: string;
  /** The account's own window of the pool's kind. */
  window: RateLimitWindow;
  /** 0–100. A reset that has passed reads as unused, a blocked account as full. */
  usedPercent: number;
  /** A longer window of the same account that is spent, leaving this one unusable. */
  blockedBy: UsageWindowKind | null;
  /** When a full or blocked account can be used again, if known. */
  freesAt: number | null;
};

export type UsagePool = {
  kind: UsageWindowKind;
  members: PoolMember[];
  /** Mean of the members' shares used, each account weighted the same. */
  averageUsedPercent: number;
  /** Members with room left in this window right now. */
  withRoom: number;
  /** The earliest time a full or blocked member frees up. */
  nextFreeAt: number | null;
};

export type UsagePoolSummary = {
  pools: UsagePool[];
  /** Accounts that report usage and so take part in the pools. */
  included: number;
  /** Accounts without usage to pool, with why. */
  excluded: { key: string; label: string; reason: string }[];
};

function spent(window: RateLimitWindow, now: number): boolean {
  return (
    clampUsedPercent(window.usedPercent) >= 100 &&
    (window.resetsAt == null || window.resetsAt > now)
  );
}

function poolMember(
  account: PoolAccountInput & { limits: ProviderRateLimits },
  kind: UsageWindowKind,
  window: RateLimitWindow,
  now: number,
): PoolMember {
  const longer = usageWindows(account.limits).filter(
    (entry) =>
      KIND_ORDER.indexOf(entry.kind) > KIND_ORDER.indexOf(kind) &&
      spent(entry.window, now),
  );
  const ownSpent = spent(window, now);
  const blocking = [
    ...(ownSpent ? [window] : []),
    ...longer.map((e) => e.window),
  ];
  const resets = blocking.map((entry) => entry.resetsAt);
  const freesAt =
    blocking.length === 0 || resets.some((at) => at == null)
      ? null
      : Math.max(...(resets as number[]));
  const passed = window.resetsAt != null && window.resetsAt <= now;
  return {
    key: account.key,
    label: account.label,
    window,
    usedPercent:
      blocking.length > 0
        ? 100
        : passed
          ? 0
          : clampUsedPercent(window.usedPercent),
    blockedBy: longer[longer.length - 1]?.kind ?? null,
    freesAt,
  };
}

/**
 * Pools for a provider whose accounts number two or more with usage; null
 * otherwise, so a single account reads as it always has. A window kind
 * pools once at least two accounts report it.
 */
export function usagePools(
  accounts: PoolAccountInput[],
  now: number,
): UsagePoolSummary | null {
  const included: (PoolAccountInput & { limits: ProviderRateLimits })[] = [];
  const excluded: UsagePoolSummary["excluded"] = [];
  for (const account of accounts) {
    const state = usageAccountState(account.limits);
    if (account.limits && (state === "ready" || state === "stale")) {
      included.push({ ...account, limits: account.limits });
      continue;
    }
    excluded.push({
      key: account.key,
      label: account.label,
      reason:
        state === "loading"
          ? "Checking…"
          : account.limits?.error ||
            (state === "expired" || state === "signedOut"
              ? "Not signed in"
              : "Usage unavailable"),
    });
  }
  if (included.length < 2) return null;

  const pools = KIND_ORDER.flatMap((kind): UsagePool[] => {
    const members = included.flatMap((account) => {
      const entry = usageWindows(account.limits).find((e) => e.kind === kind);
      return entry ? [poolMember(account, kind, entry.window, now)] : [];
    });
    if (members.length < 2) return [];
    const full = members.filter((member) => member.usedPercent >= 100);
    const frees = full
      .map((member) => member.freesAt)
      .filter((at): at is number => at != null);
    return [
      {
        kind,
        members,
        averageUsedPercent:
          members.reduce((sum, member) => sum + member.usedPercent, 0) /
          members.length,
        withRoom: members.length - full.length,
        nextFreeAt: frees.length > 0 ? Math.min(...frees) : null,
      },
    ];
  });
  return { pools, included: included.length, excluded };
}

/** "2 of 3 accounts have room", read off a pool's counts. */
export function poolRoomLabel(withRoom: number, total: number): string {
  if (withRoom === 0) return "No account has room";
  if (withRoom === total) {
    return total === 2
      ? "Both accounts have room"
      : `All ${total} accounts have room`;
  }
  return `${withRoom} of ${total} accounts have room`;
}
