// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UsageHistory } from "./usageHistory";
import { UsageHistorySection } from "./UsageHistorySection";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let container: HTMLDivElement;
let root: Root;

const history: UsageHistory = {
  buckets: [
    {
      day: 29,
      harness: "claude",
      model: "claude:opus-4.5",
      modelName: "Opus 4.5",
      project: "/work/app",
      turns: 3,
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 4_000_000,
      cacheWriteTokens: 0,
    },
    {
      day: 29,
      harness: "pi",
      model: "pi:default",
      modelName: "Default",
      project: "/work/lib",
      turns: 1,
      inputTokens: 0,
      outputTokens: 300_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ],
  sessions: 2,
  unreported: [{ harness: "cursor", sessions: 1 }],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(UsageHistorySection)));
}

function radio(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('[role="radio"]')].find(
    (element) => element.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(label);
  return button;
}

it("shows totals, the daily chart and a breakdown by agent", async () => {
  mocks.invoke.mockResolvedValue(history);
  await render();

  const request = mocks.invoke.mock.calls[0][1].request;
  expect(request.dayStarts).toHaveLength(31);
  expect(container.textContent).toContain("5.5M");
  expect(container.textContent).toContain("2 sessions · 4 turns");
  expect(
    container.querySelector('[role="group"]')?.getAttribute("aria-label"),
  ).toMatch(/^Daily processed tokens by agent/);
  const rows = [...container.querySelectorAll("tbody tr")].map(
    (row) => row.querySelector("td")?.textContent,
  );
  expect(rows).toEqual(["Claude Code", "Pi"]);
  expect(container.textContent).toContain(
    "Not counted: Cursor (1 session) recorded no token counts.",
  );
});

it("switches to an estimated cost that leaves unpriced models out", async () => {
  mocks.invoke.mockResolvedValue(history);
  await render();
  await act(async () => radio("Cost").click());

  // Opus 4.5: $5 input + $5 output + $2 cache reads.
  expect(container.textContent).toContain("$12.00");
  expect(container.textContent).toContain("Daily estimated cost");
  expect(container.textContent).toContain("Unpriced");
  expect(container.textContent).toContain(
    "No price for Default, so 300K tokens are left out of the cost.",
  );
  expect(localStorage.getItem("monocode.usageHistory.metric")).toBe("cost");
});

it("reloads for another period and remembers it", async () => {
  mocks.invoke.mockResolvedValue(history);
  await render();
  await act(async () => radio("7d").click());

  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(mocks.invoke.mock.calls[1][1].request.dayStarts).toHaveLength(8);
  expect(localStorage.getItem("monocode.usageHistory.days")).toBe("7");
});

it("says so when the period has no usage", async () => {
  mocks.invoke.mockResolvedValue({ buckets: [], sessions: 0, unreported: [] });
  await render();

  expect(container.textContent).toContain(
    "No token usage recorded in the last 30 days.",
  );
  expect(container.querySelector("table")).toBeNull();
});

it("offers a retry when the first load fails", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("Session store is locked"));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Session store is locked",
  );

  mocks.invoke.mockResolvedValue(history);
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  await act(async () => retry?.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("5.5M");
});

it("reads one day at a time from the keyboard", async () => {
  mocks.invoke.mockResolvedValue(history);
  await render();
  const plot = container.querySelector<HTMLElement>('[role="group"]')!;

  await act(async () => plot.focus());
  const live = () => plot.querySelector('[aria-live="polite"]')?.textContent;
  expect(live()).toMatch(/: 5\.5M$/);
  await act(async () =>
    plot.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    ),
  );
  expect(live()).toMatch(/: 0$/);
});
