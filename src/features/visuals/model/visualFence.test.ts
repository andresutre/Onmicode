import { describe, expect, it } from "vitest";
import { visualFence } from "./visualFence";

describe("visual fences", () => {
  it("needs the explicit marker, so a plain HTML fence stays code", () => {
    expect(visualFence("html", "")).toBeNull();
    expect(visualFence("html", "startLine=3")).toBeNull();
    expect(visualFence("xml", "onmicode-visual")).toBeNull();
    expect(visualFence("html", "onmicode-visualize")).toBeNull();
  });

  it("reads the marker after html or as the language, in any case", () => {
    expect(visualFence("html", "onmicode-visual")).toEqual({
      title: "Visual",
    });
    expect(visualFence("HTML", 'title="Sales" ONMICODE-VISUAL')).toEqual({
      title: "Sales",
    });
    expect(visualFence("onmicode-visual", "title=Commits")).toEqual({
      title: "Commits",
    });
  });

  it("does not take the marker from inside a quoted title", () => {
    expect(visualFence("html", 'title="an onmicode-visual demo"')).toBeNull();
  });

  it("tidies the title and falls back when it is empty", () => {
    expect(
      visualFence("html", "onmicode-visual title='  Weekly\tcommits  '"),
    ).toEqual({ title: "Weekly commits" });
    expect(visualFence("html", 'onmicode-visual title=""')).toEqual({
      title: "Visual",
    });
    expect(
      visualFence("html", `onmicode-visual title="${"x".repeat(300)}"`)?.title,
    ).toHaveLength(120);
  });
});
