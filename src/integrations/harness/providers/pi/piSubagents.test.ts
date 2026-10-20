import { describe, expect, it } from "vitest";
import { piSubagentEvents } from "./piSubagents";
import { subagentName } from "../../../../features/sessions/model/transcriptActivity";
import { applyHarnessEvent } from "../../core/apply";
import { newSession } from "../../../../features/sessions/model/session";
import type { HarnessEvent } from "../../core/types";

function apply(events: HarnessEvent[]) {
  return events.reduce(applyHarnessEvent, newSession("pi", "/repo"));
}

describe("Pi subagent snapshots", () => {
  it("merges reasoning, prose and tool results without duplicating repeated snapshots", () => {
    const result = {
      details: {
        results: [
          {
            agent: "scout",
            task: "Check auth",
            model: "claude-haiku-4-5",
            exitCode: 0,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "Private task input" }],
              },
              {
                role: "assistant",
                content: [
                  { type: "thinking", thinking: "Follow the imports" },
                  { type: "text", text: "Reading auth" },
                  {
                    type: "toolCall",
                    id: "read-1",
                    name: "read",
                    arguments: { path: "auth.ts" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const started = piSubagentEvents("spawn", {}, result, false);
    const completed = structuredClone(result);
    (completed.details.results[0].messages as unknown[]).push({
      role: "toolResult",
      toolCallId: "read-1",
      isError: true,
      content: [{ type: "text", text: "Missing file" }],
    });
    const session = apply([
      ...started,
      ...started,
      ...piSubagentEvents("spawn", {}, completed, true),
    ]);
    expect(session.blocks).toHaveLength(1);
    expect(session.blocks[0].agentRun?.model).toBe("claude-haiku-4-5");
    expect(session.blocks[0].agentRun?.steps).toEqual([
      expect.objectContaining({
        kind: "reasoning",
        text: "Follow the imports",
      }),
      expect.objectContaining({ kind: "message", text: "Reading auth" }),
      expect.objectContaining({
        kind: "tool",
        status: "failed",
        text: "Read auth.ts",
        // The step's only readable copy of why it failed.
        detail: "Missing file",
      }),
    ]);
  });

  it("leaves out punctuation-only prose between a subagent's tool calls", () => {
    const result = {
      details: {
        results: [
          {
            agent: "task",
            task: "Read the demo files",
            exitCode: 0,
            messages: [
              {
                role: "assistant",
                content: [
                  { type: "text", text: "." },
                  {
                    type: "toolCall",
                    id: "read-1",
                    name: "read",
                    arguments: { path: "README.md" },
                  },
                ],
              },
              {
                role: "assistant",
                content: [
                  { type: "text", text: " … " },
                  {
                    type: "toolCall",
                    id: "read-2",
                    name: "read",
                    arguments: { path: "index.ts" },
                  },
                ],
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "Both files read." }],
              },
            ],
          },
        ],
      },
    };
    const session = apply(piSubagentEvents("spawn", {}, result, true));
    expect(
      session.blocks[0].agentRun?.steps.map((step) => [step.kind, step.text]),
    ).toEqual([
      ["tool", "Read README.md"],
      ["tool", "Read index.ts"],
      ["message", "Both files read."],
    ]);
  });

  it("gives parallel agents distinct rows even when their local tool ids match", () => {
    const result = {
      details: {
        results: ["first", "second"].map((task, index) => ({
          agent: "scout",
          task,
          exitCode: index,
          stderr: index ? "Provider failed" : "",
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "same",
                  name: "read",
                  arguments: { path: `${task}.ts` },
                },
              ],
            },
          ],
        })),
      },
    };
    const session = apply(
      piSubagentEvents("batch", { tasks: [{}, {}] }, result, true, true),
    );
    const agents = session.blocks.filter(
      (block) => block.tool?.kind === "agent",
    );
    expect(agents).toHaveLength(2);
    expect(agents.map((block) => block.text)).toEqual(["First", "Second"]);
    expect(agents[0].agentRun?.steps[0].text).toBe("Read first.ts");
    expect(agents[0].tool?.status).toBe("completed");
    expect(agents[1].tool?.status).toBe("failed");
    expect(agents[1].tool?.detail).toBe("Provider failed");
    expect(session.blocks[0].tool?.kind).toBe("other");
  });

  it("shows each child of a foreground parallel workflow while it runs", () => {
    // As pi-subagents 0.79 streamed `workflow: "parallel"` with async:false.
    const input = {
      workflow: "parallel",
      args: {
        tasks: [
          { agent: "scout", task: "Reply with exactly PONG1." },
          { agent: "scout", task: "Reply with exactly PONG2." },
        ],
      },
      async: false,
    };
    const update = (children: Array<Record<string, unknown>>) => ({
      details: {
        mode: "workflow",
        results: [],
        workflowChildren: { version: 1, children },
      },
    });
    const events: HarnessEvent[] = [
      {
        type: "tool.started",
        callId: "wf",
        name: "subagent",
        kind: "agent",
        title: "2 parallel subagents",
      },
      ...piSubagentEvents(
        "wf",
        input,
        update([
          { childId: "task-1", state: "completed", runId: "r1" },
          { childId: "task-2", state: "running", runId: "r2", agent: "scout" },
        ]),
        false,
      ),
    ];
    let rows = events
      .reduce(applyHarnessEvent, newSession("pi", "/repo"))
      .blocks.filter((block) => block.tool?.kind === "agent");
    expect(rows.map((row) => [row.tool?.callId, row.tool?.status])).toEqual([
      ["wf:agent:task-1", "completed"],
      ["wf:agent:task-2", "in_progress"],
    ]);
    expect(rows.map((row) => subagentName(row))).toEqual([
      "Reply with exactly PONG1",
      "Reply with exactly PONG2",
    ]);

    // The end lists both results under index 0, told apart by workflowKey.
    events.push(
      ...piSubagentEvents(
        "wf",
        input,
        {
          details: {
            mode: "workflow",
            results: [
              {
                index: 0,
                workflowKey: "task-1",
                agent: "scout",
                exitCode: 0,
                finalOutput: "PONG1",
              },
              {
                index: 0,
                workflowKey: "task-2",
                agent: "scout",
                exitCode: 0,
                finalOutput: "PONG2",
              },
            ],
            workflowChildren: { version: 1, children: [] },
          },
        },
        true,
      ),
    );
    rows = events
      .reduce(applyHarnessEvent, newSession("pi", "/repo"))
      .blocks.filter((block) => block.tool?.kind === "agent");
    expect(rows.map((row) => [row.tool?.callId, row.tool?.status])).toEqual([
      ["wf:agent:task-1", "completed"],
      ["wf:agent:task-2", "completed"],
    ]);
  });

  it("leaves unknown extension detail formats alone", () => {
    expect(
      piSubagentEvents("call", {}, { details: { arbitrary: [] } }, false),
    ).toEqual([]);
  });
});

