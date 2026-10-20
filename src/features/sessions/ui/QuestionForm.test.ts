// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { QuestionForm } from "./QuestionForm";
import type {
  UserQuestionPrompt,
  UserQuestionReply,
} from "../model/userQuestion";

const { invoke, listen, pickFiles } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  pickFiles: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: listen }),
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  pickFiles,
}));

let container: HTMLDivElement;
let root: Root;
let dropHandlers: Set<(event: { payload: DragDropEvent }) => void>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dropHandlers = new Set();
  listen.mockReset();
  listen.mockImplementation(async (handler) => {
    dropHandlers.add(handler);
    return () => dropHandlers.delete(handler);
  });
  pickFiles.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { paths?: string[]; name?: string }) => {
      if (command === "inspect_paths")
        return (args?.paths ?? []).map((path) => ({
          path,
          name: path.split("/").pop() ?? path,
          size: 4,
          isDir: false,
        }));
      if (command === "read_file_base64") return "aW1n";
      if (command === "write_attachment") return `/tmp/answers/${args?.name}`;
      if (command === "clipboard_file_paths") return [];
      return [];
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

function prompt(multiSelect = false): UserQuestionPrompt {
  return {
    requestId: 7,
    questions: [
      {
        id: "colour",
        prompt: "Pick a colour",
        multiSelect,
        allowCustom: false,
        options: [
          { id: "red", label: "Red" },
          { id: "green", label: "Green" },
          { id: "blue", label: "Blue" },
        ],
      },
    ],
  };
}

function renderQuestion(
  onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  multiSelect = false,
) {
  act(() =>
    root.render(
      createElement(QuestionForm, {
        prompt: prompt(multiSelect),
        onReply,
      }),
    ),
  );
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  );
}

function keyDown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("QuestionForm keyboard navigation", () => {
  it("moves the highlighted option with arrow keys and selects it with Enter", () => {
    const onReply = vi.fn();
    const options = renderQuestion(onReply);

    expect(options[0].tabIndex).toBe(0);
    expect(options[1].tabIndex).toBe(-1);
    act(() => options[0].focus());

    keyDown(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].dataset.highlighted).toBe("true");
    expect(options[1].tabIndex).toBe(0);

    keyDown(options[1], "Enter");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"] },
    });
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "ArrowUp");
    expect(document.activeElement).toBe(options[2]);

    keyDown(options[2], "Home");
    expect(document.activeElement).toBe(options[0]);

    keyDown(options[0], "End");
    expect(document.activeElement).toBe(options[2]);
  });

  it("uses number keys to focus and select the matching option", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "3");

    expect(document.activeElement).toBe(options[2]);
    expect(options[2].getAttribute("aria-pressed")).toBe("true");
    expect(options[2].getAttribute("aria-keyshortcuts")).toBe("3");
  });

  it("toggles highlighted options for multi-select questions", () => {
    const options = renderQuestion(vi.fn(), true);
    act(() => options[0].focus());

    keyDown(options[0], "Enter");
    keyDown(options[0], "ArrowDown");
    keyDown(options[1], " ");

    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    keyDown(options[1], " ");
    expect(options[1].getAttribute("aria-pressed")).toBe("false");
  });
});

describe("QuestionForm steps", () => {
  function twoQuestions(): UserQuestionPrompt {
    return {
      requestId: 9,
      questions: [
        {
          id: "colour",
          prompt: "Pick a colour",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "red", label: "Red" },
            { id: "green", label: "Green" },
          ],
        },
        {
          id: "size",
          prompt: "Pick a size",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
      ],
    };
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === label,
    );
    if (!match) throw new Error(`No button labelled ${label}`);
    return match;
  }

  it("returns to the previous question with its answer and submits the change", () => {
    const onReply = vi.fn();
    act(() =>
      root.render(createElement(QuestionForm, { prompt: twoQuestions(), onReply })),
    );
    expect(container.textContent).not.toContain("Back");

    act(() => button("Red").click());
    act(() => button("Continue").click());
    expect(container.textContent).toContain("Pick a size");

    act(() => button("Back").click());
    expect(container.textContent).toContain("Pick a colour");
    expect(button("Red").getAttribute("aria-pressed")).toBe("true");

    act(() => button("Green").click());
    act(() => button("Continue").click());
    act(() => button("Large").click());
    act(() => button("Continue").click());

    expect(onReply).toHaveBeenCalledWith(9, {
      kind: "answered",
      answers: { colour: ["green"], size: ["large"] },
    });
  });
});

