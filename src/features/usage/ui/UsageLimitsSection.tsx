import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { resetOutcomeLabel } from "../../../app/shell/UsageProviderChip";
import { supportsHarnessLogin } from "../../../integrations/harness/core/auth";
import { ChevronRight, RefreshCw } from "../../../shared/ui/icons";
import { accountStatus } from "../../providers/model/accountUsage";
import {
  identityKey,
  useProviderAccountIdentities,
  type ProviderAccountIdentity,
} from "../../providers/model/providerAccountIdentity";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsAccountProfiles,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import {
  clampUsedPercent,
  formatExtraUsageBalance,
  formatResetCountdown,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  type ProviderRateLimits,
  type RateLimitResetCredit,
  type RateLimitWindow,
} from "../../providers/model/rateLimits";
import type { CodexRateLimitResetOutcome } from "../../providers/model/rateLimitsFetch";
import {
  getAllRateLimits,
  subscribeRateLimits,
} from "../../providers/model/rateLimitsCache";
import {
  AccountStatusLabel,
  barClass,
} from "../../providers/ui/ProviderAccountUsage";
import { ProviderAccountSubtitle } from "../../providers/ui/ProviderAccountSubtitle";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";
import { usePiLimits } from "../model/piLimits";
import { usagePools } from "../model/usagePools";
import {
  refreshUsage,
  signInAndReload,
  spendCodexReset,
} from "../model/usageActions";
import {
  PACE_COPY,
  elapsedShare,
  evenPacePercent,
  usagePace,
  type UsagePace,
} from "../model/usagePace";
import {
  buildUsageSections,
  oldestUsageUpdate,
  usageAccountState,
  usageRefreshTargets,
  usageSectionPlacement,
  usageUpdatedLabel,
  usageWindows,
  usageWindowTitle,
  type UsageAccountEntry,
  type UsagePlacement,
  type UsageSection,
  type UsageWindowKind,
} from "../model/usageSections";
import { UsagePooledLimits } from "./UsagePooledLimits";

const CLOCK_MS = 30_000;

/**
 * Every provider's plan limits, one card per provider with a block per
 * account. Reads the snapshots the footer chips share, and loads what they
 * have not, so the two never disagree.
 */
