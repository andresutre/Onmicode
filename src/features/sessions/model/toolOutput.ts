import type { Block } from "./session";
import {
  needsApproval,
  toolCallState,
  toolCategory,
} from "./transcriptActivity";

/** What a row in the work trail opens onto, if anything. */
export type ToolOutputDisclosure = "error" | "output";

/**
 * A failed call opens onto its reason. A command, or a tool whose result is
 * not on screen already, opens onto what it printed, while it runs as well as
 * after. The rest carry their result in the row itself: a read opens the file,
 * a search names its query, an edit previews its diff, and a delegated run has
 * a panel of its own.
 */
export function toolOutputDisclosure(
  block: Block,
  label: string,
  output: { detail?: string; omitted: boolean },
): ToolOutputDisclosure | undefined {
  if (needsApproval(block)) return undefined;
  const text = output.detail?.trim();
  if (!text && !output.omitted) return undefined;
  if (toolCallState(block) === "rejected") return "error";
  const kind = toolCategory(block);
  if (kind !== "run" && kind !== "other") return undefined;
  // A harness that echoes the call back as its result printed nothing new.
  if (text && text === label.trim()) return undefined;
  return "output";
}

/**
 * Output as the terminal would have left it: colour codes and cursor moves
 * dropped, and a line a progress bar kept redrawing with `\r` showing only its
 * last frame.
 */
export function plainToolOutput(text: string): string {
  if (!text.includes("\u001b") && !text.includes("\r")) return text;
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-_]/g, "")
    .split("\n")
    .map((line) => {
      const frame = line.replace(/\r+$/, "");
      return frame.slice(frame.lastIndexOf("\r") + 1);
    })
    .join("\n");
}
