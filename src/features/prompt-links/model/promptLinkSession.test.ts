import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const copyText = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText }));

import { setComposerDraft } from "../../sessions/model/draftCache";
import { setProjectProviderHidden } from "../../sessions/model/projectProviders";
import {
  currentPromptLinkNotice,
  dismissPromptLinkNotice,
} from "./promptLinkNotice";
import { parsePromptLink } from "./promptLinks";
import {
  copySessionPromptLink,
  promptLinkCandidates,
  promptLinkChoice,
  promptLinkForDraft,
  promptLinkHarness,
  sessionForPromptLink,
} from "./promptLinkSession";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  invoke.mockReset();
  copyText.mockReset();
});

afterEach(() => {
  const notice = currentPromptLinkNotice();
  if (notice) dismissPromptLinkNotice(notice.id);
  vi.unstubAllGlobals();
});

describe("promptLinkHarness", () => {
  it.each([
    ["claude", "claude"],
    ["claude-code", "claude"],
    ["Claude Code", "claude"],
    ["grok-build", "grok"],
    ["codex", "codex"],
    ["gemini", null],
  ])("reads %s", (agent, expected) => {
    expect(promptLinkHarness(agent)).toBe(expected);
  });
});

describe("promptLinkChoice", () => {
  it("uses the project's defaults when the link names no agent", () => {
    const choice = promptLinkChoice({ agent: null, model: null }, "/repo/a");
    expect(choice.notes).toEqual([]);
  });

  it("uses the requested agent and model when this project has them", () => {
    expect(
      promptLinkChoice({ agent: "claude", model: "opus-5" }, "/repo/a"),
    ).toEqual({ harness: "claude", model: "claude:opus-5", notes: [] });
    expect(
      promptLinkChoice({ agent: "claude", model: "claude-opus-5" }, "/repo/a")
        .model,
    ).toBe("claude:opus-5");
  });

  it("keeps the agent but explains a model it does not offer", () => {
    const choice = promptLinkChoice(
      { agent: "claude", model: "opus-9" },
      "/repo/a",
    );
    expect(choice.harness).toBe("claude");
    expect(choice.model).not.toBe("claude:opus-9");
    expect(choice.notes[0]).toContain("“opus-9”");
  });

  it("falls back with a note for an unknown or hidden agent", () => {
    expect(
      promptLinkChoice({ agent: "gemini", model: null }, "/repo/a").notes[0],
    ).toContain("does not know");
    setProjectProviderHidden("/repo/a", "claude", true);
    const hidden = promptLinkChoice({ agent: "claude", model: null }, "/repo/a");
    expect(hidden.harness).not.toBe("claude");
    expect(hidden.notes[0]).toContain("not available in this project");
  });
});

describe("sessionForPromptLink", () => {
  it("opens a new session with the prompt waiting in its composer", () => {
    const session = sessionForPromptLink(
      {
        cwd: "/repo/a",
        harness: "claude",
        model: "claude:opus-5",
        prompt: "Fix the build",
      },
      "supervised",
    );
    expect(session).toMatchObject({
      cwd: "/repo/a",
      harness: "claude",
      model: "claude:opus-5",
      runtimeMode: "supervised",
      composerSeed: "Fix the build",
      blocks: [],
    });
  });
});

describe("promptLinkCandidates", () => {
  it("reads the remotes of local projects only, keeping the order", async () => {
    invoke.mockResolvedValue([
      ["git@github.com:Me/App.git", "/srv/mirror.git"],
      [],
    ]);
    const candidates = await promptLinkCandidates([
      "/work/app",
      "remote://host/work/other",
      "/work/notes",
    ]);
    expect(invoke).toHaveBeenCalledWith("prompt_link_remotes", {
      paths: ["/work/app", "/work/notes"],
    });
    expect(candidates).toEqual([
      { path: "/work/app", name: "app", remotes: ["Me/App"] },
      { path: "remote://host/work/other", name: "other", remotes: [] },
      { path: "/work/notes", name: "notes", remotes: [] },
    ]);
  });

  it("still matches by folder when the lookup fails", async () => {
    invoke.mockRejectedValue(new Error("git missing"));
    expect(await promptLinkCandidates(["/work/app"])).toEqual([
      { path: "/work/app", name: "app", remotes: [] },
    ]);
  });
});

describe("promptLinkForDraft", () => {
  const draft = {
    prompt: "Add tests",
    cwd: "/work/app",
    harness: "claude" as const,
    model: "claude:opus-5",
  };

  it("shares only the prompt by default", async () => {
    expect(await promptLinkForDraft(draft, false)).toEqual({
      ok: true,
      value: "onmicode://new?prompt=Add+tests",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("names the project by its remote, with the agent and model", async () => {
    invoke.mockResolvedValue([["https://github.com/andresutre/onmicode.git"]]);
    const link = await promptLinkForDraft(draft, true);
    expect(link.ok && parsePromptLink(link.value)).toEqual({
      ok: true,
      value: {
        prompt: { text: "Add tests", hiddenCharacters: 0 },
        project: { owner: "andresutre", name: "onmicode" },
        agent: "claude",
        model: "opus-5",
      },
    });
  });

  it("falls back to the folder name without a remote", async () => {
    invoke.mockResolvedValue([[]]);
    const link = await promptLinkForDraft(draft, true);
    expect(link.ok && parsePromptLink(link.value)).toMatchObject({
      ok: true,
      value: { project: { name: "app" } },
    });
  });
});

describe("copySessionPromptLink", () => {
  const session = {
    id: "session-1",
    cwd: "/work/app",
    harness: "claude" as const,
    model: "claude:opus-5",
  };

  it("copies the composer draft and reports it", async () => {
    setComposerDraft(session.id, "Review this diff");
    copyText.mockResolvedValue(undefined);
    await copySessionPromptLink(session);
    expect(copyText).toHaveBeenCalledWith(
      "onmicode://new?prompt=Review+this+diff",
    );
    expect(currentPromptLinkNotice()).toMatchObject({
      kind: "success",
      text: "Prompt link copied",
    });
  });

  it("explains an empty composer instead of copying", async () => {
    setComposerDraft(session.id, "");
    await copySessionPromptLink(session);
    expect(copyText).not.toHaveBeenCalled();
    expect(currentPromptLinkNotice()).toMatchObject({
      kind: "error",
      text: "Write a prompt first.",
    });
  });
});
