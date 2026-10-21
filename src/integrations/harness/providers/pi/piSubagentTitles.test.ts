import { describe, expect, it } from "vitest";
import {
  buildSubagentTitlePrompt,
  parseSubagentTitles,
  piSubagentBriefs,
  subagentRowBrief,
} from "./piSubagentTitles";

describe("piSubagentBriefs", () => {
  it("reads one brief per task of a parallel workflow", () => {
    expect(
      piSubagentBriefs({
        workflow: "parallel",
        args: {
          tasks: [
            { agent: "reviewer", task: "Review GitHub PR #487 in repo X." },
            { agent: "reviewer", task: "[prompt redacted]" },
          ],
        },
      }),
    ).toEqual(["Review GitHub PR #487 in repo X.", undefined]);
  });

  it("reads a single run's brief and skips management calls", () => {
    expect(piSubagentBriefs({ agent: "scout", task: "Find the bug" })).toEqual([
      "Find the bug",
    ]);
    expect(piSubagentBriefs({ action: "status", id: "x" })).toEqual([]);
    expect(piSubagentBriefs({ workflow: true })).toEqual([]);
  });
});

describe("parseSubagentTitles", () => {
  it("keeps one clean title per brief, in order", () => {
    expect(
      parseSubagentTitles(
        'Sure: {"titles": ["Review PR #487.", "  Fix chart legend  ", 3]}',
        3,
      ),
    ).toEqual(["Review PR #487", "Fix chart legend", undefined]);
  });

  it("returns nothing for output that isn't the JSON asked for", () => {
    expect(parseSubagentTitles("Review PR #487", 1)).toEqual([]);
    expect(parseSubagentTitles('{"title": "x"}', 1)).toEqual([]);
  });

  it("drops titles past the number of briefs", () => {
    expect(parseSubagentTitles('{"titles": ["A b", "C d"]}', 1)).toEqual([
      "A b",
    ]);
  });
});

describe("buildSubagentTitlePrompt", () => {
  it("numbers the briefs and marks hidden ones", () => {
    const prompt = buildSubagentTitlePrompt(["Review PR #1", undefined]);
    expect(prompt).toContain("Task 1:\nReview PR #1");
    expect(prompt).toContain("Task 2:\n(not shown)");
  });
});

describe("subagentRowBrief", () => {
  it("maps rows back to their brief", () => {
    expect(subagentRowBrief("c", "c")).toBe(0);
    expect(subagentRowBrief("c", "c:agent:task-3")).toBe(2);
    expect(subagentRowBrief("c", "c:agent:1")).toBe(1);
    expect(subagentRowBrief("c", "other")).toBeUndefined();
  });
});
