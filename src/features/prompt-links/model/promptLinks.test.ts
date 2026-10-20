import { describe, expect, it } from "vitest";
import {
  buildPromptLink,
  leadingSlashCommand,
  matchPromptLinkProject,
  parsePromptLink,
  parsePromptLinkProject,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
  remoteRepositoryPath,
  sanitizeLinkedPrompt,
  type PromptLinkProjectCandidate,
} from "./promptLinks";

const char = (codePoint: number) => String.fromCodePoint(codePoint);
const ZERO_WIDTH_SPACE = char(0x200b);
const ZERO_WIDTH_JOINER = char(0x200d);
const RIGHT_TO_LEFT_OVERRIDE = char(0x202e);
const TAG_A = char(0xe0041);

const link = (params: Record<string, string>) =>
  `onmicode://new?${new URLSearchParams(params)}`;

describe("sanitizeLinkedPrompt", () => {
  it("keeps ordinary text, tabs and newlines", () => {
    expect(sanitizeLinkedPrompt("  Fix the\ttests\r\nplease  ")).toEqual({
      text: "Fix the\ttests\nplease",
      hiddenCharacters: 0,
    });
  });

  it("removes and counts zero-width, bidi and tag characters", () => {
    expect(
      sanitizeLinkedPrompt(
        `Re${ZERO_WIDTH_SPACE}view${RIGHT_TO_LEFT_OVERRIDE} this${TAG_A}${TAG_A}`,
      ),
    ).toEqual({ text: "Review this", hiddenCharacters: 4 });
  });

  it("keeps a joiner inside an emoji sequence and drops a stray one", () => {
    const family = `${char(0x1f468)}${ZERO_WIDTH_JOINER}${char(0x1f469)}`;
    expect(sanitizeLinkedPrompt(`${family} a${ZERO_WIDTH_JOINER}b`)).toEqual({
      text: `${family} ab`,
      hiddenCharacters: 1,
    });
  });

  it("normalizes line and paragraph separators to newlines", () => {
    expect(sanitizeLinkedPrompt(`one${char(0x2028)}two`).text).toBe("one\ntwo");
  });
});

