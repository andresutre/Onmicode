import type { Block } from "./session";
import {
  isSubagentBlock,
  subagentName,
  toolCallState,
  type ToolCallState,
} from "./transcriptActivity";

export type TickerRun = {
  id: string;
  name: string;
  state: ToolCallState;
  /** Tool steps the run has taken so far. */
  steps: number;
  /** The run's newest step, one line, or "" before it reports one. */
  now: string;
};

/**
 * The delegated runs of the turn in progress: every subagent block after the
 * last user message. Earlier turns' runs are settled history and stay in the
 * transcript only.
 */
export function currentTurnSubagents(blocks: Block[]): TickerRun[] {
  let start = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user" && !blocks[i].interjection) {
      start = i + 1;
      break;
    }
  }
  const runs: TickerRun[] = [];
  for (let i = start; i < blocks.length; i++) {
    const block = blocks[i];
    if (!isSubagentBlock(block)) continue;
    const steps = block.agentRun?.steps ?? [];
    runs.push({
      id: block.id,
      name: subagentName(block),
      state: toolCallState(block),
      steps: steps.filter((step) => step.kind === "tool").length,
      now: oneLine(steps[steps.length - 1]?.text ?? ""),
    });
  }
  return runs;
}

function oneLine(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}\u2026` : line;
}

/**
 * Which run the collapsed ticker narrates on beat `tick`: it rotates through
 * the ones still working, and once none are, rests on the last to finish.
 */
export function tickerFocus(
  runs: TickerRun[],
  tick: number,
): TickerRun | undefined {
  const running = runs.filter((run) => run.state === "pending");
  if (running.length) return running[tick % running.length];
  return runs[runs.length - 1];
}
