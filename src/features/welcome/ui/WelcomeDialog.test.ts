// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const availability = vi.hoisted(() => ({
  installed: new Set<string>(),
  probed: true,
  probe: vi.fn(async (_options?: { force?: boolean }) => {}),
}));
const auth = vi.hoisted(() => ({
  loginHarness: vi.fn<(_harness: string) => Promise<void>>(),
}));
const rateLimitsFetch = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchClaudeRateLimits: vi.fn(),
  fetchCodexRateLimits: vi.fn(),
  fetchDevinRateLimits: vi.fn(),
  fetchOpencodeGoRateLimits: vi.fn(),
}));
const fs = vi.hoisted(() => ({
  pickFolders: vi.fn<(_title?: string) => Promise<string[]>>(),
}));

vi.mock(
  "../../../integrations/harness/core/availability",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../integrations/harness/core/availability")
    >()),
    probeHarnessAvailability: availability.probe,
    isHarnessAvailable: (id: string) => availability.installed.has(id),
    hasProbedHarnessAvailability: () => availability.probed,
  }),
);
vi.mock("../../../integrations/harness/core/auth", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../integrations/harness/core/auth")
  >()),
  loginHarness: auth.loginHarness,
}));
vi.mock("../../providers/model/rateLimitsFetch", () => rateLimitsFetch);
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  pickFolders: fs.pickFolders,
}));

import type {
  ProviderRateLimits,
  RateLimitProvider,
} from "../../providers/model/rateLimits";
import { clearCachedRateLimits } from "../../providers/model/rateLimitsCache";
import { WelcomeDialog } from "./WelcomeDialog";

let container: HTMLDivElement;
let root: Root;
let finish: ReturnType<typeof vi.fn<(projects: string[]) => void>>;

