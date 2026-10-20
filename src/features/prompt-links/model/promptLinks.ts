/**
 * `onmicode://new?prompt=…` links open a new session with a prompt waiting in
 * its composer. A link never sends anything: the window shows what it carries
 * and the user decides.
 *
 * - `prompt`: required, at most PROMPT_LINK_MAX_PROMPT_LENGTH characters
 * - `project`: optional folder name, `owner/name`, or a git remote URL
 * - `agent`: optional provider id, such as `claude` or `codex`
 * - `model`: optional model for that agent
 */

export const PROMPT_LINK_SCHEME = "onmicode";
export const PROMPT_LINK_MAX_PROMPT_LENGTH = 8_000;
/** Windows hands a link to the app on a command line of 32,767 characters. */
export const PROMPT_LINK_MAX_URL_LENGTH = 30_000;

export type LinkedPrompt = {
  text: string;
  /** Characters removed because they render as nothing. */
  hiddenCharacters: number;
};

export type PromptLinkProject = {
  /** Owner or group path, when the link named a repository. */
  owner?: string;
  /** Repository or folder name. */
  name: string;
};

export type PromptLink = {
  prompt: LinkedPrompt;
  project: PromptLinkProject | null;
  agent: string | null;
  /** Only kept alongside an agent; a model id means nothing on its own. */
  model: string | null;
};

export type PromptLinkResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

// Hidden-character sanitizing is adapted from T3 Code (MIT, see NOTICE).
// Zero-width and bidi controls, tag and variation-selector blocks, and other
// characters that render as nothing. A model reads them; the person checking
// the draft cannot see them, which makes them the usual way to hide
// instructions in a prompt.
const HIDDEN_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF0-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;

/** Pictographs, symbols, skin tones, and the emoji presentation selector. */
const isEmojiPart = (codePoint: number | undefined) =>
  codePoint !== undefined &&
  ((codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2190 && codePoint <= 0x2bff) ||
    codePoint === 0xfe0f);

/**
 * The visible text of a prompt and how many hidden characters were removed.
 * A zero-width joiner survives only inside an emoji sequence.
 */
export function sanitizeLinkedPrompt(raw: string): LinkedPrompt {
  let hiddenCharacters = 0;
  const visible = Array.from(
    raw
      .replace(/\r\n?|[\u2028\u2029]/g, "\n")
      .replace(HIDDEN_CHARACTERS, () => {
        hiddenCharacters++;
        return "";
      }),
  );
  const text = visible
    .filter((character, index) => {
      if (character !== "\u200D") return true;
      const kept =
        isEmojiPart(visible[index - 1]?.codePointAt(0)) &&
        isEmojiPart(visible[index + 1]?.codePointAt(0));
      if (!kept) hiddenCharacters++;
      return kept;
    })
    .join("");
  return { text: text.trim(), hiddenCharacters };
}

const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const AGENT = /^[a-z0-9._ -]{1,40}$/;
const MODEL = /^[A-Za-z0-9._:/@+[\]-]{1,200}$/;

/**
 * `name`, `owner/name` (a group path may nest), an https or ssh remote URL, or
 * scp-style `git@host:owner/name.git`.
 */
