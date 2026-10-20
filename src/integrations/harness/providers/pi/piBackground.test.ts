import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  watchers: new Map<string, (line: string) => void>(),
  requests: [] as Array<{
    sessionId: string;
    command: Record<string, unknown>;
  }>,
  prompt: undefined as
    ((sessionId: string, command: Record<string, unknown>) => void) | undefined,
  writeChild: vi.fn(),
  files: new Map<string, string>(),
}));

vi.mock("../../core/child", () => ({
  resolveOmpBinary: async () => ({ path: "/fake/omp" }),
  resolvePiBinary: async () => ({ path: "/fake/pi" }),
  acquireHarnessBridge: async () => () => undefined,
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: (id: string) => transport.watchers.delete(id),
  watchChild: (id: string, onLine: (line: string) => void) =>
    transport.watchers.set(id, onLine),
  writeChild: transport.writeChild,
  readHarnessTextFile: async (path: string) => {
    const text = transport.files.get(path);
    if (text == null) throw new Error(`No such file: ${path}`);
    return text;
  },
}));

import { cancelPiTurn, forgetPiSession, sendPiTurn, steerPiTurn } from "./pi";
import { respondQuestion } from "./piFamily";
import { PI_FLAVOR } from "./piFlavor";
import { applyHarnessEvent } from "../../core/apply";
import { newSession } from "../../../../features/sessions/model/session";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const RUN = "03f354c2-7ab3-4f7a-8b1f-3f9e5fb89dd3";
const NL = String.fromCharCode(10);
let events: HarnessEvent[] = [];

function frame(value: Record<string, unknown>, sessionId = "pi-bg") {
  transport.watchers.get(sessionId)?.(JSON.stringify(value));
}
function respond(command: Record<string, unknown>, data?: unknown) {
  frame({
    type: "response",
    id: command.id,
    command: command.type,
    success: true,
    data,
  });
}
function input(text = "Delegate to scout"): SendTurnInput {
  return {
    sessionId: "pi-bg",
    text,
    cwd: "/repo",
    model: "pi:default",
    runtimeMode: "supervised",
    onEvent: (event) => events.push(event),
  };
}
function prompts() {
  return transport.requests
    .filter((r) => r.command.type === "prompt")
    .map((r) => r.command);
}

/** pi-subagents' status widget, as Pi 1.3.0 sent it over RPC. */
function asyncWidget(
  state?: string,
  snapshot: { runs?: Array<Record<string, unknown>>; omitted?: unknown } = {},
) {
  return {
    type: "extension_ui_request",
    id: crypto.randomUUID(),
    method: "setWidget",
    widgetKey: "subagent-async",
    ...(state
      ? {
          widgetLines: [
            `PI_SUBAGENT_ASYNC_JSON:${JSON.stringify({
              kind: "pi-subagents.async-status-snapshot",
              version: 1,
              ...(snapshot.omitted ? { omitted: snapshot.omitted } : {}),
              runs: snapshot.runs ?? [
                {
                  id: RUN,
                  kind: "subagent",
                  label: "scout",
                  state,
                  activity: { turnCount: 1 },
                },
              ],
            })}`,
          ],
        }
      : {}),
  };
}

function text(value: string) {
  frame({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: value },
  });
}

/** The first run: Pi detaches a scout and yields, as captured from Pi. */
function detachAndYield(details: Record<string, unknown> = {}) {
  frame({ type: "agent_start" });
  frame({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "subagent",
    args: { agent: "scout", task: "Reply PONG" },
  });
  frame(asyncWidget("queued"));
  frame(asyncWidget("running"));
  frame({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "subagent",
    isError: false,
    result: {
      content: [{ type: "text", text: `Async: scout [${RUN}]\n\nDetached.` }],
      details: { mode: "single", results: [], asyncId: RUN, ...details },
    },
  });
  text("Launched scout in the background.");
  frame({ type: "agent_end" });
  frame({ type: "agent_settled" });
}

function completionNotice(status = "completed") {
  frame({
    type: "message_start",
    message: {
      role: "custom",
      customType: "subagent-notify",
      display: status !== "completed",
      content: `Background task ${status}: **scout**\n\nscout:\nPONG\n\nParent action: Read the saved results above.`,
      details: { runs: [{ agent: "scout", status, runId: RUN }] },
    },
  });
}

async function start(turnInput = input()) {
  let settled = false;
  const turn = sendPiTurn(turnInput).finally(() => {
    settled = true;
  });
  void turn.catch(() => undefined);
  await vi.waitFor(() => expect(prompts()).toHaveLength(1));
  return { turn, settled: () => settled };
}

beforeEach(() => {
  events = [];
  transport.requests.length = 0;
  transport.files.clear();
  transport.prompt = (_sessionId, command) =>
    respond(command, {
      disposition: String(command.message).startsWith("/subagents-")
        ? "handled"
        : "started",
    });
  transport.writeChild.mockReset();
  transport.writeChild.mockImplementation(
    async (sessionId: string, line: string) => {
      const command = JSON.parse(line);
      transport.requests.push({ sessionId, command });
      if (command.type === "extension_ui_response") return;
      if (command.type === "prompt")
        return transport.prompt?.(sessionId, command);
      respond(
        command,
        command.type === "get_state" ? { sessionId: "provider" } : {},
      );
    },
  );
});
afterEach(async () => {
  vi.useRealTimers();
  for (const id of [...transport.watchers.keys()]) await forgetPiSession(id);
});