describe("omp task progress", () => {
  it("settles the current tool in place as it moves into the recent-tools tail", () => {
    const progress = {
      index: 0,
      id: "scout-1",
      agent: "scout",
      task: "Inspect auth",
      status: "running",
      toolCount: 1,
      currentTool: "read",
      currentToolArgs: "auth.ts",
      recentTools: [],
      recentOutput: ["Second line", "First line"],
    };
    const start = piSubagentEvents(
      "task",
      {},
      { details: { progress: [progress], results: [] } },
      false,
    );
    const end = piSubagentEvents(
      "task",
      {},
      {
        details: {
          progress: [
            {
              ...progress,
              status: "completed",
              currentTool: undefined,
              recentTools: [{ tool: "read", args: "auth.ts", endMs: 123 }],
            },
          ],
          results: [
            {
              index: 0,
              id: "scout-1",
              exitCode: 0,
              output: "Found the handler",
            },
          ],
        },
      },
      true,
    );
    const session = apply([...start, ...end]);
    const row = session.blocks[0];
    expect(row.tool?.status).toBe("completed");
    expect(row.tool?.detail).toBe("Found the handler");
    expect(row.agentRun?.steps.filter((step) => step.kind === "tool")).toEqual([
      expect.objectContaining({ status: "completed", text: "read auth.ts" }),
    ]);
    expect(
      row.agentRun?.steps.find((step) => step.kind === "message")?.text,
    ).toBe("First line\nSecond line");
  });

  it("keeps background runs active after their launch tool returns", () => {
    const events = piSubagentEvents(
      "task",
      {},
      {
        details: {
          async: { state: "running" },
          results: [],
          progress: [
            {
              index: 0,
              agent: "scout",
              task: "Explore",
              status: "running",
              toolCount: 0,
            },
          ],
        },
      },
      true,
    );
    expect(events[0]).toMatchObject({
      type: "tool.updated",
      status: "in_progress",
    });
  });
});