describe("parsePromptLink", () => {
  it("reads a prompt with its project, agent and model", () => {
    expect(
      parsePromptLink(
        link({
          prompt: "Add a dark mode",
          project: "pingdotgg/t3code",
          agent: "Claude",
          model: "opus-5-5",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        prompt: { text: "Add a dark mode", hiddenCharacters: 0 },
        project: { owner: "pingdotgg", name: "t3code" },
        agent: "claude",
        model: "opus-5-5",
      },
    });
  });

  it("accepts a trailing slash and a differently cased scheme", () => {
    const result = parsePromptLink("ONMICODE://new/?prompt=hello%20there");
    expect(result.ok && result.value.prompt.text).toBe("hello there");
  });

  it("drops a model that comes without an agent", () => {
    const result = parsePromptLink(link({ prompt: "hi", model: "gpt-6" }));
    expect(result.ok && result.value.model).toBeNull();
  });

  it("reports removed hidden characters", () => {
    const result = parsePromptLink(
      link({ prompt: `Delete${ZERO_WIDTH_SPACE} nothing` }),
    );
    expect(result.ok && result.value.prompt).toEqual({
      text: "Delete nothing",
      hiddenCharacters: 1,
    });
  });

  it.each([
    ["another scheme", "https://example.com/new?prompt=hi", "not an Onmicode link"],
    ["another action", "onmicode://run?prompt=hi", "cannot do"],
    ["no prompt", "onmicode://new?project=app", "has no prompt"],
    ["a blank prompt", link({ prompt: "   " }), "has no prompt"],
    ["only hidden characters", link({ prompt: ZERO_WIDTH_SPACE.repeat(3) }), "may be malicious"],
    ["a bad project", link({ prompt: "hi", project: "a b" }), "project"],
    ["a bad agent", link({ prompt: "hi", agent: "<script>" }), "agent"],
    ["a bad model", link({ prompt: "hi", agent: "codex", model: "a b" }), "model"],
    ["not a URL", "prompt=hi", "not an Onmicode link"],
  ])("rejects %s", (_, value, message) => {
    const result = parsePromptLink(value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });

  it("rejects a prompt over the length cap before reading it", () => {
    const result = parsePromptLink(
      link({ prompt: "x".repeat(PROMPT_LINK_MAX_PROMPT_LENGTH + 1) }),
    );
    expect(!result.ok && result.error).toContain("8,000 characters");
    expect(
      parsePromptLink(link({ prompt: "x".repeat(PROMPT_LINK_MAX_PROMPT_LENGTH) }))
        .ok,
    ).toBe(true);
  });
});

describe("parsePromptLinkProject", () => {
  it.each([
    ["onmicode", { name: "onmicode" }],
    ["andresutre/onmicode", { owner: "andresutre", name: "onmicode" }],
    ["group/sub/app", { owner: "group/sub", name: "app" }],
    ["https://github.com/andresutre/onmicode", { owner: "andresutre", name: "onmicode" }],
    ["https://github.com/andresutre/onmicode.git", { owner: "andresutre", name: "onmicode" }],
    ["git@github.com:andresutre/onmicode.git", { owner: "andresutre", name: "onmicode" }],
    ["ssh://git@gitlab.com:22/team/app.git", { owner: "team", name: "app" }],
  ])("reads %s", (value, expected) => {
    expect(parsePromptLinkProject(value)).toEqual(expected);
  });

  it.each(["", "..", "a/../b", "has space", "a/b/c/d", "https://"])(
    "rejects %j",
    (value) => {
      expect(parsePromptLinkProject(value)).toBeNull();
    },
  );
});

describe("buildPromptLink", () => {
  it("round-trips through the parser", () => {
    const built = buildPromptLink({
      prompt: "  Explain & fix #42 = 100%?\nThanks  ",
      project: { owner: "andresutre", name: "onmicode" },
      agent: "codex",
      model: "gpt-6",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.startsWith("onmicode://new?prompt=")).toBe(true);
    expect(parsePromptLink(built.value)).toEqual({
      ok: true,
      value: {
        prompt: { text: "Explain & fix #42 = 100%?\nThanks", hiddenCharacters: 0 },
        project: { owner: "andresutre", name: "onmicode" },
        agent: "codex",
        model: "gpt-6",
      },
    });
  });

  it("leaves out context that was not asked for", () => {
    const built = buildPromptLink({ prompt: "hi", model: "gpt-6" });
    expect(built).toEqual({ ok: true, value: "onmicode://new?prompt=hi" });
    // A model the parser would refuse is dropped rather than breaking the link.
    expect(
      buildPromptLink({ prompt: "hi", agent: "codex", model: "my model" }),
    ).toEqual({ ok: true, value: "onmicode://new?prompt=hi&agent=codex" });
  });

  it("accepts an agent written as its product name", () => {
    const result = parsePromptLink(link({ prompt: "hi", agent: "Claude Code" }));
    expect(result.ok && result.value.agent).toBe("claude code");
  });

  it("strips hidden characters from the shared prompt", () => {
    const built = buildPromptLink({ prompt: `hi${ZERO_WIDTH_SPACE}` });
    expect(built).toEqual({ ok: true, value: "onmicode://new?prompt=hi" });
  });

  it("refuses an empty or oversized prompt", () => {
    expect(buildPromptLink({ prompt: "  " }).ok).toBe(false);
    expect(
      buildPromptLink({ prompt: "x".repeat(PROMPT_LINK_MAX_PROMPT_LENGTH + 1) })
        .ok,
    ).toBe(false);
  });

  it("refuses a prompt whose encoded link would not fit a Windows command line", () => {
    // Each CJK character encodes to nine URL characters.
    const built = buildPromptLink({ prompt: char(0x4e2d).repeat(4_000) });
    expect(!built.ok && built.error).toContain("too long");
  });
});

describe("remoteRepositoryPath", () => {
  it.each([
    ["https://github.com/Andresutre/Onmicode.git", "Andresutre/Onmicode"],
    ["git@github.com:andresutre/onmicode.git", "andresutre/onmicode"],
    ["ssh://git@gitlab.com/group/sub/app.git", "group/sub/app"],
    ["https://dev.azure.com/org/project/_git/repo", "org/project/_git/repo"],
  ])("reads %s", (url, expected) => {
    expect(remoteRepositoryPath(url)).toBe(expected);
  });

  it.each(["/srv/git/app.git", "../app", "file:///srv/git/app.git", ""])(
    "ignores local remote %j",
    (url) => {
      expect(remoteRepositoryPath(url)).toBeNull();
    },
  );
});

describe("matchPromptLinkProject", () => {
  const candidates: PromptLinkProjectCandidate[] = [
    { path: "/work/scratch", name: "scratch", remotes: [] },
    { path: "/work/t3code", name: "t3code", remotes: ["andresutre/t3code"] },
    { path: "/work/upstream", name: "upstream", remotes: ["PingDotGG/T3Code"] },
    { path: "/work/notes", name: "Notes", remotes: [] },
  ];

  it("prefers a remote with the same owner and name", () => {
    expect(
      matchPromptLinkProject({ owner: "PingDotGG", name: "t3code" }, candidates),
    ).toBe("/work/upstream");
  });

  it("falls back to a remote with the same name, most recent first", () => {
    expect(
      matchPromptLinkProject({ owner: "someone", name: "t3code" }, candidates),
    ).toBe("/work/t3code");
  });

  it("matches a folder name without regard to case", () => {
    expect(matchPromptLinkProject({ name: "notes" }, candidates)).toBe(
      "/work/notes",
    );
  });

  it("returns null when nothing matches", () => {
    expect(matchPromptLinkProject({ name: "missing" }, candidates)).toBeNull();
  });
});

describe("leadingSlashCommand", () => {
  it("names a leading command", () => {
    expect(leadingSlashCommand("/operator open settings")).toBe("operator");
    expect(leadingSlashCommand("/plan")).toBe("plan");
  });

  it("ignores paths and later slashes", () => {
    expect(leadingSlashCommand("/usr/bin is missing")).toBeNull();
    expect(leadingSlashCommand("run /plan")).toBeNull();
  });
});