describe("Pi background subagents", () => {
  it("keeps the turn open until Pi's wake-up run answers", async () => {
    const running = await start();
    detachAndYield();
    await Promise.resolve();
    expect(running.settled()).toBe(false);
    expect(events).toContainEqual({
      type: "background.updated",
      tasks: ["Reply PONG"],
    });

    frame(asyncWidget("complete"));
    completionNotice();
    frame({ type: "agent_start" });
    text("DONE");
    frame({ type: "agent_end" });
    frame({ type: "agent_settled" });
    await running.turn;

    const session = events.reduce(applyHarnessEvent, newSession("pi", "/repo"));
    const row = session.blocks.find((block) => block.tool?.callId === "call-1");
    expect(row?.tool?.status).toBe("completed");
    expect(row?.tool?.detail).toContain("PONG");
    expect(row?.tool?.detail).not.toContain("Parent action");
    const replies = session.blocks
      .filter((block) => block.role === "assistant")
      .map((block) => block.text);
    expect(replies).toEqual(["Launched scout in the background.", "DONE"]);
    expect(session.backgroundTasks).toBeUndefined();
    expect(
      events.filter((event) => event.type === "background.updated").at(-1),
    ).toEqual({ type: "background.updated", tasks: [] });
  });

  it("shows what a background subagent is doing from its files", async () => {
    const dir = "/tmp/runs/" + RUN;
    const log = "/sessions/child/session.jsonl";
    const status = (state: string) =>
      JSON.stringify({
        runId: RUN,
        state,
        steps: [
          {
            agent: "scout",
            description: "[prompt redacted]",
            sessionName: "scout: Reply PONG",
            status: state === "running" ? "running" : "complete",
            model: "claude-code/default",
            sessionFile: log,
          },
        ],
      });
    const line = (message: Record<string, unknown>) =>
      JSON.stringify({ type: "message", message });
    transport.files.set(`${dir}/status.json`, status("running"));
    transport.files.set(
      log,
      [
        JSON.stringify({ type: "session", version: 3 }),
        line({ role: "user", content: [{ type: "text", text: "Reply PONG" }] }),
        line({
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t1",
              name: "bash",
              arguments: { command: "echo PONG" },
            },
          ],
        }),
        '{"type":"message","mess',
      ].join(NL),
    );
    const running = await start();
    detachAndYield({ asyncDir: dir });
    const steps = () =>
      events
        .reduce(applyHarnessEvent, newSession("pi", "/repo"))
        .blocks.find((block) => block.tool?.callId === "call-1")?.agentRun
        ?.steps;
    await vi.waitFor(() =>
      expect(steps()).toMatchObject([
        { kind: "tool", text: expect.stringContaining("echo PONG") },
      ]),
    );
    expect(steps()?.[0].status).toBe("in_progress");

    transport.files.set(`${dir}/status.json`, status("complete"));
    transport.files.set(
      log,
      transport.files.get(log)!.replace(
        /[^\n]*$/,
        [
          line({
            role: "toolResult",
            toolCallId: "t1",
            content: [{ type: "text", text: "PONG" }],
            isError: false,
          }),
          line({
            role: "assistant",
            content: [{ type: "text", text: "PONG" }],
          }),
        ].join(NL),
      ),
    );
    frame(asyncWidget("complete"));
    completionNotice();
    await vi.waitFor(() =>
      expect(steps()).toMatchObject([
        { kind: "tool", status: "completed" },
        { kind: "message", text: "PONG" },
      ]),
    );
    frame({ type: "agent_start" });
    text("DONE");
    frame({ type: "agent_settled" });
    await running.turn;
    const row = events
      .reduce(applyHarnessEvent, newSession("pi", "/repo"))
      .blocks.find((block) => block.tool?.callId === "call-1");
    expect(row?.tool?.status).toBe("completed");
    expect(row?.agentRun?.name).toBe("Reply PONG");
  });

  it("lets the turn go when a finished run never wakes Pi", async () => {
    const running = await start();
    detachAndYield();
    vi.useFakeTimers();
    frame(asyncWidget("complete"));
    frame(asyncWidget());
    await vi.advanceTimersByTimeAsync(14_000);
    expect(running.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();
    await running.turn;
  });

  it("keeps waiting on a run a capped snapshot left out", async () => {
    const running = await start();
    detachAndYield();
    vi.useFakeTimers();
    // More runs than the widget lists: ours was crowded off, not finished.
    const crowded = {
      runs: [
        {
          id: "other-run",
          kind: "subagent",
          label: "worker",
          state: "running",
        },
      ],
    };
    frame(
      asyncWidget("running", {
        ...crowded,
        omitted: { runs: 1, children: 0, byteLimitExceeded: false },
      }),
    );
    frame(
      asyncWidget("running", {
        ...crowded,
        omitted: { runs: 0, children: 0, byteLimitExceeded: true },
      }),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(running.settled()).toBe(false);
    const session = events.reduce(applyHarnessEvent, newSession("pi", "/repo"));
    expect(
      session.blocks.find((block) => block.tool?.callId === "call-1")?.tool
        ?.status,
    ).toBe("in_progress");
    expect(session.backgroundTasks).toEqual(["Reply PONG", "worker"]);

    // Its own notice still ends it.
    completionNotice();
    frame(asyncWidget("running", crowded));
    frame(asyncWidget());
    await vi.advanceTimersByTimeAsync(16_000);
    vi.useRealTimers();
    await running.turn;
  });

  it("ends a run a complete snapshot no longer lists", async () => {
    const running = await start();
    detachAndYield();
    vi.useFakeTimers();
    frame(
      asyncWidget("running", {
        runs: [],
        omitted: { runs: 0, children: 0, byteLimitExceeded: false },
      }),
    );
    const row = events
      .reduce(applyHarnessEvent, newSession("pi", "/repo"))
      .blocks.find((block) => block.tool?.callId === "call-1");
    expect(row?.tool?.status).toBe("completed");
    await vi.advanceTimersByTimeAsync(16_000);
    vi.useRealTimers();
    await running.turn;
  });

  it("stops the background runs along with the turn", async () => {
    const running = await start();
    detachAndYield();
    await cancelPiTurn("pi-bg");
    await running.turn;
    expect(transport.requests.map((r) => r.command.type)).toContain("abort");
    expect(prompts().at(-1)?.message).toBe(`/subagents-stop ${RUN}`);
    const row = events
      .reduce(applyHarnessEvent, newSession("pi", "/repo"))
      .blocks.find((block) => block.tool?.callId === "call-1");
    expect(row?.tool?.status).toBe("failed");

    // The stopped run's notice still wakes Pi; that run is aborted.
    const aborts = () =>
      transport.requests.filter((r) => r.command.type === "abort").length;
    const before = aborts();
    completionNotice("stopped");
    frame({ type: "agent_start" });
    await vi.waitFor(() => expect(aborts()).toBe(before + 1));
  });

  it("starts a run for a message sent while Pi waits on its subagents", async () => {
    const running = await start();
    detachAndYield();
    await steerPiTurn({
      sessionId: "pi-bg",
      text: "Any news?",
      runtimeMode: "supervised",
    });
    expect(prompts().at(-1)).toMatchObject({
      type: "prompt",
      message: "Any news?",
    });
    expect(transport.requests.some((r) => r.command.type === "steer")).toBe(
      false,
    );
    frame({ type: "agent_start" });
    text("Still running.");
    frame({ type: "agent_settled" });
    expect(running.settled()).toBe(false);
    frame(asyncWidget("complete"));
    completionNotice();
    frame({ type: "agent_start" });
    text("DONE");
    frame({ type: "agent_settled" });
    await running.turn;
  });

  it("queues a new prompt as a steer while Pi runs on its own", async () => {
    const running = await start();
    frame({ type: "agent_start" });
    text("Hi");
    frame({ type: "agent_settled" });
    await running.turn;

    // A late subagent notice woke Pi after the turn ended.
    frame({ type: "agent_start" });
    const next = sendPiTurn(input("Next"));
    await vi.waitFor(() => expect(prompts()).toHaveLength(2));
    expect(prompts()[1]).toMatchObject({
      message: "Next",
      streamingBehavior: "steer",
    });
    frame({ type: "agent_settled" });
    await next;
  });

  it("shows pi-subagents command replies and ends a handled command's turn", async () => {
    const running = await start(input(`/subagents-status`));
    frame({
      type: "message_start",
      message: {
        role: "custom",
        customType: "subagent-slash-result",
        display: true,
        content: "## Subagent result\n\nNo active runs.",
      },
    });
    await running.turn;
    expect(events).toContainEqual({
      type: "interjection",
      text: "## Subagent result\n\nNo active runs.",
      customType: "subagent-slash-result",
    });
  });
});

describe("Pi extension questions", () => {
  it("asks a select as a question and replies with the chosen option", async () => {
    const running = await start();
    frame({ type: "agent_start" });
    frame({
      type: "extension_ui_request",
      id: "ui-1",
      method: "select",
      title: "Pick a profile",
      options: ["fast", "careful"],
    });
    const asked = events.find((event) => event.type === "question.asked");
    expect(asked).toMatchObject({
      questions: [
        { id: "ui-1", options: [{ label: "fast" }, { label: "careful" }] },
      ],
    });
    respondQuestion(
      PI_FLAVOR,
      "pi-bg",
      (asked as { requestId: number }).requestId,
      { kind: "answered", answers: { "ui-1": ["1"] } },
    );
    await vi.waitFor(() =>
      expect(
        transport.requests.find(
          (r) => r.command.type === "extension_ui_response",
        )?.command,
      ).toEqual({
        type: "extension_ui_response",
        id: "ui-1",
        value: "careful",
      }),
    );
    frame({ type: "agent_settled" });
    await running.turn;
  });
});
