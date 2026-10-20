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

const blocks: Block[] = [
  { id: "u1", role: "user", text: "Tidy the header" },
  {
    id: "t1",
    role: "tool",
    text: "Read header.tsx",
    tool: { callId: "c1", kind: "read", status: "completed" },
  },
  {
    id: "q1",
    role: "question",
    text: "Which layout?\nGrid\nAttached: sketch.png",
    answeredQuestions: [
      {
        id: "layout",
        prompt: "Which layout?",
        answers: ["Grid"],
        attachments: [
          {
            id: "sketch",
            name: "sketch.png",
            mimeType: "image/png",
            kind: "image",
            size: 4,
            path: "/tmp/sketch.png",
          },
        ],
      },
    ],
  },
  {
    id: "t2",
    role: "tool",
    text: "Edit header.tsx",
    tool: { callId: "c2", kind: "edit", status: "completed" },
  },
  { id: "a1", role: "assistant", text: "Switched the header to a grid." },
];

describe("answered questions in the transcript", () => {
  it("shows the answer and its files where the agent asked", () => {
    act(() => root.render(createElement(AgentTranscript, { blocks })));
    const answer = container.querySelector('[aria-label="Your answer"]');
    expect(answer?.textContent).toContain("Which layout?");
    expect(answer?.textContent).toContain("Grid");
    const files = answer?.querySelector('[aria-label="Attached files"]');
    expect(files?.textContent).toContain("sketch.png");
    expect(files?.querySelector('[title="/tmp/sketch.png"]')).not.toBeNull();
    // A finished file stays a file: nothing here removes it.
    expect(answer?.querySelector('[aria-label^="Remove "]')).toBeNull();
  });
});
