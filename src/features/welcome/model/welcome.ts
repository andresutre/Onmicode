import { readFlag, writeFlag } from "../../settings/model/storageFlags";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";

const WELCOME_COMPLETED_KEY = "monocode.welcomeCompleted";

/** Fired on `window` to reopen the welcome from Settings or the palette. */
export const OPEN_WELCOME_EVENT = "monocode:open-welcome";

export function loadWelcomeCompleted(): boolean {
  return readFlag(WELCOME_COMPLETED_KEY) ?? false;
}

export function saveWelcomeCompleted() {
  writeFlag(WELCOME_COMPLETED_KEY, true);
}

export function openWelcome() {
  window.dispatchEvent(new Event(OPEN_WELCOME_EVENT));
}

export type WelcomeBootState = {
  completed: boolean;
  /** The window was opened by dragging tabs out of another one. */
  transferred: boolean;
  /** A saved workspace came back, so Onmicode has run here before. */
  resumed: boolean;
  /** Remembered and archived projects. */
  projects: number;
  /** Sessions listed at startup. */
  sessions: number;
};

/**
 * The welcome opens by itself only on a fresh install. Anything left by an
 * earlier run, even a workspace with no project in it, means an existing user.
 */
export function shouldShowWelcomeAtBoot(state: WelcomeBootState): boolean {
  return (
    !state.completed &&
    !state.transferred &&
    !state.resumed &&
    state.projects === 0 &&
    state.sessions === 0
  );
}

/** Listed even when missing: the agents most people arrive with. */
export const PRIMARY_AGENTS: readonly HarnessId[] = [
  "claude",
  "codex",
  "cursor",
];

/** Agents whose sign-in can be read back from their usage endpoint. */
export const SIGN_IN_CHECKED_AGENTS = ["claude", "codex"] as const;

export type SignInCheckedAgent = (typeof SIGN_IN_CHECKED_AGENTS)[number];

export function isSignInChecked(id: HarnessId): id is SignInCheckedAgent {
  return (SIGN_IN_CHECKED_AGENTS as readonly HarnessId[]).includes(id);
}

/** Primary agents and any other installed one first; the rest wait behind "more". */
export function splitWelcomeAgents(installed: (id: HarnessId) => boolean): {
  shown: HarnessId[];
  more: HarnessId[];
} {
  const shown = HARNESSES.filter(
    (id) => PRIMARY_AGENTS.includes(id) || installed(id),
  );
  return { shown, more: HARNESSES.filter((id) => !shown.includes(id)) };
}

export type AgentSignIn = "checking" | "signedIn" | "signedOut";

export type AgentStatus =
  | "checking"
  | "missing"
  | "signedOut"
  | "ready"
  /** Installed, but its sign-in cannot be checked from here. */
  | "installed";

export function agentStatus({
  probed,
  installed,
  signIn,
}: {
  probed: boolean;
  installed: boolean;
  /** Only for agents whose sign-in can be checked. */
  signIn?: AgentSignIn;
}): AgentStatus {
  if (!probed) return "checking";
  if (!installed) return "missing";
  if (!signIn) return "installed";
  if (signIn === "checking") return "checking";
  return signIn === "signedOut" ? "signedOut" : "ready";
}

/** "Claude Code", "Claude Code and Codex", "Claude Code, Codex and Cursor". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
