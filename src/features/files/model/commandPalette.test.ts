import { describe, expect, it } from "vitest";
import {
  PALETTE_RECENT_LIMIT,
  paletteCommands,
  paletteProjects,
  paletteSessions,
  rankPaletteItems,
} from "./commandPalette";

const session = (id: string, title: string, updatedAt: number, extra = {}) => ({
  id,
  title,
  cwd: "/work/repo",
  updatedAt,
  ...extra,
});

describe("command palette items", () => {
  it("gives every command a unique id and shows known shortcuts", () => {
    const commands = paletteCommands();
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
    expect(commands.find((c) => c.id === "reload")?.hint).toBeTruthy();
    expect(commands.find((c) => c.id === "inbox")?.hint).toBeUndefined();
  });

  it("lists visible sessions newest first with their project", () => {
    const items = paletteSessions([
      session("old", "Old task", 1),
      session("new", "New task", 3),
      session("archived", "Archived", 5, { archived: true }),
      session("draft", "Draft", 6, { draft: true }),
      session("hidden", "Hidden", 7, { sidebarHidden: true }),
      session("blank", "  ", 8),
    ]);
    expect(items.map((item) => item.id)).toEqual(["session:new", "session:old"]);
    expect(items[0].detail).toBe("repo");
  });

  it("names projects by folder", () => {
    expect(paletteProjects(["/work/site"])[0]).toMatchObject({
      id: "project:/work/site",
      label: "site",
    });
  });
});

describe("rankPaletteItems", () => {
  const sessions = paletteSessions(
    Array.from({ length: 12 }, (_, i) => session(`s${i}`, `Task ${i}`, i)),
  );
  const items = [...paletteCommands(), ...sessions];

  it("shows all commands and only recent sessions without a query", () => {
    const ranked = rankPaletteItems(items, "");
    expect(ranked.filter((i) => i.group === "Commands")).toHaveLength(
      paletteCommands().length,
    );
    expect(ranked.filter((i) => i.group === "Sessions")).toHaveLength(
      PALETTE_RECENT_LIMIT,
    );
  });

  it("fuzzy-matches labels and highlights them", () => {
    const ranked = rankPaletteItems(items, "task 3");
    expect(ranked[0].id).toBe("session:s3");
    expect(ranked[0].positions.length).toBeGreaterThan(0);
  });

  it("matches hidden keywords below label matches, without highlights", () => {
    const ranked = rankPaletteItems(items, "preferences");
    expect(ranked.map((i) => i.id)).toEqual(["settings"]);
    expect(ranked[0].positions).toEqual([]);
  });

  it("returns nothing for an unmatched query", () => {
    expect(rankPaletteItems(items, "zzzqqq")).toEqual([]);
  });
});
