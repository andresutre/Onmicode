// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  errorRateLimits,
  idleRateLimits,
  unavailableRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../../providers/model/rateLimits";
import {
  clearCachedRateLimits,
  setCachedRateLimits,
} from "../../providers/model/rateLimitsCache";
import { saveProviderAccount } from "../../providers/model/providerAccounts";
import { saveShowRemainingUsage } from "../../settings/model/displayPrefs";
import { clearPiLimits } from "../model/piLimits";
import { UsageView } from "./UsageView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const now = Date.parse("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;

function ok(
  provider: RateLimitProvider,
  sessionUsed: number,
  extra: Partial<ProviderRateLimits> = {},
): ProviderRateLimits {
  return {
    ...idleRateLimits(provider),
    // Two of the five hours have gone.
    session: {
      usedPercent: sessionUsed,
      windowMinutes: 300,
      resetsAt: now + 3 * HOUR,
    },
    weekly: {
      usedPercent: 10,
      windowMinutes: 10_080,
      resetsAt: now + 96 * HOUR,
    },
    updatedAt: now - 2 * 60_000,
    status: "ok",
    ...extra,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "fetch_pi_usage"
      ? {
          status: "unavailable",
          message: "Sign in to this provider through Pi, then refresh usage.",
        }
      : null,
  );
  setCachedRateLimits("claude", "default", ok("claude", 70));
  setCachedRateLimits("codex", "default", ok("codex", 20));
  setCachedRateLimits(
    "opencode",
    "default",
    unavailableRateLimits("opencode", "OpenCode Go not connected"),
  );
  setCachedRateLimits(
    "devin",
    "default",
    unavailableRateLimits("devin", "Devin not signed in"),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearCachedRateLimits();
  clearPiLimits();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(createElement(UsageView, { tabbed: true, onClose: () => {} }));
  });
  // Let the reads the page starts on open settle.
  for (let tick = 0; tick < 3; tick += 1) await act(async () => {});
}

function card(id: string): HTMLElement | null {
  return container.querySelector(`article[data-usage-provider="${id}"]`);
}

function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

describe("UsageView", () => {
  it("shows each window with its share used, pace and reset", async () => {
    await render();

    const claude = card("claude");
    expect(claude?.textContent).toContain("Claude Code");
    const session = claude?.querySelector('[data-usage-window="session"]');
    expect(session?.textContent).toContain("5-hour limit");
    expect(session?.textContent).toContain("70% used");
    expect(session?.textContent).toContain("Ahead of pace");
    expect(session?.textContent).toContain("Resets in 3h");
    expect(
      session?.querySelector<HTMLElement>("[data-usage-pace-marker]")?.style
        .left,
    ).toBe("40%");
    expect(
      card("codex")?.querySelector('[data-usage-window="session"]')
        ?.textContent,
    ).toContain("Under pace");
    expect(
      claude?.querySelector('[data-usage-window="weekly"]')?.textContent,
    ).toContain("Under pace");
  });

  it("follows the remaining-usage preference", async () => {
    saveShowRemainingUsage(true);
    await render();

    const session = card("claude")?.querySelector(
      '[data-usage-window="session"]',
    );
    expect(session?.textContent).toContain("30% left");
    expect(
      session
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("30");
    expect(
      session?.querySelector<HTMLElement>("[data-usage-pace-marker]")?.style
        .left,
    ).toBe("60%");
  });

  it("folds providers that were never set up into one line", async () => {
    await render();

    expect(card("opencode")).toBeNull();
    expect(card("devin")).toBeNull();
    expect(card("pi-anthropic")).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>(
      "[data-usage-unconnected] button",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent).toContain(
      "OpenCode Go, Devin, Pi · Anthropic, Pi · OpenAI Codex",
    );

    await act(async () => toggle?.click());
    const devin = container.querySelector(
      '[data-usage-unconnected] [data-usage-provider="devin"]',
    );
    expect(devin?.textContent).toContain("Devin not signed in");
    expect(button("Sign in to Devin")).toBeDefined();
    expect(
      container.querySelector(
        '[data-usage-unconnected] [data-usage-provider="opencode"] button',
      ),
    ).toBeNull();
  });

  it("keeps an expired sign-in in view with a way back in", async () => {
    setCachedRateLimits(
      "claude",
      "default",
      errorRateLimits("claude", "Claude sign-in expired"),
    );
    await render();

    expect(card("claude")?.textContent).toContain("Claude sign-in expired");
    expect(button("Sign in to Claude Code")).toBeDefined();
  });

  it("lists every account of a provider with its banked resets", async () => {
    saveProviderAccount({
      id: "account-work",
      provider: "codex",
      label: "Work",
    });
    setCachedRateLimits(
      "codex",
      "account-work",
      ok("codex", 50, {
        resetCredits: { availableCount: 2, credits: null },
      }),
    );
    await render();

    const accounts = card("codex")?.querySelectorAll("[data-usage-account]");
    expect(card("codex")?.textContent).toContain("2 accounts");
    expect(accounts).toHaveLength(2);
    expect(accounts?.[0].textContent).toContain("Default account");
    expect(accounts?.[1].textContent).toContain("Work");
    expect(accounts?.[1].textContent).toContain("Banked resets2");

    await act(async () => button("Use a reset").click());
    expect(accounts?.[1].textContent).toContain("Spend one reset now?");
  });

  it("rereads only snapshots older than the refetch floor on open", async () => {
    const answer = vi.mocked(invoke).getMockImplementation()!;
    // Hold the Codex probe open to see the card while it rereads.
    vi.mocked(invoke).mockImplementation((command, args) =>
      command === "harness_resolve_codex"
        ? new Promise(() => {})
        : answer(command, args),
    );
    setCachedRateLimits("codex", "default", {
      ...ok("codex", 20),
      updatedAt: now - 10 * 60_000,
    });
    await render();

    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands).not.toContain("fetch_claude_usage");
    expect(commands).toContain("harness_resolve_codex");
    expect(
      commands.filter((command) => command === "fetch_pi_usage"),
    ).toHaveLength(2);
    expect(card("codex")?.textContent).toContain("Updating");
  });
});
