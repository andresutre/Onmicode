// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { currentTurnSubagents, tickerFocus } from "../model/subagentTicker";
import { SubagentTicker, TICKER_BEAT_MS } from "./SubagentTicker";

function user(id: string): Block {
  return { id, role: "user", text: "go" };
}

function run(
  id: string,
  name: string,
  status: string,
  steps: string[] = [],
): Block {
  return {
    id,
    role: "tool",
    text: `Agent: ${name}`,
    tool: { callId: id, title: `Agent: ${name}`, kind: "agent", status },
    agentRun: {
      name,
      steps: steps.map((text, i) => ({ id: `${id}-${i}`, kind: "tool", text })),
    },
  };
}

describe("currentTurnSubagents", () => {
  it("keeps only the runs after the last user message", () => {
    const runs = currentTurnSubagents([
      user("u1"),
      run("old", "Old review", "completed"),
      user("u2"),
      run("a", "Quality review", "in_progress", ["Read a.ts", "rg x\nmore"]),
      { id: "p", role: "assistant", text: "hi" },
      run("b", "Lint fixes", "failed"),
    ]);
    expect(runs.map((r) => [r.id, r.state, r.steps, r.now])).toEqual([
      ["a", "pending", 2, "rg x"],
      ["b", "rejected", 0, ""],
    ]);
  });

  it("rotates through working runs, then rests on the last", () => {
    const runs = currentTurnSubagents([
      user("u"),
      run("a", "A", "in_progress"),
      run("b", "B", "completed"),
      run("c", "C", "in_progress"),
    ]);
    expect([0, 1, 2].map((t) => tickerFocus(runs, t)?.id)).toEqual([
      "a",
      "c",
      "a",
    ]);
    const settled = runs.map((r) => ({ ...r, state: "accepted" as const }));
    expect(tickerFocus(settled, 5)?.id).toBe("c");
  });
});

describe("SubagentTicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = (blocks: Block[], busy = true) =>
    act(() => root.render(createElement(SubagentTicker, { blocks, busy })));

  it("stays away when the turn has no subagents or has settled", () => {
    render([user("u"), { id: "a", role: "assistant", text: "hi" }]);
    expect(container.querySelector("[data-subagent-ticker]")).toBeNull();
    render([user("u"), run("a", "A", "completed")], false);
    expect(container.querySelector("[data-subagent-ticker]")).toBeNull();
  });

  it("shows the working count and cycles the line between runs", () => {
    render([
      user("u"),
      run("a", "Quality review", "in_progress", ["Read a.ts"]),
      run("b", "Lint fixes", "in_progress", ["npx tsc"]),
    ]);
    const line = () =>
      container.querySelector(".subagent-ticker-line")?.textContent;
    expect(container.textContent).toContain("2 working");
    expect(line()).toBe("Quality review: Read a.ts");
    act(() => vi.advanceTimersByTime(TICKER_BEAT_MS));
    expect(line()).toBe("Lint fixes: npx tsc");
  });

  it("opens into a list, and a row jumps to the run in the transcript", () => {
    const target = document.createElement("div");
    target.setAttribute("data-subagent-row", "b");
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    render([
      user("u"),
      run("a", "Quality review", "in_progress"),
      run("b", "Lint fixes", "failed"),
    ]);
    const pill = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    act(() => pill.click());
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    const rows = container.querySelectorAll<HTMLButtonElement>(
      "#subagent-ticker-list button",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain("failed");

    act(() => rows[1].click());
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(target.classList.contains("subagent-row-flash")).toBe(true);
    target.remove();
  });
});
