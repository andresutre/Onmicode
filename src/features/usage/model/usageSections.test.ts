import { describe, expect, it } from "vitest";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  unavailableRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../../providers/model/rateLimits";
import type {
  ProviderAccount,
  ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import {
  buildUsageSections,
  oldestUsageUpdate,
  usageAccountState,
  usageRefreshTargets,
  usageSectionPlacement,
  usageUpdatedLabel,
  usageWindowTitle,
  type UsageSection,
} from "./usageSections";

const now = Date.parse("2026-10-20T12:00:00Z");
const MINUTE = 60_000;

function ok(
  provider: RateLimitProvider,
  updatedAt = now,
  usedPercent = 30,
): ProviderRateLimits {
  return {
    ...idleRateLimits(provider),
    session: { usedPercent, windowMinutes: 300, resetsAt: now + 60 * MINUTE },
    weekly: { usedPercent: 10, windowMinutes: 10_080, resetsAt: null },
    updatedAt,
    status: "ok",
  };
}

function account(
  provider: ProviderAccountProvider,
  id = "default",
  label = "Default account",
): ProviderAccount {
  return {
    id,
    provider,
    label,
    ...(id === "default" ? { isDefault: true } : {}),
  };
}

function section(limits: (ProviderRateLimits | undefined)[]): UsageSection {
  return {
    id: "claude",
    title: "Claude Code",
    harness: "claude",
    accounts: limits.map((entry, index) => ({
      key: `claude:${index}`,
      source: { kind: "account", provider: "claude", accountId: `${index}` },
      label: null,
      limits: entry,
    })),
  };
}

describe("usageAccountState", () => {
  it("tells loading, ready and stale snapshots apart", () => {
    expect(usageAccountState(undefined)).toBe("loading");
    expect(usageAccountState(idleRateLimits("claude"))).toBe("loading");
    expect(usageAccountState(fetchingRateLimits("claude"))).toBe("loading");
    expect(usageAccountState(ok("claude"))).toBe("ready");
    expect(usageAccountState(fetchingRateLimits("claude", ok("claude")))).toBe(
      "ready",
    );
    expect(
      usageAccountState(errorRateLimits("claude", "offline", ok("claude"))),
    ).toBe("stale");
  });

  it("keeps expired credentials apart from a provider never set up", () => {
    expect(
      usageAccountState(errorRateLimits("claude", "Claude sign-in expired")),
    ).toBe("expired");
    expect(
      usageAccountState(errorRateLimits("claude", "Claude usage unavailable")),
    ).toBe("failed");
    expect(
      usageAccountState(
        unavailableRateLimits("claude", "Claude not signed in"),
      ),
    ).toBe("signedOut");
    expect(
      usageAccountState(unavailableRateLimits("codex", "Codex CLI not found")),
    ).toBe("missing");
  });
});

describe("usageSectionPlacement", () => {
  it("shows a provider with usage or credentials that need attention", () => {
    expect(usageSectionPlacement(section([ok("claude")]))).toBe("shown");
    expect(
      usageSectionPlacement(
        section([errorRateLimits("claude", "Claude sign-in expired")]),
      ),
    ).toBe("shown");
  });

  it("folds away a provider never set up", () => {
    expect(
      usageSectionPlacement(
        section([unavailableRateLimits("claude", "Claude not signed in")]),
      ),
    ).toBe("unconnected");
  });

  it("keeps named profiles in view even while signed out", () => {
    const signedOut = unavailableRateLimits("claude", "Claude not signed in");
    expect(usageSectionPlacement(section([signedOut, signedOut]))).toBe(
      "shown",
    );
  });

  it("keeps its last place while it loads", () => {
    const loading = section([fetchingRateLimits("claude")]);
    expect(usageSectionPlacement(loading)).toBe("shown");
    expect(usageSectionPlacement(loading, "unconnected")).toBe("unconnected");
  });
});

describe("buildUsageSections", () => {
  it("lists every provider in order and names accounts only when there are several", () => {
    const sections = buildUsageSections({
      accounts: {
        claude: [account("claude")],
        codex: [account("codex"), account("codex", "account-work", "Work")],
        devin: [account("devin")],
      },
      limits: {
        "claude:default": ok("claude"),
        "codex:account-work": ok("codex"),
        "opencode:default": ok("opencode"),
      },
      pi: { anthropic: ok("claude") },
    });

    expect(sections.map((entry) => entry.id)).toEqual([
      "claude",
      "codex",
      "opencode",
      "devin",
      "pi-anthropic",
      "pi-openai-codex",
    ]);
    expect(sections.map((entry) => entry.title)).toEqual([
      "Claude Code",
      "Codex",
      "OpenCode Go",
      "Devin",
      "Pi · Anthropic",
      "Pi · OpenAI Codex",
    ]);
    expect(sections[0].accounts[0].label).toBeNull();
    expect(sections[1].accounts.map((entry) => entry.label)).toEqual([
      "Default account",
      "Work",
    ]);
    expect(sections[1].accounts[0].limits).toBeUndefined();
    expect(sections[1].accounts[1].limits?.status).toBe("ok");
    expect(sections[2].accounts[0].source).toEqual({
      kind: "account",
      provider: "opencode",
      accountId: "default",
    });
    expect(sections[4].accounts[0].source).toEqual({
      kind: "pi",
      provider: "anthropic",
    });
    expect(sections[4].sourceLabel).toBe("Pi's saved OAuth account");
    expect(sections[5].accounts[0].limits).toBeUndefined();
  });
});

describe("usageRefreshTargets", () => {
  const sections = [
    section([
      undefined,
      ok("claude", now - 2 * MINUTE),
      ok("claude", now - 6 * MINUTE),
      fetchingRateLimits("claude", ok("claude", now - 60 * MINUTE)),
    ]),
  ];

  it("rereads everything on an explicit refresh", () => {
    expect(
      usageRefreshTargets(sections, now, "all").map((target) => target.force),
    ).toEqual([true, true, true, true]);
  });

  it("loads what is missing and rereads only old snapshots on open", () => {
    expect(usageRefreshTargets(sections, now, "stale")).toEqual([
      {
        source: { kind: "account", provider: "claude", accountId: "0" },
        force: false,
      },
      {
        source: { kind: "account", provider: "claude", accountId: "2" },
        force: true,
      },
    ]);
  });
});

describe("updated label", () => {
  it("reports the oldest snapshot that has usage", () => {
    const sections = [
      section([
        ok("claude", now - 3 * MINUTE),
        ok("claude", now - 90 * MINUTE),
        unavailableRateLimits("claude", "Claude not signed in"),
      ]),
    ];
    const oldest = oldestUsageUpdate(sections);
    expect(oldest).toBe(now - 90 * MINUTE);
    expect(usageUpdatedLabel(oldest, now)).toBe("Updated 1h ago");
  });

  it("counts minutes, hours and days", () => {
    expect(usageUpdatedLabel(now - 20_000, now)).toBe("Updated just now");
    expect(usageUpdatedLabel(now - 12 * MINUTE, now)).toBe("Updated 12m ago");
    expect(usageUpdatedLabel(now - 50 * 60 * MINUTE, now)).toBe(
      "Updated 2d ago",
    );
    expect(usageUpdatedLabel(null, now)).toBeNull();
    expect(oldestUsageUpdate([section([undefined])])).toBeNull();
  });
});

describe("usageWindowTitle", () => {
  it("names each window the way the footer popover does", () => {
    const span = (windowMinutes: number) => ({
      usedPercent: 0,
      windowMinutes,
      resetsAt: null,
    });
    expect(usageWindowTitle("session", span(300))).toBe("5-hour limit");
    expect(usageWindowTitle("session", span(1_440))).toBe("Daily limit");
    expect(usageWindowTitle("weekly", span(10_080))).toBe("Weekly limit");
    expect(usageWindowTitle("monthly", span(43_200))).toBe("Monthly limit");
  });
});
