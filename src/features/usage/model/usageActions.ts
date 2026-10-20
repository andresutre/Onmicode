import { loginHarness } from "../../../integrations/harness/core/auth";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../providers/model/providerAccounts";
import type { RateLimitProvider } from "../../providers/model/rateLimits";
import { loadRateLimits } from "../../providers/model/rateLimitsCache";
import {
  consumeCodexRateLimitResetCredit,
  type CodexRateLimitResetOutcome,
} from "../../providers/model/rateLimitsFetch";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { loadPiLimits } from "./piLimits";
import type { UsageRefreshTarget } from "./usageSections";

/** Read every target; one failing read never stops the others. */
export async function refreshUsage(
  targets: UsageRefreshTarget[],
): Promise<void> {
  await Promise.allSettled(
    targets.map(({ source, force }) =>
      source.kind === "pi"
        ? loadPiLimits(source.provider, force)
        : loadRateLimits(source.provider, source.accountId, force),
    ),
  );
}

/**
 * The provider's own sign-in for one account, as the footer chip runs it,
 * then a fresh read that has to succeed for the sign-in to count.
 */
export async function signInAndReload(
  provider: RateLimitProvider,
  accountId: string,
): Promise<void> {
  await (accountId === DEFAULT_PROVIDER_ACCOUNT_ID
    ? loginHarness(provider)
    : loginHarness(provider, accountId));
  const value = await loadRateLimits(provider, accountId, true);
  if (value.status !== "ok") {
    throw new Error(
      value.error || `${HARNESS_TITLE[provider]} sign-in could not be verified`,
    );
  }
}

/** Spend one banked Codex reset, then reread the account it cleared. */
export async function spendCodexReset(
  accountId: string,
  creditId?: string,
): Promise<CodexRateLimitResetOutcome> {
  const outcome = await consumeCodexRateLimitResetCredit(creditId, accountId);
  await loadRateLimits("codex", accountId, true);
  return outcome;
}
