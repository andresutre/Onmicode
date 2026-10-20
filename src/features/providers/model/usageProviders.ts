import type { HarnessId } from "../../sessions/model/session";
import type { ProviderRateLimits, RateLimitProvider } from "./rateLimits";

const RATE_LIMIT_PROVIDERS: readonly RateLimitProvider[] = [
  "claude",
  "codex",
  "opencode",
  "devin",
];

export function isRateLimitProvider(
  harness: HarnessId | undefined,
): harness is RateLimitProvider {
  return RATE_LIMIT_PROVIDERS.some((provider) => provider === harness);
}

/**
 * A Pi model served by the pi-claude-code extension, which runs the Claude
 * CLI: its usage, and its account, are Claude Code's.
 */
export function piUsesClaudeCode(model: string | undefined): boolean {
  return Boolean(model?.startsWith("pi:claude-code/"));
}

/** The session's own provider, whose usage the footer always shows. */
export function usageProvidersFor(
  harness: HarnessId | undefined,
  model?: string,
): RateLimitProvider[] {
  if (harness === "pi" && piUsesClaudeCode(model)) return ["claude"];
  // Onmicode signs Pi's built-in Codex models in with a Codex profile.
  if (harness === "pi" && model?.startsWith("pi:openai-codex/"))
    return ["codex"];
  return isRateLimitProvider(harness) ? [harness] : [];
}

/**
 * Every other provider, shown beside the session's own once it has usage,
 * so a Pi or Cursor session still shows how much Claude Code and Codex have
 * left.
 */
export function otherUsageProvidersFor(
  harness: HarnessId | undefined,
  model?: string,
): RateLimitProvider[] {
  const own = usageProvidersFor(harness, model);
  return RATE_LIMIT_PROVIDERS.filter((provider) => !own.includes(provider));
}

/**
 * Another provider earns a chip only once it has usage to show. One that was
 * never signed in to, or whose usage could not be read, keeps out of the way
 * of the session's own.
 */
export function hasUsageToShow(limits: ProviderRateLimits): boolean {
  return Boolean(limits.session || limits.weekly || limits.monthly);
}
