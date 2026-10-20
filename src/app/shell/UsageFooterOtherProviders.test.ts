// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rateLimitsFetch = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchClaudeRateLimits: vi.fn(),
  fetchCodexRateLimits: vi.fn(),
  fetchDevinRateLimits: vi.fn(),
  fetchOpencodeGoRateLimits: vi.fn(),
}));

vi.mock(
  "../../features/providers/model/rateLimitsFetch",
  () => rateLimitsFetch,
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({
    status: "ok",
    windows: {
      session: { usedPercent: 24, windowMinutes: 300, resetsAt: null },
      weekly: null,
    },
  })),
}));

import {
  unavailableRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import { clearCachedRateLimits } from "../../features/providers/model/rateLimitsCache";
import {
  otherUsageProvidersFor,
  usageProvidersFor,
} from "../../features/providers/model/usageProviders";
import {
  HARNESS_LABEL,
  type HarnessId,
} from "../../features/sessions/model/session";
import { UsageFooter } from "./UsageFooter";

let container: HTMLDivElement;
let root: Root;

function limits(
  provider: RateLimitProvider,
  session: number,
  weekly: number,
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent: session, windowMinutes: 300, resetsAt: null },
    weekly: { usedPercent: weekly, windowMinutes: 10_080, resetsAt: null },
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

function signedOut(provider: RateLimitProvider): ProviderRateLimits {
  return {
    ...limits(provider, 0, 0),
    session: null,
    weekly: null,
    error: `${provider} is not signed in`,
    status: "error",
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  rateLimitsFetch.fetchClaudeRateLimits
    .mockReset()
    .mockResolvedValue(limits("claude", 12, 30));
  rateLimitsFetch.fetchCodexRateLimits
    .mockReset()
    .mockResolvedValue(limits("codex", 55, 20));
  rateLimitsFetch.fetchDevinRateLimits
    .mockReset()
    .mockResolvedValue(signedOut("devin"));
  rateLimitsFetch.fetchOpencodeGoRateLimits
    .mockReset()
    .mockResolvedValue(unavailableRateLimits("opencode", "Not set up"));
  clearCachedRateLimits();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** The footer as App renders it for a session on `harness`. */
async function renderFor(harness: HarnessId, model?: string) {
  await act(async () =>
    root.render(
      createElement(UsageFooter, {
        providers: usageProvidersFor(harness),
        otherProviders: otherUsageProvidersFor(harness),
        session: { id: `${harness}-session`, harness, model },
      }),
    ),
  );
}

function chip(label: string) {
  return container.querySelector<HTMLButtonElement>(
    `[aria-label="${label} usage details"]`,
  );
}

function chipLabels() {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label$=" usage details"]',
    ),
  ].map((button) => button.getAttribute("aria-label"));
}

describe("UsageFooter beside the session's own provider", () => {
  it("shows Claude Code and Codex usage in a Pi session", async () => {
    await renderFor("pi", "pi:anthropic/claude-sonnet-4-6");

    expect(chipLabels()).toEqual([
      "Pi · Anthropic usage details",
      "Claude Code usage details",
      "Codex usage details",
    ]);
  });

  it("leads with the session's provider in full and the others compact", async () => {
    await renderFor("claude");

    expect(chipLabels()).toEqual([
      "Claude Code usage details",
      "Codex usage details",
    ]);
    // Every window for the session's own provider.
    expect(chip("Claude Code")?.textContent).toContain("12%");
    expect(chip("Claude Code")?.textContent).toContain("30%");
    // Only the window nearest its limit for another.
    expect(chip("Codex")?.textContent).toContain("55%");
    expect(chip("Codex")?.textContent).not.toContain("20%");
  });

  it("keeps providers without usage out of the way", async () => {
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(signedOut("codex"));
    await renderFor("claude");

    expect(chipLabels()).toEqual(["Claude Code usage details"]);
    expect(container.textContent).not.toContain("not connected");
  });

  it("still offers sign-in for the session's own provider", async () => {
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(signedOut("codex"));
    await renderFor("codex");

    expect(chipLabels()).toEqual([
      "Codex usage details",
      "Claude Code usage details",
    ]);
  });

  it("keeps an agent's own label first when it has no usage chip", async () => {
    await renderFor("cursor");

    expect(
      container.querySelector("footer")?.firstElementChild?.textContent,
    ).toBe(HARNESS_LABEL.cursor);
    expect(chipLabels()).toEqual([
      "Claude Code usage details",
      "Codex usage details",
    ]);
  });
});