describe("QuestionForm attachments", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  function openQuestion(): UserQuestionPrompt {
    return {
      requestId: 11,
      questions: [
        {
          id: "change",
          prompt: "What should change?",
          multiSelect: false,
          allowCustom: true,
          options: [{ id: "layout", label: "Layout" }],
        },
      ],
    };
  }

  function renderForm(
    question: UserQuestionPrompt,
    attachments: boolean,
    onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  ) {
    act(() =>
      root.render(
        createElement(QuestionForm, { prompt: question, onReply, attachments }),
      ),
    );
  }

  function attachButton() {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label="Attach files to your answer"]',
    );
  }

  function chipNames() {
    return Array.from(
      container.querySelectorAll('[aria-label^="Remove "]'),
      (button) => button.getAttribute("aria-label")!.slice("Remove ".length),
    );
  }

  function continueButton() {
    return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  }

  /** Reads cross IPC hops and a FileReader, so they need real macrotasks. */
  async function settleUntil(check: () => boolean, what: string) {
    for (let waited = 0; waited < 2000; waited += 10) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      if (check()) return;
    }
    throw new Error(`Timed out waiting for ${what}.`);
  }

  it("offers files only when the harness and the question can take them", () => {
    renderForm(prompt(), true);
    expect(attachButton()).toBeNull();
    renderForm(openQuestion(), false);
    expect(attachButton()).toBeNull();
    renderForm(openQuestion(), true);
    expect(attachButton()).not.toBeNull();
    expect(
      container.querySelector("form")!.hasAttribute("data-file-drop-zone"),
    ).toBe(true);
  });

  it("answers with picked files alone and keeps focus on Attach after a removal", async () => {
    const onReply = vi.fn();
    pickFiles.mockResolvedValue(["/repo/spec.pdf", "/repo/mock.png"]);
    renderForm(openQuestion(), true, onReply);
    expect(continueButton().disabled).toBe(true);

    act(() => attachButton()!.click());
    await settleUntil(() => chipNames().length === 2, "two chips");
    expect(continueButton().disabled).toBe(false);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Remove spec.pdf"]')!
        .click(),
    );
    expect(chipNames()).toEqual(["mock.png"]);
    expect(document.activeElement).toBe(attachButton());

    act(() => continueButton().click());
    expect(onReply).toHaveBeenCalledWith(11, {
      kind: "answered",
      answers: {},
      attachments: {
        change: [
          expect.objectContaining({
            name: "mock.png",
            path: "/repo/mock.png",
            data: "aW1n",
          }),
        ],
      },
    });
  });

  it("saves a pasted image to disk so the answer can name its path", async () => {
    const onReply = vi.fn();
    renderForm(openQuestion(), true, onReply);
    const option = container.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    )!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: () => "",
        files: [new File([PNG], "image.png", { type: "image/png" })],
        items: [],
      },
    });
    act(() => {
      option.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await settleUntil(() => chipNames().length === 1, "the pasted image");

    expect(invoke).toHaveBeenCalledWith("write_attachment", {
      name: "image.png",
      data: expect.any(String),
    });
    act(() => option.click());
    act(() => continueButton().click());
    expect(onReply).toHaveBeenCalledWith(11, {
      kind: "answered",
      answers: { change: ["layout"] },
      attachments: {
        change: [
          expect.objectContaining({
            name: "image.png",
            kind: "image",
            path: "/tmp/answers/image.png",
          }),
        ],
      },
    });
  });

  it("attaches files dropped on the question", async () => {
    renderForm(openQuestion(), true);
    const form = container.querySelector("form")!;
    form.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 300, bottom: 120 }) as DOMRect;
    await act(async () => {
      for (const handler of dropHandlers)
        handler({
          payload: {
            type: "over",
            position: { x: 20, y: 20 },
          } as DragDropEvent,
        });
    });
    expect(container.textContent).toContain(
      "Drop files to attach to your answer",
    );
    await act(async () => {
      for (const handler of dropHandlers)
        handler({
          payload: {
            type: "drop",
            paths: ["/repo/notes.md"],
            position: { x: 20, y: 20 },
          } as DragDropEvent,
        });
    });
    await settleUntil(() => chipNames().length === 1, "the dropped file");
    expect(chipNames()).toEqual(["notes.md"]);
    expect(container.textContent).not.toContain(
      "Drop files to attach to your answer",
    );
  });
});
