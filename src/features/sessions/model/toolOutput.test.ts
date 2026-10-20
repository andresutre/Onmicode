import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { plainToolOutput, toolOutputDisclosure } from "./toolOutput";

function tool(
  text: string,
  fields: NonNullable<Block["tool"]>,
  extra: Partial<Block> = {},
): Block {
  return { id: text, role: "tool", text, tool: fields, ...extra };
}

const shown = (detail?: string, omitted = false) => ({ detail, omitted });

describe("toolOutputDisclosure", () => {
  it("opens a command onto what it printed, while it runs and after", () => {
    const done = tool("npm test", { kind: "execute", status: "completed" });
    expect(toolOutputDisclosure(done, "npm test", shown("12 passed"))).toBe(
      "output",
    );
    const running = tool("npm test", {
      kind: "execute",
      status: "in_progress",
    });
    expect(toolOutputDisclosure(running, "npm test", shown("RUN v3"))).toBe(
      "output",
    );
  });

  it("opens output still in storage, and a tool whose result is not on screen", () => {
    const stored = tool("npm test", { kind: "execute", status: "completed" });
    expect(
      toolOutputDisclosure(stored, "npm test", shown(undefined, true)),
    ).toBe("output");
    const fetch = tool("Fetch https://example.com", {
      kind: "fetch",
      status: "completed",
    });
    expect(
      toolOutputDisclosure(fetch, "Fetch https://example.com", shown("<html>")),
    ).toBe("output");
  });

  it("opens any failure onto its reason", () => {
    const read = tool("Read a.ts", {
      kind: "read",
      status: "failed",
      preview: { kind: "read", path: "a.ts", fileName: "a.ts" },
    });
    expect(toolOutputDisclosure(read, "Read a.ts", shown("ENOENT"))).toBe(
      "error",
    );
  });

  it("leaves rows that already carry their result closed", () => {
    const read = tool("Read a.ts", {
      kind: "read",
      status: "completed",
      preview: { kind: "read", path: "a.ts", fileName: "a.ts" },
    });
    const search = tool("Find tokens", {
      kind: "search",
      status: "completed",
      preview: { kind: "search", query: "tokens" },
    });
    const edit = tool("Edit a.ts", {
      kind: "edit",
      status: "completed",
      preview: { kind: "write", path: "a.ts", fileName: "a.ts" },
    });
    for (const [block, label] of [
      [read, "Read a.ts"],
      [search, "Find tokens"],
      [edit, "Edit a.ts"],
    ] as const) {
      expect(toolOutputDisclosure(block, label, shown("contents"))).toBe(
        undefined,
      );
    }
  });

  it("has nothing to open with no output, an echo of the call, or a pending approval", () => {
    const command = tool("npm test", { kind: "execute", status: "completed" });
    expect(toolOutputDisclosure(command, "npm test", shown("  "))).toBe(
      undefined,
    );
    expect(toolOutputDisclosure(command, "npm test", shown("npm test"))).toBe(
      undefined,
    );
    const waiting = tool(
      "rm -rf dist",
      { kind: "execute", status: "pending", detail: "rm -rf dist?" },
      { approval: { requestId: 1 } },
    );
    expect(
      toolOutputDisclosure(waiting, "rm -rf dist", shown("rm -rf dist?")),
    ).toBe(undefined);
  });
});

describe("plainToolOutput", () => {
  it("drops colours, cursor moves and hyperlinks", () => {
    expect(
      plainToolOutput(
        "\u001b[32m✓\u001b[39m 12 passed \u001b[2K\u001b]8;;https://x.dev\u0007docs\u001b]8;;\u0007",
      ),
    ).toBe("✓ 12 passed docs");
  });

  it("keeps the last frame of a line a progress bar redrew", () => {
    expect(
      plainToolOutput("Downloading 10%\rDownloading 80%\rDone\nnext"),
    ).toBe("Done\nnext");
    expect(plainToolOutput("line one\r\nline two\r")).toBe(
      "line one\nline two",
    );
  });

  it("leaves ordinary output alone", () => {
    const text = "a\n  b\n\nc";
    expect(plainToolOutput(text)).toBe(text);
  });
});
