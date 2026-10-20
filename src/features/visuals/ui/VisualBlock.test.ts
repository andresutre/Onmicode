// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(async (command: string, args?: { html?: string }) =>
    command === "visual_register" ? `page-${args?.html?.length}` : undefined,
  ),
  openUrl: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: tauri.invoke,
  convertFileSrc: (id: string) => `about:blank#${id}`,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));

import { PACED_REVEAL_KEY } from "../../sessions/ui/wordFade";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { saveVisualReplies } from "../../settings/model/displayPrefs";

const FENCE = '```html onmicode-visual title="Weekly commits"';
const PAGE = "<!doctype html><p>chart</p>";

describe("visuals in a reply", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Shows streamed text as it arrives, so each render is one token.
    localStorage.setItem(PACED_REVEAL_KEY, "0");
    tauri.invoke.mockClear();
    tauri.openUrl.mockClear();
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

  async function render(text: string, options: Record<string, unknown> = {}) {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, { text, visuals: true, ...options }),
      ),
    );
  }

  const frame = () =>
    container.querySelector<HTMLIFrameElement>("iframe[data-visual-frame]");
  const registered = () =>
    tauri.invoke.mock.calls.filter(
      ([command]) => command === "visual_register",
    );

  it("runs a marked fence in a sandboxed frame with no same-origin access", async () => {
    await render(`Here it is.\n\n${FENCE}\n${PAGE}\n\`\`\`\n`);
    const iframe = frame();
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe!.getAttribute("title")).toBe("Weekly commits");
    expect(iframe!.getAttribute("src")).toMatch(/^about:blank#page-/);
    expect(container.querySelector("pre")).toBeNull();

    const [[, args]] = registered() as unknown as [[string, { html: string }]];
    expect(args.html).toContain(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';',
    );
    expect(args.html).toContain("<p>chart</p>");
  });

  it("keeps plain HTML fences, other surfaces and the off setting as code", async () => {
    await render("```html\n<p>plain</p>\n```\n");
    expect(frame()).toBeNull();
    expect(container.textContent).toContain("<p>plain</p>");

    await render(`${FENCE}\n${PAGE}\n\`\`\`\n`, { visuals: false });
    expect(frame()).toBeNull();
    expect(container.querySelector('[data-language="html"]')).not.toBeNull();

    await act(async () => saveVisualReplies(false));
    await render(`${FENCE}\n${PAGE}\n\`\`\`\n`);
    expect(frame()).toBeNull();
    expect(registered()).toHaveLength(0);
  });

  it("shows a placeholder while the fence streams and keeps one frame after it closes", async () => {
    let text = `Here it is.\n\n${FENCE}\n<!doctype html>`;
    await render(text, { streaming: true });
    expect(
      container.querySelector("[data-visual-placeholder]")?.textContent,
    ).toBe("Drawing Weekly commits…");
    expect(frame()).toBeNull();

    for (const token of ["<p>", "chart", "</p>"]) {
      text += token;
      await render(text, { streaming: true });
      expect(frame()).toBeNull();
    }

    // A trailing partial word is held back briefly, so close with a newline.
    text += "\n```\n";
    await render(text, { streaming: true });
    const mounted = frame();
    expect(mounted).not.toBeNull();

    for (const token of ["\nIt ", "shows ", "a ", "steady ", "week."]) {
      text += token;
      await render(text, { streaming: true });
      expect(frame()).toBe(mounted);
    }
    await render(text, { streaming: false });
    expect(frame()).toBe(mounted);
    expect(registered()).toHaveLength(1);
  });

  it("fits the page's reported height, only from its own frame", async () => {
    await render(`${FENCE}\n${PAGE}\n\`\`\`\n`);
    const iframe = frame()!;
    const post = async (data: unknown, source: unknown) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", { data, source: source as Window }),
        );
      });

    await post(
      { type: "onmicode:visual-height", height: 431.2 },
      iframe.contentWindow,
    );
    expect(iframe.style.height).toBe("432px");

    await post({ type: "onmicode:visual-height", height: 900 }, window);
    expect(iframe.style.height).toBe("432px");

    await post(
      { type: "onmicode:visual-height", height: 50_000 },
      iframe.contentWindow,
    );
    expect(iframe.style.height).toBe("2000px");
  });

  it("opens a page's web link only while the reader is in the frame", async () => {
    await render(`${FENCE}\n${PAGE}\n\`\`\`\n`);
    const iframe = frame()!;
    const link = { type: "onmicode:visual-link", url: "https://example.com/" };
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: link,
          source: iframe.contentWindow as Window,
        }),
      );
    });
    expect(tauri.openUrl).not.toHaveBeenCalled();

    iframe.tabIndex = 0;
    iframe.focus();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: link,
          source: iframe.contentWindow as Window,
        }),
      );
    });
    expect(tauri.openUrl).toHaveBeenCalledWith("https://example.com/");
  });

  it("shows the page's code on request", async () => {
    await render(`${FENCE}\n${PAGE}\n\`\`\`\n`);
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show code"]',
    )!;
    await act(async () => toggle.click());
    expect(frame()).toBeNull();
    expect(container.querySelector('[data-language="html"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Show visual"]'),
    ).not.toBeNull();
  });
});
