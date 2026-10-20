import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Account selections live in localStorage; the node test runner has none.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
});
vi.stubGlobal("window", new EventTarget());

const transport = vi.hoisted(() => ({
  watchers: new Map<string, (line: string) => void>(),
  spawns: [] as Array<{ sessionId: string; account: unknown }>,
  writeChild: vi.fn(),
}));

vi.mock("../../core/child", () => ({
  resolveOmpBinary: async () => ({ path: "/fake/omp" }),
  resolvePiBinary: async () => ({ path: "/fake/pi" }),
  acquireHarnessBridge: async () => () => undefined,
  spawnChild: async (
    sessionId: string,
    _command: string,
    _args: string[],
    _cwd: string,
    account?: unknown,
  ) => {
    transport.spawns.push({ sessionId, account });
  },
  killChild: async () => undefined,
  unwatchChild: (id: string) => transport.watchers.delete(id),
  watchChild: (id: string, onLine: (line: string) => void) =>
    transport.watchers.set(id, onLine),
  writeChild: transport.writeChild,
}));

import { forgetPiSession, sendPiTurn } from "./pi";
import { runPiTextPrompt, stopPiTextPrompt } from "./piText";
import {
  accountProviderFor,
  piCodexAccountId,
  selectProviderAccount,
} from "../../../../features/providers/model/providerAccounts";
import {
  otherUsageProvidersFor,
  usageProvidersFor,
} from "../../../../features/providers/model/usageProviders";
import type { SendTurnInput } from "../../core/types";

function frame(sessionId: string, value: Record<string, unknown>) {
  transport.watchers.get(sessionId)?.(JSON.stringify(value));
}

beforeEach(() => {
  transport.spawns.length = 0;
  transport.writeChild.mockReset();
  transport.writeChild.mockImplementation(
    async (sessionId: string, line: string) => {
      const command = JSON.parse(line);
      frame(sessionId, {
        type: "response",
        id: command.id,
        command: command.type,
        success: true,
        data:
          command.type === "get_state"
            ? { sessionId: "provider" }
            : command.type === "get_last_assistant_text"
              ? { text: "A title" }
              : {},
      });
      if (command.type === "prompt") {
        frame(sessionId, { type: "agent_start" });
        frame(sessionId, { type: "agent_settled" });
      }
    },
  );
});
afterEach(async () => {
  localStorage.clear();
  await stopPiTextPrompt();
  for (const id of [...transport.watchers.keys()]) await forgetPiSession(id);
});

function turn(providerAccountId?: string): SendTurnInput {
  return {
    sessionId: "pi-account",
    text: "hello",
    cwd: "/repo",
    model: "pi:claude-code/claude-sonnet-5-5",
    providerAccountId,
    runtimeMode: "supervised",
    onEvent: () => undefined,
  };
}

describe("Pi accounts", () => {
  it("signs Pi in with the session's Claude account", async () => {
    await sendPiTurn(turn("account-work"));
    expect(transport.spawns).toEqual([
      {
        sessionId: "pi-account",
        account: { provider: "pi", id: "account-work" },
      },
    ]);
  });

  it("leaves Pi's own login alone on the default account", async () => {
    await sendPiTurn(turn("default"));
    await sendPiTurn(turn());
    expect(transport.spawns).toEqual([
      { sessionId: "pi-account", account: undefined },
    ]);
  });

  it("restarts Pi on its saved session when the account changes", async () => {
    await sendPiTurn(turn());
    await sendPiTurn(turn("account-work"));
    expect(transport.spawns.map((spawn) => spawn.account)).toEqual([
      undefined,
      { provider: "pi", id: "account-work" },
    ]);
  });

  it("runs title prompts under the same account", async () => {
    await runPiTextPrompt({
      cwd: "/repo",
      model: "claude-code/claude-haiku-4-5",
      prompt: "Title this",
      providerAccountId: "account-work",
    });
    expect(transport.spawns.at(-1)?.account).toEqual({
      provider: "pi",
      id: "account-work",
    });
  });

  it("signs Pi's Codex models in with the chosen Codex profile", async () => {
    await sendPiTurn({ ...turn(), codexAccountId: "account-codex" });
    expect(transport.spawns).toEqual([
      {
        sessionId: "pi-account",
        account: { provider: "pi", id: "default", codexId: "account-codex" },
      },
    ]);
  });

  it("restarts Pi when the Codex profile changes", async () => {
    await sendPiTurn({ ...turn("account-work"), codexAccountId: "default" });
    await sendPiTurn({
      ...turn("account-work"),
      codexAccountId: "account-codex",
    });
    expect(transport.spawns.map((spawn) => spawn.account)).toEqual([
      { provider: "pi", id: "account-work" },
      { provider: "pi", id: "account-work", codexId: "account-codex" },
    ]);
  });

  it("runs title prompts under the same Codex profile", async () => {
    await runPiTextPrompt({
      cwd: "/repo",
      model: "openai-codex/gpt-5.6-luna",
      prompt: "Title this",
      codexAccountId: "account-codex",
    });
    expect(transport.spawns.at(-1)?.account).toEqual({
      provider: "pi",
      id: "default",
      codexId: "account-codex",
    });
  });

  it("takes a Pi session's Codex profile from the project's selection", () => {
    localStorage.setItem(
      "monocode.providerAccounts.v1",
      JSON.stringify({
        codex: [{ id: "account-codex", provider: "codex", label: "Work" }],
      }),
    );
    selectProviderAccount("codex", "/repo", "account-codex");
    expect(piCodexAccountId("pi", "/repo")).toBe("account-codex");
    expect(piCodexAccountId("pi", "/other")).toBe("default");
    expect(piCodexAccountId("claude", "/repo")).toBeUndefined();
  });

  it("picks Pi's accounts from Claude's", () => {
    expect(accountProviderFor("pi")).toBe("claude");
    expect(accountProviderFor("codex")).toBe("codex");
    expect(accountProviderFor("cursor")).toBeUndefined();
  });

  it("shows Claude's usage as a Claude Code Pi session's own", () => {
    expect(usageProvidersFor("pi", "pi:claude-code/claude-sonnet-5-5")).toEqual(
      ["claude"],
    );
    expect(
      otherUsageProvidersFor("pi", "pi:claude-code/claude-sonnet-5-5"),
    ).toEqual(["codex", "opencode", "devin"]);
    expect(usageProvidersFor("pi", "pi:openai-codex/gpt-5.6-luna")).toEqual([
      "codex",
    ]);
    expect(usageProvidersFor("pi", "pi:openrouter/some-model")).toEqual([]);
  });
});