export function UsageLimitsSection({
  active = true,
  onManageAccounts,
}: {
  /** Opening the page rereads snapshots older than the footer's floor. */
  active?: boolean;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
}) {
  const titleId = useId();
  const [accountsVersion, setAccountsVersion] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef<Promise<void> | null>(null);
  const placements = useRef(new Map<string, UsagePlacement>());
  const limits = useSyncExternalStore(
    subscribeRateLimits,
    getAllRateLimits,
    getAllRateLimits,
  );
  const pi = usePiLimits();

  useEffect(
    () =>
      subscribeProviderAccounts(() => setAccountsVersion((value) => value + 1)),
    [],
  );

  // A hidden tab keeps its place without repainting its countdowns.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  // `accountsVersion` stands in for the stored accounts it announces.
  const accounts = useMemo(
    () => ({
      claude: providerAccounts("claude"),
      codex: providerAccounts("codex"),
      devin: providerAccounts("devin"),
    }),
    [accountsVersion],
  );
  const sections = buildUsageSections({ accounts, limits, pi });
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const placed = sections.map((section) => ({
    section,
    placement: usageSectionPlacement(
      section,
      placements.current.get(section.id),
    ),
  }));
  useEffect(() => {
    for (const { section, placement } of placed) {
      placements.current.set(section.id, placement);
    }
  });
  const shown = placed
    .filter((entry) => entry.placement === "shown")
    .map((entry) => entry.section);
  const unconnected = placed
    .filter((entry) => entry.placement === "unconnected")
    .map((entry) => entry.section);
  const identities = useProviderAccountIdentities(
    [...accounts.claude, ...accounts.codex, ...accounts.devin],
    `${accountsVersion}:${refreshes}`,
  );
  const updated = usageUpdatedLabel(oldestUsageUpdate(shown), now);

  const refresh = useCallback((mode: "all" | "stale") => {
    if (inflight.current) return inflight.current;
    const targets = usageRefreshTargets(sectionsRef.current, Date.now(), mode);
    if (targets.length === 0) return Promise.resolve();
    setRefreshing(true);
    const run = refreshUsage(targets).finally(() => {
      inflight.current = null;
      setRefreshing(false);
      setNow(Date.now());
      if (mode === "all") setRefreshes((count) => count + 1);
    });
    inflight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (active) void refresh("stale");
  }, [active, accountsVersion, refresh]);

  return (
    <section aria-labelledby={titleId} data-usage-limits>
      <div className="flex items-end gap-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[13px] font-semibold text-content">
            Limits
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            How much of each plan's 5-hour, weekly and monthly allowance is
            left. The line on each bar marks even spending.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          {updated ? (
            <span className="text-[11px] tabular-nums text-content/40">
              {updated}
            </span>
          ) : null}
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void refresh("all")}
            aria-label="Refresh usage limits"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-content/10 px-2.5 text-[12px] text-content/70 transition-transform duration-150 hover:bg-content/10 hover:text-content active:scale-[0.97] disabled:cursor-default disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
            Refresh
          </button>
        </div>
      </div>

      {shown.length > 0 ? (
        <div className="flex flex-col gap-3">
          {shown.map((section) => (
            <UsageProviderCard
              key={section.id}
              section={section}
              identities={identities}
              now={now}
              onManageAccounts={onManageAccounts}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-content/10 bg-content/3 px-4 py-6 text-center text-[12px] text-content/45">
          No provider reports plan limits yet. Sign in to one below to see how
          much of it is left.
        </p>
      )}

      {unconnected.length > 0 ? (
        <UnconnectedProviders
          key={shown.length === 0 ? "open" : "folded"}
          sections={unconnected}
          defaultOpen={shown.length === 0}
        />
      ) : null}
    </section>
  );
}

function ProviderTile({ section }: { section: UsageSection }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
      <HarnessIcon harness={section.harness} className="size-4" />
    </span>
  );
}

/** Which pooled cards had their accounts opened or folded this session. */
const accountListsOpen = new Map<string, boolean>();

function UsageProviderCard({
  section,
  identities,
  now,
  onManageAccounts,
}: {
  section: UsageSection;
  identities: Record<string, ProviderAccountIdentity | null>;
  now: number;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
}) {
  const several = section.accounts.length > 1;
  const single = several ? null : section.accounts[0];
  const updated = usageUpdatedLabel(oldestUsageUpdate([section]), now);
  const updating = section.accounts.some(
    (entry) =>
      entry.limits?.status === "fetching" &&
      usageAccountState(entry.limits) === "ready",
  );
  const manage =
    onManageAccounts &&
    section.accountProvider &&
    supportsAccountProfiles(section.accountProvider)
      ? section.accountProvider
      : null;
  const summary = several
    ? usagePools(
        section.accounts.map((entry) => ({
          key: entry.key,
          label: entry.label ?? section.title,
          limits: entry.limits,
        })),
        now,
      )
    : null;
  const pooled = summary && summary.pools.length > 0 ? summary : null;
  // Accounts fold under the pool once every one of them reads fine; one
  // that needs signing in again keeps them open.
  const [accountsOpen, setAccountsOpen] = useState(
    () =>
      accountListsOpen.get(section.id) ??
      section.accounts.some((entry) =>
        ["expired", "signedOut", "failed"].includes(
          usageAccountState(entry.limits),
        ),
      ),
  );
  const banked = section.accounts.reduce(
    (sum, entry) => sum + (entry.limits?.resetCredits?.availableCount ?? 0),
    0,
  );
  return (
    <article
      aria-label={`${section.title} usage`}
      data-usage-provider={section.id}
      className="overflow-hidden rounded-xl border border-content/10 bg-content/3"
    >
      <header className="flex items-center gap-3 px-4 py-3">
        <ProviderTile section={section} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-content">
            {section.title}
          </h3>
          <div className="mt-0.5 flex min-w-0 text-[11px] text-content/40">
            {several ? (
              `${section.accounts.length} accounts`
            ) : (
              <ProviderAccountSubtitle
                identity={
                  single?.account
                    ? identities[identityKey(single.account)]
                    : undefined
                }
                fallback={section.sourceLabel}
                className="truncate"
              />
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-content/40">
          {updating ? (
            <span className="inline-flex items-center gap-1">
              <RefreshCw
                className="size-3 motion-safe:animate-spin"
                strokeWidth={1.75}
                aria-hidden
              />
              Updating
            </span>
          ) : updated ? (
            <span className="tabular-nums">{updated}</span>
          ) : null}
          {manage ? (
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-content/55 hover:bg-content/10 hover:text-content"
              onClick={() => onManageAccounts?.(manage)}
            >
              Manage accounts
            </button>
          ) : null}
        </div>
      </header>
      {pooled ? (
        <>
          <UsagePooledLimits summary={pooled} now={now} />
          <button
            type="button"
            aria-expanded={accountsOpen}
            data-usage-accounts-toggle
            className="flex w-full min-w-0 items-center gap-1.5 border-t border-content/5 px-4 py-2.5 text-left text-[12px] text-content/55 hover:bg-content/[0.03] hover:text-content"
            onClick={() => {
              accountListsOpen.set(section.id, !accountsOpen);
              setAccountsOpen(!accountsOpen);
            }}
          >
            <ChevronRight
              className={`size-3 shrink-0 transition-transform duration-150 ${accountsOpen ? "rotate-90" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="shrink-0 font-medium">By account</span>
            <span className="min-w-0 truncate text-content/35">
              {section.accounts.map((entry) => entry.label).join(", ")}
            </span>
            {banked > 0 ? (
              <span className="ml-auto shrink-0 text-[10px] text-content/45">
                {banked} banked {banked === 1 ? "reset" : "resets"}
              </span>
            ) : null}
          </button>
        </>
      ) : null}
      {!pooled || accountsOpen
        ? section.accounts.map((entry) => (
            <UsageAccountBlock
              key={entry.key}
              section={section}
              entry={entry}
              identity={
                entry.account
                  ? identities[identityKey(entry.account)]
                  : undefined
              }
              showHeader={several}
              now={now}
            />
          ))
        : null}
    </article>
  );
}

function UsageAccountBlock({
  section,
  entry,
  identity,
  showHeader,
  now,
}: {
  section: UsageSection;
  entry: UsageAccountEntry;
  identity: ProviderAccountIdentity | null | undefined;
  showHeader: boolean;
  now: number;
}) {
  const limits = entry.limits;
  const state = usageAccountState(limits);
  const windows = usageWindows(limits);
  return (
    <div
      className="border-t border-content/5 px-4 py-3"
      data-usage-account={entry.key}
    >
      {showHeader ? (
        <div className="mb-2.5 flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="shrink-0 truncate text-[12px] font-medium text-content/85">
              {entry.label}
            </span>
            <ProviderAccountSubtitle
              identity={identity}
              className="truncate text-[10px] text-content/35"
            />
          </div>
          {windows.length > 0 ? (
            <AccountStatusLabel
              status={accountStatus(limits, now)}
              className="shrink-0 text-[10px]"
            />
          ) : null}
        </div>
      ) : null}

      {state === "stale" ? (
        <p className="mb-2 rounded-lg bg-amber-400/10 px-2.5 py-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
          Couldn’t refresh. Showing the last available snapshot.
        </p>
      ) : null}

      {windows.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
          {windows.map(({ kind, window }) => (
            <UsageWindowTile key={kind} kind={kind} window={window} now={now} />
          ))}
          {limits?.extraUsageBalance != null ? (
            <section className="flex flex-col justify-between rounded-lg bg-content/[0.045] px-3 py-2.5 ring-1 ring-inset ring-content/[0.06]">
              <h4 className="text-[11px] font-medium text-content/65">
                Extra usage balance
              </h4>
              <span className="mt-2 text-[13px] font-semibold tabular-nums">
                {formatExtraUsageBalance(limits.extraUsageBalance)}
              </span>
            </section>
          ) : null}
        </div>
      ) : state === "loading" ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
          <TileSkeleton />
          <TileSkeleton />
        </div>
      ) : (
        <AccountProblem section={section} entry={entry} state={state} />
      )}

      {entry.source.kind === "account" &&
      entry.source.provider === "codex" &&
      limits ? (
        <CodexResets
          accountId={entry.source.accountId}
          limits={limits}
          now={now}
        />
      ) : null}
    </div>
  );
}

function AccountProblem({
  section,
  entry,
  state,
}: {
  section: UsageSection;
  entry: UsageAccountEntry;
  state: ReturnType<typeof usageAccountState>;
}) {
  const message =
    entry.limits?.error ||
    (state === "expired"
      ? "Sign-in expired"
      : state === "signedOut"
        ? "Not signed in"
        : "Usage unavailable");
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-content/[0.035] px-3 py-2.5 ring-1 ring-inset ring-content/[0.06]">
      <p className="min-w-0 flex-1 text-[11px] leading-4 text-content/55">
        {message}
        {state === "failed" ? (
          <span className="text-content/35"> · Try Refresh.</span>
        ) : null}
      </p>
      {state === "expired" || state === "signedOut" ? (
        <SignInAction section={section} entry={entry} />
      ) : null}
    </div>
  );
}

function SignInAction({
  section,
  entry,
}: {
  section: UsageSection;
  entry: UsageAccountEntry;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = entry.source;
  if (source.kind !== "account" || !supportsHarnessLogin(source.provider)) {
    return null;
  }
  const signIn = async () => {
    setRunning(true);
    setError(null);
    try {
      await signInAndReload(source.provider, source.accountId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not complete sign-in",
      );
    } finally {
      setRunning(false);
    }
  };
  return (
    <span className="flex shrink-0 items-center gap-2">
      {error ? (
        <span
          className="max-w-[16rem] truncate text-[10px] text-red-500"
          role="status"
          title={error}
        >
          {error}
        </span>
      ) : null}
      <button
        type="button"
        disabled={running}
        aria-label={`Sign in to ${section.title}${entry.label ? ` as ${entry.label}` : ""}`}
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content px-2.5 text-[11px] font-medium text-background-base transition-transform duration-150 hover:bg-content/85 active:scale-[0.97] disabled:cursor-default disabled:opacity-55"
        onClick={() => void signIn()}
      >
        {running ? (
          <RefreshCw className="size-3 animate-spin" aria-hidden />
        ) : null}
        {running ? "Waiting for browser…" : "Sign in"}
      </button>
    </span>
  );
}

const PACE_CLASS: Record<UsagePace, string> = {
  ahead: "text-amber-700 dark:text-amber-300",
  on: "text-content/50",
  under: "text-emerald-700 dark:text-emerald-300",
};

function PaceLabel({ pace }: { pace: UsagePace }) {
  const copy = PACE_COPY[pace];
  return (
    <span className={`shrink-0 ${PACE_CLASS[pace]}`} title={copy.detail}>
      {copy.label}
    </span>
  );
}

function UsageWindowTile({
  kind,
  window,
  now,
}: {
  kind: UsageWindowKind;
  window: RateLimitWindow;
  now: number;
}) {
  const showRemaining = useShowRemainingUsage();
  const title = usageWindowTitle(kind, window);
  const pct = clampUsedPercent(window.usedPercent);
  const shown = showRemaining ? 100 - pct : pct;
  const full = pct >= 100 && (window.resetsAt == null || window.resetsAt > now);
  const pace = full ? null : usagePace(window, now);
  const marker = evenPacePercent(window, now, showRemaining);
  const elapsed = elapsedShare(window, now);
  const reset =
    window.resetsAt == null
      ? `${formatWindowLabel(window.windowMinutes)} window`
      : formatResetCountdown(window.resetsAt - now);
  return (
    <section
      className="rounded-lg bg-content/[0.045] px-3 py-2.5 ring-1 ring-inset ring-content/[0.06]"
      data-usage-window={kind}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="min-w-0 truncate text-[11px] font-medium text-content/65">
          {title}
        </h4>
        <span className="shrink-0 tabular-nums">
          <span
            className={`text-[13px] font-semibold ${full ? "text-red-400" : "text-content"}`}
          >
            {formatUsagePercent(shown)}
          </span>{" "}
          <span className="text-[11px] text-content/45">
            {showRemaining ? "left" : "used"}
          </span>
        </span>
      </div>
      <div
        className="relative mt-2"
        title={
          elapsed == null
            ? undefined
            : `${Math.round(elapsed * 100)}% of the window has passed. The line marks even spending.`
        }
      >
        <div
          className="h-1.5 overflow-hidden rounded-full bg-content/10"
          role="progressbar"
          aria-label={`${title} ${showRemaining ? "remaining" : "used"}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${formatUsagePercent(shown)} ${showRemaining ? "left" : "used"}${pace ? `, ${PACE_COPY[pace].label.toLowerCase()}` : ""}`}
        >
          <span
            className={`block h-full rounded-full transition-[width] duration-300 ${barClass(pct)}`}
            style={{ width: `${shown}%` }}
          />
        </div>
        {marker != null ? (
          <span
            aria-hidden
            data-usage-pace-marker
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-content/55"
            style={{ left: `${marker}%` }}
          />
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] leading-4">
        {full ? (
          <span className="shrink-0 font-medium text-red-400">
            Limit reached
          </span>
        ) : pace ? (
          <PaceLabel pace={pace} />
        ) : (
          <span />
        )}
        <span
          className="min-w-0 truncate text-right tabular-nums text-content/40"
          title={
            window.resetsAt == null
              ? undefined
              : new Date(window.resetsAt).toLocaleString()
          }
        >
          {reset}
        </span>
      </div>
    </section>
  );
}

function TileSkeleton() {
  return (
    <div
      className="h-[4.5rem] animate-pulse rounded-lg bg-content/[0.045] ring-1 ring-inset ring-content/[0.06]"
      aria-hidden
    />
  );
}

type ResetState =
  | { step: "idle" }
  | { step: "confirming" }
  | { step: "using" }
  | { step: "done"; outcome: CodexRateLimitResetOutcome }
  | { step: "error"; message: string };

/** The available credit that expires first, or none when only a count is known. */
function nextResetCredit(
  limits: ProviderRateLimits,
): RateLimitResetCredit | undefined {
  return [...(limits.resetCredits?.credits ?? [])]
    .filter(
      (credit) => credit.status === "available" || credit.status === "unknown",
    )
    .sort(
      (left, right) =>
        (left.expiresAt ?? Number.POSITIVE_INFINITY) -
        (right.expiresAt ?? Number.POSITIVE_INFINITY),
    )[0];
}

/** Banked Codex resets, spent one at a time after an explicit confirm. */
function CodexResets({
  accountId,
  limits,
  now,
}: {
  accountId: string;
  limits: ProviderRateLimits;
  now: number;
}) {
  const [state, setState] = useState<ResetState>({ step: "idle" });
  const count = limits.resetCredits?.availableCount ?? 0;
  if (count <= 0 && state.step !== "done") return null;
  const next = nextResetCredit(limits);
  const expiry =
    next?.expiresAt == null
      ? null
      : next.expiresAt <= now
        ? "Next expires now"
        : `Next expires in ${formatResetDuration(next.expiresAt - now)}`;
  const spend = async () => {
    setState({ step: "using" });
    try {
      setState({
        step: "done",
        outcome: await spendCodexReset(accountId, next?.id),
      });
    } catch (caught) {
      setState({
        step: "error",
        message:
          caught instanceof Error ? caught.message : "Could not use this reset",
      });
    }
  };
  return (
    <section
      aria-label="Banked resets"
      className="mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-content/[0.035] px-3 py-2 ring-1 ring-inset ring-content/[0.06]"
    >
      <h4 className="flex items-center gap-1.5 text-[11px] font-medium">
        Banked resets
        <span className="rounded-full bg-content/[0.07] px-1.5 py-px text-[9px] font-medium tabular-nums text-content/65 ring-1 ring-inset ring-content/[0.07]">
          {count}
        </span>
      </h4>
      {expiry ? (
        <span className="text-[10px] tabular-nums text-content/40">
          {expiry}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-1.5 text-[10px]">
        {state.step === "using" ? (
          <span className="inline-flex items-center gap-1.5 text-content/45">
            <RefreshCw
              className="size-3 animate-spin"
              strokeWidth={1.75}
              aria-hidden
            />
            Applying…
          </span>
        ) : state.step === "confirming" ? (
          <>
            <span className="text-content/50">Spend one reset now?</span>
            <button
              type="button"
              className="h-6 rounded-md px-2 text-content/50 hover:bg-content/10 hover:text-content"
              onClick={() => setState({ step: "idle" })}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-6 rounded-md bg-content px-2.5 font-medium text-background-base transition-transform duration-150 ease-out active:scale-[0.97]"
              onClick={() => void spend()}
            >
              Confirm
            </button>
          </>
        ) : (
          <>
            {state.step === "done" || state.step === "error" ? (
              <span
                role="status"
                className={
                  state.step === "done" && state.outcome === "reset"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-content/50"
                }
              >
                {state.step === "done"
                  ? resetOutcomeLabel(state.outcome)
                  : state.message}
              </span>
            ) : null}
            {count > 0 ? (
              <button
                type="button"
                className="h-6 rounded-md bg-content/[0.07] px-2.5 font-medium text-content/70 ring-1 ring-inset ring-content/[0.08] transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/[0.11] hover:text-content active:scale-[0.97]"
                onClick={() => setState({ step: "confirming" })}
              >
                Use a reset
              </button>
            ) : null}
          </>
        )}
      </span>
    </section>
  );
}

/** Providers never set up here, folded into one line until asked for. */
function UnconnectedProviders({
  sections,
  defaultOpen,
}: {
  sections: UsageSection[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  return (
    <section className="mt-4" data-usage-unconnected>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        className="-ml-1.5 flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-content/55 hover:bg-content/[0.07] hover:text-content"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="shrink-0 font-medium">Not connected</span>
        <span className="min-w-0 truncate text-content/35">
          {sections.map((section) => section.title).join(", ")}
        </span>
      </button>
      {open ? (
        <div
          id={listId}
          className="mt-1.5 overflow-hidden rounded-xl border border-content/10 bg-content/3"
        >
          {sections.map((section) => {
            const entry = section.accounts[0];
            const state = usageAccountState(entry?.limits);
            return (
              <div
                key={section.id}
                className="flex min-w-0 items-center gap-3 border-b border-content/5 px-4 py-2.5 last:border-b-0"
                data-usage-provider={section.id}
              >
                <ProviderTile section={section} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-content/85">
                    {section.title}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-content/40">
                    {state === "loading"
                      ? "Checking…"
                      : entry?.limits?.error || "Not connected"}
                  </div>
                </div>
                {entry && state === "signedOut" ? (
                  <SignInAction section={section} entry={entry} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
