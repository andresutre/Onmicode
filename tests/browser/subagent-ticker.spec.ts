import { expect, test, type Page } from "@playwright/test";
import type { Block } from "../../src/features/sessions/model/session";

type Fixture = Window & {
  setReplayBlocks(blocks: Block[], busy: boolean): void;
};

function run(id: string, name: string, status: string, steps: string[]): Block {
  return {
    id,
    role: "tool",
    text: `Agent: ${name}`,
    tool: { callId: id, title: `Agent: ${name}`, kind: "agent", status },
    agentRun: {
      name,
      model: "sonnet",
      steps: steps.map((text, i) => ({ id: `${id}-${i}`, kind: "tool", text })),
    },
  };
}

const turn = (statuses: [string, string, string]): Block[] => [
  { id: "u", role: "user", text: "Review the PR and fix lint." },
  { id: "a", role: "assistant", text: "Splitting this across three agents." },
  run("r1", "Quality review", statuses[0], [
    "Read piSubagents.ts",
    "rg status.json src/",
  ]),
  run("r2", "Explore status reader", statuses[1], ["Read harness_spawn.rs"]),
  run("r3", "Lint fixes", statuses[2], [
    "npx tsc --noEmit",
    "Edit piFamily.ts",
  ]),
];

async function open(page: Page, blocks: Block[], busy: boolean) {
  await page.goto("/tests/browser/session-pane.html");
  await page.waitForFunction(
    () => typeof (window as Fixture).setReplayBlocks === "function",
  );
  await page.evaluate(
    ({ blocks, busy }) => (window as Fixture).setReplayBlocks(blocks, busy),
    { blocks, busy },
  );
}

test("the subagent ticker follows the turn's runs", async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await open(page, turn(["in_progress", "in_progress", "in_progress"]), true);

  const ticker = page.locator("[data-subagent-ticker]");
  await expect(ticker).toBeVisible();
  await expect(ticker).toContainText("3 working");
  await expect(ticker.locator(".subagent-ticker-line")).toHaveText(
    "Quality review: rg status.json src/",
  );
  await page.screenshot({ path: info.outputPath("ticker-collapsed.png") });

  await ticker.locator("button[aria-expanded]").click();
  const rows = ticker.locator("#subagent-ticker-list button");
  await expect(rows).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("ticker-open.png") });

  // A row brings the run's own transcript row into view.
  await rows.nth(2).click();
  await expect(page.locator('[data-subagent-row="r3"]')).toHaveClass(
    /subagent-row-flash/,
  );

  // One fails while another finishes: the count follows.
  await page.evaluate(
    (blocks) => (window as Fixture).setReplayBlocks(blocks, true),
    turn(["in_progress", "completed", "failed"]),
  );
  await expect(ticker).toContainText("1 working");
  await expect(rows.nth(2)).toContainText("failed");
  await page.screenshot({ path: info.outputPath("ticker-mixed.png") });

  // The settled turn leaves the runs to the transcript.
  await page.evaluate(
    (blocks) => (window as Fixture).setReplayBlocks(blocks, false),
    turn(["completed", "completed", "failed"]),
  );
  await expect(ticker).toHaveCount(0);
});