function limits(
  provider: RateLimitProvider,
  signedIn: boolean,
): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: signedIn ? null : `${provider} not signed in`,
    status: signedIn ? "ok" : "unavailable",
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  availability.installed = new Set();
  availability.probed = true;
  availability.probe.mockClear();
  auth.loginHarness.mockReset();
  fs.pickFolders.mockReset();
  rateLimitsFetch.fetchClaudeRateLimits.mockResolvedValue(
    limits("claude", true),
  );
  rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(limits("codex", true));
  clearCachedRateLimits();
  finish = vi.fn<(projects: string[]) => void>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(WelcomeDialog, { onFinish: finish })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) =>
      (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

function heading(): string {
  return document.querySelector("[role='dialog'] h3")?.textContent ?? "";
}

function row(title: string): HTMLLIElement {
  const result = [
    ...document.querySelectorAll<HTMLLIElement>(
      "[aria-label='Coding agents'] li",
    ),
  ].find((item) => item.textContent?.startsWith(title));
  expect(result, title).toBeDefined();
  return result!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

async function pickProject(path = "/work/app") {
  fs.pickFolders.mockResolvedValue([path]);
  await click("Get started");
  await click("Continue");
  await click("Choose a folder…");
}

describe("WelcomeDialog", () => {
  it("walks every step and finishes with the picked project", async () => {
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(heading()).toBe("Welcome to Onmicode");
    expect(document.activeElement).toBe(button("Get started"));

    await click("Get started");
    expect(heading()).toBe("Your coding agents");
    expect(availability.probe).toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Continue"));

    await click("Continue");
    expect(heading()).toBe("Pick a first project");
    expect(button("Continue").disabled).toBe(true);
    expect(document.activeElement).toBe(button("Choose a folder…"));

    fs.pickFolders.mockResolvedValue(["/work/app"]);
    await click("Choose a folder…");
    expect(fs.pickFolders).toHaveBeenCalledWith("Choose a project folder");
    expect(dialog?.textContent).toContain("/work/app");
    expect(button("Continue").disabled).toBe(false);

    await click("Continue");
    expect(heading()).toBe("Choose a look");

    await click("Continue");
    expect(heading()).toBe("You're all set");
    expect(dialog?.textContent).toContain("app opens in a new session.");
    expect(finish).not.toHaveBeenCalled();

    await click("Start coding");
    expect(finish).toHaveBeenCalledWith(["/work/app"]);
  });

  it("skips the whole setup from the first step", async () => {
    await click("Skip setup");
    expect(finish).toHaveBeenCalledWith([]);
  });

  it("closes on Escape from any step and keeps the picked folder", async () => {
    await pickProject();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(finish).toHaveBeenCalledWith(["/work/app"]);
  });

  it("goes back through the step trail and the Back button", async () => {
    await click("Get started");
    await click("Continue");
    expect(heading()).toBe("Pick a first project");

    await click("Back");
    expect(heading()).toBe("Your coding agents");

    await click("Back to Welcome");
    expect(heading()).toBe("Welcome to Onmicode");
    expect(document.querySelector("[aria-current='step']")?.textContent).toBe(
      "Welcome",
    );
  });

  it("skipping the project step drops a picked folder", async () => {
    await pickProject();
    await click("Skip");
    expect(heading()).toBe("Choose a look");
    await click("Continue");
    expect(document.querySelector("[role='dialog']")?.textContent).toContain(
      "Open a project any time",
    );
    await click("Done");
    expect(finish).toHaveBeenCalledWith([]);
  });

  it("refuses a folder that cannot be a project", async () => {
    fs.pickFolders.mockResolvedValue(["/"]);
    await click("Get started");
    await click("Continue");
    await click("Choose a folder…");
    expect(document.querySelector("[role='status']")?.textContent).toContain(
      "can't be opened as a project",
    );
    expect(button("Continue").disabled).toBe(true);
  });

  it("shows install, sign-in and ready states for each agent", async () => {
    availability.installed = new Set(["claude", "codex", "pi"]);
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(
      limits("codex", false),
    );
    await click("Get started");

    expect(row("Claude Code").textContent).toContain("Ready");
    expect(row("Codex").textContent).toContain("Installed, not signed in yet.");
    expect(row("Cursor").textContent).toContain("Not installed");
    expect(row("Cursor").querySelector("code")?.textContent).toContain(
      "cursor.com/install",
    );
    expect(button("Copy Cursor install command")).toBeDefined();
    expect(row("Pi").textContent).toContain("Installed.");
    expect(document.body.textContent).not.toContain("Grok Build");

    await click("Show 7 more agents");
    expect(row("Grok Build").textContent).toContain("Not installed");

    auth.loginHarness.mockResolvedValue();
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(
      limits("codex", true),
    );
    await act(async () =>
      row("Codex").querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(auth.loginHarness).toHaveBeenCalledWith("codex");
    expect(row("Codex").textContent).toContain("Ready");
  });

  it("reports a sign-in the provider did not accept", async () => {
    availability.installed = new Set(["codex"]);
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(
      limits("codex", false),
    );
    await click("Get started");
    auth.loginHarness.mockResolvedValue();
    await act(async () =>
      row("Codex").querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(row("Codex").querySelector("[role='status']")?.textContent).toBe(
      "codex not signed in",
    );
  });

  it("checks again past the probe cache", async () => {
    await click("Get started");
    await click("Check again");
    expect(availability.probe).toHaveBeenLastCalledWith({ force: true });
  });

  it("applies the look right away and puts it back on Skip", async () => {
    localStorage.setItem("monocode.colorScheme", "dark");
    await click("Get started");
    await click("Continue");
    await click("Skip");
    expect(heading()).toBe("Choose a look");

    const theme = document.querySelector<HTMLElement>(
      "[role='radiogroup'][aria-label='Theme']",
    )!;
    const dark = theme.querySelector<HTMLButtonElement>(
      "[aria-checked='true']",
    )!;
    expect(dark.textContent).toBe("Dark");
    expect(document.activeElement).toBe(dark);

    await act(async () => {
      dark.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const light = theme.querySelector<HTMLButtonElement>(
      "[aria-checked='true']",
    )!;
    expect(light.textContent).toBe("Light");
    expect(document.activeElement).toBe(light);
    expect(localStorage.getItem("monocode.colorScheme")).toBe("light");
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      true,
    );

    await click("New");
    expect(localStorage.getItem("monocode.insetLayout")).toBe("1");
    expect(localStorage.getItem("monocode.newLayoutPromptDismissed")).toBe("1");

    await click("Skip");
    expect(heading()).toBe("You're all set");
    expect(localStorage.getItem("monocode.colorScheme")).toBe("dark");
    expect(localStorage.getItem("monocode.insetLayout")).toBe("0");
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false,
    );
  });
});
