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

/** The session's own provider, whose usage the footer always shows. */
export function usageProvidersFor(
  harness: HarnessId | undefined,
): RateLimitProvider[] {
  return isRateLimitProvider(harness) ? [harness] : [];
}

/**
 * Every other provider, shown beside the session's own once it has usage,
 * so a Pi or Cursor session still shows how much Claude Code and Codex have
 * left.
 */
export function otherUsageProvidersFor(
  harness: HarnessId | undefined,
): RateLimitProvider[] {
  return RATE_LIMIT_PROVIDERS.filter((provider) => provider !== harness);
}

/**
 * Another provider earns a chip only once it has usage to show. One that was
 * never signed in to, or whose usage could not be read, keeps out of the way
 * of the session's own.
 */
export function hasUsageToShow(limits: ProviderRateLimits): boolean {
  return Boolean(limits.session || limits.weekly || limits.monthly);
}
