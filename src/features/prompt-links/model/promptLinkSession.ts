import { invoke } from "@tauri-apps/api/core";
import { copyText } from "../../../platform/tauri/clipboard";
import { projectName } from "../../../shared/lib/paths";
import { isLocalProject, looksLikeProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
  resolveModel,
} from "../../sessions/model/models";
import { getComposerDraft } from "../../sessions/model/draftCache";
import { loadProjectProviderSettings } from "../../sessions/model/projectProviders";
import {
  HARNESSES,
  HARNESS_TITLE,
  newSession,
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../sessions/model/session";
import { showPromptLinkNotice } from "./promptLinkNotice";
import {
  buildPromptLink,
  parsePromptLinkProject,
  remoteRepositoryPath,
  type PromptLink,
  type PromptLinkProject,
  type PromptLinkProjectCandidate,
  type PromptLinkResult,
} from "./promptLinks";

/** A new session in `cwd` with `prompt` waiting, unsent, in its composer. */
export type PromptLinkLaunch = {
  cwd: string;
  harness: HarnessId;
  model: string;
  prompt: string;
};

export type PromptLinkChoice = {
  harness: HarnessId;
  model: string;
  /** Why the session differs from what the link asked for. */
  notes: string[];
};

/** Onmicode's id for an agent a link names, by id or product name. */
export function promptLinkHarness(agent: string): HarnessId | null {
  const slug = (value: string) => value.toLowerCase().replace(/\s+/g, "-");
  const wanted = slug(agent);
  return (
    HARNESSES.find(
      (id) => id === wanted || slug(HARNESS_TITLE[id]) === wanted,
    ) ?? null
  );
}

/** The model a project starts `harness` with, as `defaultSessionChoice` does. */
function projectModel(cwd: string, harness: HarnessId): string {
  const project = loadProjectProviderSettings(cwd);
  return (
    project.models?.[harness] ??
    (project.defaultHarness === harness ? project.defaultModel : undefined) ??
    preferredModelId(harness)
  );
}

/** Links carry a model without Onmicode's `agent:` prefix. */
function catalogModel(harness: HarnessId, requested: string) {
  const wanted = requested.toLowerCase();
  return modelsFor(harness).find((model) => {
    const id = model.id.toLowerCase();
    return (
      id === wanted ||
      id === `${harness}:${wanted}` ||
      model.nativeId?.toLowerCase() === wanted
    );
  });
}

/**
 * The agent and model a link's session starts with in `cwd`. Anything the link
 * asks for that this project cannot run falls back to its defaults, with a
 * note saying so.
 */
export function promptLinkChoice(
  link: Pick<PromptLink, "agent" | "model">,
  cwd: string,
): PromptLinkChoice {
  const fallback = (note?: string): PromptLinkChoice => {
    const choice = defaultSessionChoice(cwd);
    return {
      harness: choice.harness,
      model: resolveModel(choice.harness, choice.model).id,
      notes: note ? [note] : [],
    };
  };
  if (!link.agent) return fallback();
  const harness = promptLinkHarness(link.agent);
  if (!harness)
    return fallback(
      `The link asks for “${link.agent}”, which Onmicode does not know, so your default agent is used.`,
    );
  if (firstEnabledHarness(cwd, harness) !== harness)
    return fallback(
      `The link asks for ${HARNESS_TITLE[harness]}, which is not available in this project, so your default agent is used.`,
    );
  const requested = link.model ? catalogModel(harness, link.model) : undefined;
  return {
    harness,
    model: requested?.id ?? resolveModel(harness, projectModel(cwd, harness)).id,
    notes:
      link.model && !requested
        ? [
            `The link asks for the model “${link.model}”, which ${HARNESS_TITLE[harness]} does not offer here, so its default model is used.`,
          ]
        : [],
  };
}

/** The session a reviewed link opens, its prompt waiting in the composer. */
export function sessionForPromptLink(
  launch: PromptLinkLaunch,
  runtimeMode?: RuntimeMode,
): Session {
  return {
    ...newSession(launch.harness, launch.cwd, launch.model, runtimeMode),
    composerSeed: launch.prompt,
  };
}

/** Remote URLs of each local project, origin first. */
function projectRemotes(paths: string[]): Promise<string[][]> {
  return invoke<string[][]>("prompt_link_remotes", { paths });
}

/** Projects a link may point at, with their remotes. Order is preserved. */
export async function promptLinkCandidates(
  paths: readonly string[],
): Promise<PromptLinkProjectCandidate[]> {
  const local = paths.filter(isLocalProject);
  const remotes = local.length
    ? await projectRemotes(local).catch(() => local.map(() => []))
    : [];
  const byPath = new Map(local.map((path, index) => [path, remotes[index]]));
  return paths.map((path) => ({
    path,
    name: projectName(path),
    remotes: (byPath.get(path) ?? []).flatMap((url) => {
      const repository = remoteRepositoryPath(url);
      return repository ? [repository] : [];
    }),
  }));
}

/** How a project is named in a shared link: its remote, else its folder. */
async function projectHint(cwd: string): Promise<PromptLinkProject | null> {
  if (!looksLikeProject(cwd)) return null;
  if (isLocalProject(cwd)) {
    const [urls = []] = await projectRemotes([cwd]).catch(() => []);
    for (const url of urls) {
      const repository = remoteRepositoryPath(url);
      const project = repository ? parsePromptLinkProject(repository) : null;
      if (project) return project;
    }
  }
  return parsePromptLinkProject(projectName(cwd));
}

export type PromptLinkDraft = {
  prompt: string;
  cwd: string;
  harness: HarnessId;
  model: string;
};

/**
 * A link for a composer draft. With context it also names the project, agent
 * and model; a project's name can be private, so that is a separate choice.
 */
export async function promptLinkForDraft(
  draft: PromptLinkDraft,
  withContext: boolean,
): Promise<PromptLinkResult<string>> {
  if (!withContext) return buildPromptLink({ prompt: draft.prompt });
  const prefix = `${draft.harness}:`;
  return buildPromptLink({
    prompt: draft.prompt,
    project: await projectHint(draft.cwd),
    agent: draft.harness,
    model: draft.model.startsWith(prefix)
      ? draft.model.slice(prefix.length)
      : draft.model,
  });
}

export async function copyPromptLink(
  draft: PromptLinkDraft,
  withContext = false,
): Promise<void> {
  const link = await promptLinkForDraft(draft, withContext);
  if (!link.ok) {
    showPromptLinkNotice({ kind: "error", text: link.error });
    return;
  }
  try {
    await copyText(link.value);
    showPromptLinkNotice({
      kind: "success",
      text: withContext
        ? "Prompt link with project and model copied"
        : "Prompt link copied",
    });
  } catch {
    showPromptLinkNotice({
      kind: "error",
      text: "Onmicode could not copy the link.",
    });
  }
}

/** Copies a link for whatever is typed in a session's composer. */
export function copySessionPromptLink(
  session: Pick<Session, "id" | "cwd" | "harness" | "model"> | undefined,
  withContext = false,
): Promise<void> {
  return copyPromptLink(
    {
      prompt: session ? (getComposerDraft(session.id) ?? "") : "",
      cwd: session?.cwd ?? "",
      harness: session?.harness ?? "claude",
      model: session?.model ?? "",
    },
    withContext,
  );
}
