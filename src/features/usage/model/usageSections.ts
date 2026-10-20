import { needsProviderLogin } from "../../../app/shell/UsageProviderChip";
import type { PiUsageProvider } from "../../providers/model/piUsage";
import {
  DAILY_WINDOW_MINUTES,
  RATE_LIMIT_MIN_REFETCH_MS,
  SESSION_WINDOW_MINUTES,
  formatWindowLabel,
  type ProviderRateLimits,
  type RateLimitProvider,
  type RateLimitWindow,
} from "../../providers/model/rateLimits";
import type {
  ProviderAccount,
  ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { hasUsageToShow } from "../../providers/model/usageProviders";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import type { PiLimits } from "./piLimits";

/** What one row of the page reads its limits from. */
export type UsageSource =
  | { kind: "account"; provider: RateLimitProvider; accountId: string }
  | { kind: "pi"; provider: PiUsageProvider };

export type UsageAccountEntry = {
  key: string;
  source: UsageSource;
  /** The account's local name, for a provider with several of them. */
  label: string | null;
  /** Set for providers with Onmicode accounts, to look up their identity. */
  account?: ProviderAccount;
  limits: ProviderRateLimits | undefined;
};

export type UsageSection = {
  id: string;
  title: string;
  harness: HarnessId;
  /** Where the limits come from when it is not the provider's own sign-in. */
  sourceLabel?: string;
  accountProvider?: ProviderAccountProvider;
  accounts: UsageAccountEntry[];
};

/**
 * `expired` and `failed` had credentials that stopped working, so they stay
 * in view; `signedOut` and `missing` were never set up on this machine.
 */
export type UsageAccountState =
  | "loading"
  | "ready"
  | "stale"
  | "expired"
  | "failed"
  | "signedOut"
  | "missing";

export function usageAccountState(
  limits: ProviderRateLimits | undefined,
): UsageAccountState {
  if (!limits || limits.status === "idle") return "loading";
  if (hasUsageToShow(limits))
    return limits.status === "error" ? "stale" : "ready";
  if (limits.status === "fetching") return "loading";
  if (limits.status === "unavailable") {
    return /\bnot found\b/i.test(limits.error ?? "") ? "missing" : "signedOut";
  }
  return needsProviderLogin(limits) ? "expired" : "failed";
}

export type UsagePlacement = "shown" | "unconnected";

/**
 * A provider earns a card once it has usage, or credentials that need
 * attention. One never set up folds into the "Not connected" list. While it
 * loads, it keeps its last place so a refresh does not move it.
 */
export function usageSectionPlacement(
  section: UsageSection,
  previous?: UsagePlacement,
): UsagePlacement {
  // Named profiles were added on purpose, so they stay in view to sign in.
  if (section.accounts.length > 1) return "shown";
  const states = section.accounts.map((entry) =>
    usageAccountState(entry.limits),
  );
  if (
    states.some(
      (state) =>
        state === "ready" ||
        state === "stale" ||
        state === "expired" ||
        state === "failed",
    )
  ) {
    return "shown";
  }
  if (states.includes("loading")) return previous ?? "shown";
  return "unconnected";
}

const PI_TITLE: Record<PiUsageProvider, string> = {
  anthropic: "Pi · Anthropic",
  "openai-codex": "Pi · OpenAI Codex",
};

/** Every provider Onmicode reads limits for, in a fixed order. */
export function buildUsageSections({
  accounts,
  limits,
  pi,
}: {
  accounts: Record<ProviderAccountProvider, ProviderAccount[]>;
  /** The shared rate-limit snapshots, keyed `provider:accountId`. */
  limits: Record<string, ProviderRateLimits>;
  pi: PiLimits;
}): UsageSection[] {
  const accountSection = (provider: ProviderAccountProvider): UsageSection => {
    const list = accounts[provider];
    return {
      id: provider,
      title: HARNESS_TITLE[provider],
      harness: provider,
      accountProvider: provider,
      accounts: list.map((account) => ({
        key: `${provider}:${account.id}`,
        source: { kind: "account", provider, accountId: account.id },
        label: list.length > 1 ? account.label : null,
        account,
        limits: limits[`${provider}:${account.id}`],
      })),
    };
  };
  const piSection = (provider: PiUsageProvider): UsageSection => ({
    id: `pi-${provider}`,
    title: PI_TITLE[provider],
    harness: "pi",
    sourceLabel: "Pi's saved OAuth account",
    accounts: [
      {
        key: `pi:${provider}`,
        source: { kind: "pi", provider },
        label: null,
        limits: pi[provider],
      },
    ],
  });
  return [
    accountSection("claude"),
    accountSection("codex"),
    {
      id: "opencode",
      title: "OpenCode Go",
      harness: "opencode",
      accounts: [
        {
          key: "opencode:default",
          source: {
            kind: "account",
            provider: "opencode",
            accountId: "default",
          },
          label: null,
          limits: limits["opencode:default"],
        },
      ],
    },
    accountSection("devin"),
    piSection("anthropic"),
    piSection("openai-codex"),
  ];
}

export type UsageRefreshTarget = { source: UsageSource; force: boolean };

/**
 * What a refresh reads. `all` rereads everything; `stale` loads what was
 * never read and rereads snapshots older than the footer's refetch floor,
 * so opening the page shows current numbers without a burst of requests.
 */
export function usageRefreshTargets(
  sections: UsageSection[],
  now: number,
  mode: "all" | "stale",
): UsageRefreshTarget[] {
  return sections.flatMap((section) =>
    section.accounts.flatMap((entry): UsageRefreshTarget[] => {
      if (mode === "all") return [{ source: entry.source, force: true }];
      const limits = entry.limits;
      if (!limits) return [{ source: entry.source, force: false }];
      if (limits.status === "fetching") return [];
      const stale =
        limits.updatedAt <= 0 ||
        now - limits.updatedAt >= RATE_LIMIT_MIN_REFETCH_MS;
      return stale ? [{ source: entry.source, force: true }] : [];
    }),
  );
}

/** The oldest snapshot behind the shown cards, for "Updated 3m ago". */
export function oldestUsageUpdate(sections: UsageSection[]): number | null {
  let oldest: number | null = null;
  for (const section of sections) {
    for (const entry of section.accounts) {
      const limits = entry.limits;
      if (!limits || !hasUsageToShow(limits) || limits.updatedAt <= 0) {
        continue;
      }
      oldest = Math.min(oldest ?? limits.updatedAt, limits.updatedAt);
    }
  }
  return oldest;
}

export function usageUpdatedLabel(
  updatedAt: number | null,
  now: number,
): string | null {
  if (updatedAt == null || updatedAt <= 0) return null;
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  if (minutes === 0) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

export type UsageWindowKind = "session" | "weekly" | "monthly";

export function usageWindows(
  limits: ProviderRateLimits | undefined,
): { kind: UsageWindowKind; window: RateLimitWindow }[] {
  return [
    limits?.session
      ? { kind: "session" as const, window: limits.session }
      : null,
    limits?.weekly ? { kind: "weekly" as const, window: limits.weekly } : null,
    limits?.monthly
      ? { kind: "monthly" as const, window: limits.monthly }
      : null,
  ].filter((entry) => entry != null);
}

/** "5-hour limit", or "Daily limit" for Devin's short window. */
export function usageWindowTitle(
  kind: UsageWindowKind,
  window: RateLimitWindow,
): string {
  if (kind === "weekly") return "Weekly limit";
  if (kind === "monthly") return "Monthly limit";
  if (window.windowMinutes === DAILY_WINDOW_MINUTES) return "Daily limit";
  if (window.windowMinutes === SESSION_WINDOW_MINUTES) return "5-hour limit";
  return `${formatWindowLabel(window.windowMinutes)} limit`;
}
