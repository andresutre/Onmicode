import { describe, expect, it } from "vitest";
import { visualRepliesContext } from "./visualReplies";

describe("visual reply instructions", () => {
  it("tells the agent the marker and that the page has no network", () => {
    const context = visualRepliesContext(true)!;
    expect(context.startsWith("<onmicode_visuals>\n")).toBe(true);
    expect(context.endsWith("\n</onmicode_visuals>")).toBe(true);
    expect(context).toContain('`html onmicode-visual title="Short title"`');
    expect(context).toContain("no network access");
    expect(context).toContain("--chart-1 to --chart-6");
  });

  it("says nothing when visual replies are off", () => {
    expect(visualRepliesContext(false)).toBeUndefined();
  });
});
