// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentStatus,
  listNames,
  loadWelcomeCompleted,
  OPEN_WELCOME_EVENT,
  openWelcome,
  saveWelcomeCompleted,
  shouldShowWelcomeAtBoot,
  splitWelcomeAgents,
  type WelcomeBootState,
} from "./welcome";

afterEach(() => {
  localStorage.clear();
});

const fresh: WelcomeBootState = {
  completed: false,
  transferred: false,
  resumed: false,
  projects: 0,
  sessions: 0,
};

describe("shouldShowWelcomeAtBoot", () => {
  it("opens on a fresh install", () => {
    expect(shouldShowWelcomeAtBoot(fresh)).toBe(true);
  });

  it.each([
    ["completed", { completed: true }],
    ["a transferred window", { transferred: true }],
    ["a workspace saved by an earlier run", { resumed: true }],
    ["a remembered project", { projects: 1 }],
    ["a listed session", { sessions: 2 }],
  ] as const)("stays closed with %s", (_name, change) => {
    expect(shouldShowWelcomeAtBoot({ ...fresh, ...change })).toBe(false);
  });
});

describe("welcome completed flag", () => {
  it("is unset until saved", () => {
    expect(loadWelcomeCompleted()).toBe(false);
    saveWelcomeCompleted();
    expect(loadWelcomeCompleted()).toBe(true);
    expect(localStorage.getItem("monocode.welcomeCompleted")).toBe("1");
  });

  it("reopens through a window event", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_WELCOME_EVENT, listener);
    openWelcome();
    window.removeEventListener(OPEN_WELCOME_EVENT, listener);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("splitWelcomeAgents", () => {
  it("lists the primary agents before probing finds anything", () => {
    const { shown, more } = splitWelcomeAgents(() => false);
    expect(shown).toEqual(["claude", "codex", "cursor"]);
    expect(more).toContain("grok");
    expect(more).not.toContain("claude");
  });

  it("brings installed agents up beside the primary ones, in harness order", () => {
    const installed = new Set(["pi", "codex"]);
    const { shown, more } = splitWelcomeAgents((id) => installed.has(id));
    expect(shown).toEqual(["claude", "codex", "cursor", "pi"]);
    expect(more).not.toContain("pi");
  });
});

describe("agentStatus", () => {
  it("waits for the first probe", () => {
    expect(agentStatus({ probed: false, installed: false })).toBe("checking");
  });

  it("asks for an install when the CLI is missing", () => {
    expect(
      agentStatus({ probed: true, installed: false, signIn: "signedIn" }),
    ).toBe("missing");
  });

  it("reports installed when the sign-in cannot be checked", () => {
    expect(agentStatus({ probed: true, installed: true })).toBe("installed");
  });

  it("follows the sign-in read for agents that report one", () => {
    expect(
      agentStatus({ probed: true, installed: true, signIn: "checking" }),
    ).toBe("checking");
    expect(
      agentStatus({ probed: true, installed: true, signIn: "signedOut" }),
    ).toBe("signedOut");
    expect(
      agentStatus({ probed: true, installed: true, signIn: "signedIn" }),
    ).toBe("ready");
  });
});

describe("listNames", () => {
  it("joins names the way a sentence would", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["Codex"])).toBe("Codex");
    expect(listNames(["Claude Code", "Codex"])).toBe("Claude Code and Codex");
    expect(listNames(["Claude Code", "Codex", "Cursor"])).toBe(
      "Claude Code, Codex and Cursor",
    );
  });
});