export function parsePromptLinkProject(value: string): PromptLinkProject | null {
  let path = value.trim();
  const scp = /^[\w.-]+@[\w.-]+:(?!\/\/)(.+)$/.exec(path);
  if (scp) {
    path = scp[1];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const segments = path
    .replace(/\.git\/?$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length === 0 || segments.length > 3) return null;
  if (!segments.every((part) => SEGMENT.test(part) && !/^\.+$/.test(part)))
    return null;
  const name = segments.pop()!;
  return segments.length ? { owner: segments.join("/"), name } : { name };
}

export function formatPromptLinkProject(project: PromptLinkProject): string {
  return project.owner ? `${project.owner}/${project.name}` : project.name;
}

const optionalParam = (params: URLSearchParams, key: string) =>
  params.get(key)?.trim() || null;

/** Read a link, or say in plain words why Onmicode will not open it. */
export function parsePromptLink(value: string): PromptLinkResult<PromptLink> {
  // Parsed by hand: older webviews leave the host of a custom scheme empty.
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)\/?(\?[^#]*)?(?:#.*)?$/i.exec(
    value.trim(),
  );
  if (!match || match[1].toLowerCase() !== PROMPT_LINK_SCHEME)
    return fail("This is not an Onmicode link.");
  if (match[2].toLowerCase() !== "new")
    return fail("This link asks for something Onmicode cannot do.");
  const params = new URLSearchParams(match[3] ?? "");
  const raw = params.get("prompt");
  if (raw === null || !raw.trim()) return fail("This link has no prompt.");
  if (raw.length > PROMPT_LINK_MAX_PROMPT_LENGTH)
    return fail(
      `This prompt is longer than ${PROMPT_LINK_MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters, so Onmicode did not open it.`,
    );
  const prompt = sanitizeLinkedPrompt(raw);
  if (!prompt.text)
    return fail(
      prompt.hiddenCharacters > 0
        ? "This prompt had only hidden characters, so it may be malicious. Onmicode did not open it."
        : "This link has no prompt.",
    );
  const projectValue = optionalParam(params, "project");
  const project = projectValue ? parsePromptLinkProject(projectValue) : null;
  if (projectValue && !project)
    return fail("This link names a project Onmicode cannot read.");
  const agent = optionalParam(params, "agent")?.toLowerCase() ?? null;
  if (agent && !AGENT.test(agent))
    return fail("This link names an agent Onmicode cannot read.");
  const model = agent ? optionalParam(params, "model") : null;
  if (model && !MODEL.test(model))
    return fail("This link names a model Onmicode cannot read.");
  return { ok: true, value: { prompt, project, agent, model } };
}

/** A shareable link for a prompt, or why the prompt cannot travel in one. */
export function buildPromptLink(input: {
  prompt: string;
  project?: PromptLinkProject | null;
  agent?: string | null;
  model?: string | null;
}): PromptLinkResult<string> {
  // Hidden characters would only make the link look malicious when opened.
  const prompt = sanitizeLinkedPrompt(input.prompt).text;
  if (!prompt) return fail("Write a prompt first.");
  if (prompt.length > PROMPT_LINK_MAX_PROMPT_LENGTH)
    return fail(
      `Prompt links hold up to ${PROMPT_LINK_MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters.`,
    );
  const params = new URLSearchParams({ prompt });
  if (input.project)
    params.set("project", formatPromptLinkProject(input.project));
  if (input.agent) {
    params.set("agent", input.agent);
    if (input.model && MODEL.test(input.model))
      params.set("model", input.model);
  }
  const link = `${PROMPT_LINK_SCHEME}://new?${params}`;
  if (link.length > PROMPT_LINK_MAX_URL_LENGTH)
    return fail("This prompt is too long to fit in a link.");
  return { ok: true, value: link };
}

/** `owner/name` of a git remote URL, or null for a local path. */
export function remoteRepositoryPath(url: string): string | null {
  const trimmed = url.trim();
  const scp = /^[\w.-]+@[\w.-]+:(?!\/\/)(.+)$/.exec(trimmed);
  let path: string;
  if (scp) {
    path = scp[1];
  } else {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "file:") return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  const segments = path
    .replace(/\.git\/?$/i, "")
    .split("/")
    .filter(Boolean);
  return segments.length >= 2 ? segments.join("/") : null;
}

export type PromptLinkProjectCandidate = {
  path: string;
  /** Folder name of the project. */
  name: string;
  /** `owner/name` paths of the project's remotes. */
  remotes: readonly string[];
};

/**
 * The project a link points at. A remote with the same owner and name wins,
 * then a remote with the same name (a fork or mirror), then a folder with the
 * same name. Candidates come most recent first, so ties go to recent work.
 */
export function matchPromptLinkProject(
  hint: PromptLinkProject,
  candidates: readonly PromptLinkProjectCandidate[],
): string | null {
  const name = hint.name.toLowerCase();
  const full = hint.owner ? formatPromptLinkProject(hint).toLowerCase() : null;
  const remotes = (candidate: PromptLinkProjectCandidate) =>
    candidate.remotes.map((remote) => remote.toLowerCase());
  const remoteName = (remote: string) =>
    remote.slice(remote.lastIndexOf("/") + 1);
  const match =
    (full &&
      candidates.find((candidate) => remotes(candidate).includes(full))) ||
    candidates.find((candidate) =>
      remotes(candidate).some((remote) => remoteName(remote) === name),
    ) ||
    candidates.find((candidate) => candidate.name.toLowerCase() === name);
  return match ? match.path : null;
}

/** A leading slash command runs as that command when the prompt is sent. */
export function leadingSlashCommand(text: string): string | null {
  return /^\/([\w:-]+)(?=\s|$)/.exec(text)?.[1] ?? null;
}
