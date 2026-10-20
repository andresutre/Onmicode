import { useEffect, useMemo, useState } from "react";
import type { Block } from "../model/session";
import {
  currentTurnSubagents,
  tickerFocus,
  type TickerRun,
} from "../model/subagentTicker";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { Shimmer } from "../../../shared/ui/Shimmer";
import { ChevronDown, ChevronUp } from "../../../shared/ui/icons";

/** How long the collapsed ticker narrates one run before moving on. */
export const TICKER_BEAT_MS = 2200;
const STACK_CAP = 5;

/**
 * The turn's delegated runs, docked above the composer. Collapsed it is one
 * pill: the runs' mascots stacked, how many are working, and a line that
 * cycles through what each of them is doing. Opened it lists every run, and a
 * row jumps the transcript to that run's own row, where its trail is.
 *
 * It only exists while the turn does: once the turn settles the runs are
 * history and the transcript holds them.
 */
export function SubagentTicker({
  blocks,
  busy,
}: {
  blocks: Block[];
  busy: boolean;
}) {
  const runs = useMemo(() => currentTurnSubagents(blocks), [blocks]);
  const running = runs.filter((run) => run.state === "pending").length;
  const visible = runs.length > 0 && (busy || running > 0);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!visible || running < 2) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICKER_BEAT_MS);
    return () => window.clearInterval(id);
  }, [visible, running]);

  // A fresh turn starts collapsed.
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  if (!visible) return null;
  const focus = tickerFocus(runs, tick);
  const failed = runs.filter((run) => run.state === "rejected").length;
  const summary = running
    ? `${running} working`
    : failed
      ? `${failed} failed`
      : "All finished";

  return (
    <section
      aria-label="Subagents"
      data-subagent-ticker
      // The composer runner walks the composer's top edge while the turn is
      // busy; the gap under the pill is its lane.
      className="flex flex-col gap-1 px-1.5 pb-5"
    >
      {open ? (
        <div
          id="subagent-ticker-list"
          className="flex max-h-[40vh] flex-col gap-px overflow-y-auto rounded-lg bg-content/5 p-1"
        >
          {runs.map((run) => (
            <TickerRow key={run.id} run={run} />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? "subagent-ticker-list" : undefined}
        aria-label={`Subagents: ${summary}. ${open ? "Hide" : "Show"} list`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-full bg-content/5 py-1 pl-2.5 pr-2 text-left text-xs transition-colors duration-200 hover:bg-content/8"
      >
        <span className="flex shrink-0 items-center">
          {runs.slice(0, STACK_CAP).map((run, index) => (
            <span
              key={run.id}
              className={`flex size-5 items-center justify-center rounded-full border-[1.5px] border-background-base bg-content/10 ${
                index ? "-ml-1.5" : ""
              }`}
            >
              <RunMascot run={run} />
            </span>
          ))}
        </span>
        <span
          className={`shrink-0 tabular-nums ${
            !running && failed ? "text-red-400" : "text-content/60"
          }`}
        >
          {summary}
        </span>
        <span className="relative h-[18px] min-w-0 flex-1 overflow-hidden">
          {focus ? (
            <span
              key={`${focus.id}:${focus.now}`}
              className="subagent-ticker-line absolute inset-0 truncate font-mono text-[11px] leading-[18px] text-content/45"
            >
              {focus.name}
              {focus.now ? `: ${focus.now}` : ""}
            </span>
          ) : null}
        </span>
        {open ? (
          <ChevronDown
            className="size-3 shrink-0 text-content/40"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronUp
            className="size-3 shrink-0 text-content/40"
            strokeWidth={1.75}
          />
        )}
      </button>
    </section>
  );
}

function TickerRow({ run }: { run: TickerRun }) {
  const active = run.state === "pending";
  const status =
    run.state === "rejected"
      ? "failed"
      : run.steps === 1
        ? "1 step"
        : run.steps
          ? `${run.steps} steps`
          : "";
  return (
    <button
      type="button"
      title={run.now || run.name}
      onClick={(event) => jumpToRun(event.currentTarget, run.id)}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-content/8"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <RunMascot run={run} />
      </span>
      {active ? (
        <Shimmer
          className="min-w-0 max-w-[40%] shrink-0 truncate"
          duration={1.6}
        >
          {run.name}
        </Shimmer>
      ) : (
        <span
          className={`min-w-0 max-w-[40%] shrink-0 truncate ${
            run.state === "rejected" ? "text-red-400" : "text-content/55"
          }`}
        >
          {run.name}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/40">
        {active ? run.now : ""}
      </span>
      {status ? (
        <span
          className={`shrink-0 tabular-nums text-[11px] ${
            run.state === "rejected"
              ? "text-red-400"
              : run.state === "accepted"
                ? "text-emerald-400"
                : "text-content/40"
          }`}
        >
          {run.state === "accepted" ? `✓ ${status}` : status}
        </span>
      ) : null}
    </button>
  );
}

function RunMascot({ run }: { run: TickerRun }) {
  return (
    <ProjectMascot
      project={run.name}
      active={run.state === "pending"}
      className={`size-3 shrink-0 ${
        run.state === "rejected"
          ? "text-red-400"
          : run.state === "pending"
            ? "text-content/70"
            : "text-content/45"
      }`}
    />
  );
}

/**
 * Scroll the transcript to a run's own row and flash it. The search stays
 * inside this session's pane, so a split view never jumps the other pane.
 */
function jumpToRun(from: HTMLElement, id: string) {
  const pane = from.closest("[data-session-drop]") ?? document;
  const row = pane.querySelector<HTMLElement>(
    `[data-subagent-row="${CSS.escape(id)}"]`,
  );
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("subagent-row-flash");
  void row.offsetWidth;
  row.classList.add("subagent-row-flash");
  window.setTimeout(() => row.classList.remove("subagent-row-flash"), 1200);
}
