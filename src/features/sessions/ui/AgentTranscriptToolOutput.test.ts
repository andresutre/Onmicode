// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const user: Block = { id: "user", role: "user", text: "Run the tests" };

function command(detail: string, status = "completed"): Block {
  return {
    id: "command",
    role: "tool",
    text: "npm test",
    tool: { kind: "execute", status, detail },
  };
}

function show(blocks: Block[], busy = true) {
  act(() => root.render(createElement(AgentTranscript, { blocks, busy })));
}

describe("tool output disclosure", () => {
  it("opens a finished command onto what it printed, without colour codes", () => {
    show([user, command("\u001b[32m✓\u001b[39m 12 passed")]);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show output for npm test"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("12 passed");
    expect(
      container.querySelector('[aria-label="Tool call: npm test"]'),
    ).not.toBeNull();

    act(() => trigger?.click());
    const output = container.querySelector("pre[data-tool-output]");
    expect(output?.textContent).toBe("✓ 12 passed");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Hide output for npm test",
    );

    act(() => trigger?.click());
    expect(container.querySelector("pre[data-tool-output]")).toBeNull();
  });

  it("follows a running command's output to its newest line", () => {
    show([user, command("RUN v3", "in_progress")]);
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Show output for npm test"]',
        )
        ?.click(),
    );
    const output = container.querySelector<HTMLPreElement>(
      'pre[data-tool-output="live"]',
    )!;
    expect(output.textContent).toBe("RUN v3");
    Object.defineProperty(output, "scrollHeight", {
      configurable: true,
      get: () => 400,
    });

    show([user, command("RUN v3\n ✓ a.test.ts", "in_progress")]);
    expect(output.textContent).toBe("RUN v3\n ✓ a.test.ts");
    expect(output.scrollTop).toBe(400);

    // Done, the window stops following and keeps the finished output.
    show([user, command("RUN v3\n ✓ a.test.ts\n 1 passed")]);
    expect(container.querySelector('pre[data-tool-output="live"]')).toBeNull();
    expect(container.querySelector("pre[data-tool-output]")?.textContent).toBe(
      "RUN v3\n ✓ a.test.ts\n 1 passed",
    );
  });

  it("leaves a read closed: its chip is the way in", () => {
    show([
      user,
      {
        id: "read",
        role: "tool",
        text: "Read src/a.ts",
        tool: {
          kind: "read",
          status: "completed",
          detail: "export const a = 1;",
          preview: { kind: "read", path: "src/a.ts", fileName: "a.ts" },
        },
      },
    ]);
    expect(container.querySelector('button[aria-label^="Show output"]')).toBe(
      null,
    );
  });
});

describe("a folded group that ended on a failure", () => {
  it("says so on its header", () => {
    const failed = (id: string, text: string, status: string): Block => ({
      id,
      role: "tool",
      text,
      tool: { kind: "execute", status },
    });
    show(
      [
        user,
        failed("build", "npm run build", "completed"),
        failed("test", "npm test", "failed"),
      ],
      false,
    );
    const header = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Show the steps for Ran 2 commands"]',
    );
    expect(header?.getAttribute("aria-label")).toBe(
      "Show the steps for Ran 2 commands, which ended on a failed call",
    );
    expect(header?.querySelector("svg.text-red-400")).not.toBeNull();

    act(() => header?.click());
    // Open, the failed row carries the mark instead.
    expect(header?.getAttribute("aria-label")).toBe(
      "Hide the steps for Ran 2 commands",
    );
    expect(header?.querySelector("svg.text-red-400")).toBeNull();
  });
});
