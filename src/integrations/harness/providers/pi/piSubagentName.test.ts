import { describe, expect, it } from "vitest";
import { piSubagentEvents } from "./piSubagents";
import { toolTitle } from "./piProtocol";
import {
  piSubagentLaunchTitle,
  piSubagentName,
  taskHeadline,
} from "./piSubagentName";

// Briefs as Pi's agents actually write them (paths shortened).
const REVIEW =
  "Read C:/Users/me/repo/.worktrees/_round16/review-brief.md and follow it exactly. Repo root: C:/Users/me/repo. Never use git stash; never git add -A. Final message: the verdict blocks only. Review PR #441 (partial-close wording) and PR #448 (TP/SL hint rounding). Worktree names review16-<N>.";
const WORKTREE =
  "You are in a git worktree at C:/Users/me/repo/.worktrees/fix-481, on branch feat/rings (PR #481). The PR now conflicts with `dev` because #473 and #482 merged first. Fix it so the PR is mergeable.";

describe("piSubagentName", () => {
  it("skips the setup sentences a brief opens with", () => {
    expect(taskHeadline(REVIEW)).toBe("Review PR #441 and PR #448");
    expect(taskHeadline(WORKTREE)).toBe("The PR now conflicts with dev");
  });

  it("keeps a short brief whole, minus formatting", () => {
    expect(
      taskHeadline("Reply with the single word PONG. Do not use tools."),
    ).toBe("Reply with the single word PONG");
    expect(
      taskHeadline(
        "Run these bash commands one at a time, each as its own tool call: `sleep 20`.",
      ),
    ).toBe("Run these bash commands one at a time");
    expect(
      taskHeadline(
        "You are building exchanges-section variant v01. Read BRIEF.md first.",
      ),
    ).toBe("Building exchanges-section variant v01");
    expect(taskHeadline("Scope: the uncommitted changes on dev.")).toBe(
      "The uncommitted changes on dev",
    );
  });

  it("shortens paths to their file name", () => {
    expect(
      taskHeadline("Fix the flaky test in C:/a/b/src/app/App.test.ts"),
    ).toBe("Fix the flaky test in App.test.ts");
  });

  it("prefers a description, and falls back past a redacted task", () => {
    expect(piSubagentName({ description: "Audit auth", task: REVIEW })).toBe(
      "Audit auth",
    );
    expect(
      piSubagentName({
        agent: "comment-sicko",
        task: "[prompt redacted]",
        sessionName:
          "comment-sicko: Scope: the uncommitted working-tree changes on `de...",
      }),
    ).toBe("The uncommitted working-tree changes on de");
    expect(
      piSubagentName({ agent: "code-reviewer", task: "[prompt redacted]" }),
    ).toBe("Code Reviewer");
    // pi-subagents' status file redacts the description too.
    expect(
      piSubagentName({
        agent: "scout",
        description: "[prompt redacted]",
        sessionName: "scout: Reply PONG",
      }),
    ).toBe("Reply PONG");
  });
});

describe("piSubagentLaunchTitle", () => {
  it("names batches and workflows as a group", () => {
    const task = { agent: "worker", task: "Say hi." };
    expect(piSubagentLaunchTitle({ tasks: [task, task, task] })).toBe(
      "3 parallel subagents",
    );
    expect(
      piSubagentLaunchTitle({
        workflow: "parallel",
        args: { tasks: [task, task] },
      }),
    ).toBe("2 parallel subagents");
    expect(piSubagentLaunchTitle({ chain: [task, task] })).toBe(
      "Chain of 2 subagents",
    );
    expect(piSubagentLaunchTitle({ workflow: "true", async: true })).toBe(
      "Workflow",
    );
    expect(piSubagentLaunchTitle({ workflow: "scripts/review.js" })).toBe(
      "Workflow review.js",
    );
  });

  it("titles a single run's launch row after its job", () => {
    expect(toolTitle("subagent", { agent: "delegate", task: REVIEW })).toBe(
      "Review PR #441 and PR #448",
    );
  });

  it("names each child of a batch after its own job", () => {
    const events = piSubagentEvents(
      "call",
      { tasks: [{}, {}] },
      {
        details: {
          results: [
            { index: 0, agent: "delegate", task: REVIEW },
            { index: 1, agent: "worker", task: WORKTREE },
          ],
        },
      },
      true,
    );
    const titles = events
      .filter(
        (event) => event.type === "tool.updated" && event.kind === "agent",
      )
      .map((event) => (event.type === "tool.updated" ? event.title : ""));
    expect(titles).toEqual([
      "Review PR #441 and PR #448",
      "The PR now conflicts with dev",
    ]);
  });
});
