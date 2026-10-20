import { useSyncExternalStore } from "react";
import {
  fetchPiUsage,
  piBillingProvider,
  type PiUsageProvider,
} from "../../providers/model/piUsage";
import {
  fetchingRateLimits,
  type ProviderRateLimits,
} from "../../providers/model/rateLimits";

/** Providers whose subscription quota Pi can report from its own sign-in. */
export const PI_USAGE_PROVIDERS = [
  "anthropic",
  "openai-codex",
] as const satisfies readonly PiUsageProvider[];

export type PiLimits = Partial<Record<PiUsageProvider, ProviderRateLimits>>;

// The footer's Pi chip keeps its own snapshot for the session's provider;
// the Usage page reads both providers whichever one a session uses.
let snapshots: PiLimits = {};
const pending = new Map<PiUsageProvider, Promise<ProviderRateLimits>>();
const listeners = new Set<() => void>();

function publish(provider: PiUsageProvider, value: ProviderRateLimits): void {
  snapshots = { ...snapshots, [provider]: value };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPiLimits(): PiLimits {
  return snapshots;
}

export function usePiLimits(): PiLimits {
  return useSyncExternalStore(subscribe, getPiLimits, getPiLimits);
}

/** Read Pi's quota once, or again when `force`d; overlapping reads share one. */
export function loadPiLimits(
  provider: PiUsageProvider,
  force = false,
): Promise<ProviderRateLimits> {
  const running = pending.get(provider);
  if (running) return running;
  const cached = snapshots[provider];
  if (cached && !force) return Promise.resolve(cached);
  publish(provider, fetchingRateLimits(piBillingProvider(provider), cached));
  const run = fetchPiUsage(provider)
    .then((result) => {
      publish(provider, result);
      return result;
    })
    .finally(() => pending.delete(provider));
  pending.set(provider, run);
  return run;
}

/** For tests that need a clean cache. */
export function clearPiLimits(): void {
  snapshots = {};
  pending.clear();
  for (const listener of listeners) listener();
}
