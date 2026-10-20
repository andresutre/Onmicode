import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { accountProviderFor } from "../../../../features/providers/model/providerAccounts";
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
    expect(usageProvidersFor("pi", "pi:openai-codex/gpt-5.4")).toEqual([]);
  });
});
