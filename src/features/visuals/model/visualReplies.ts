import visualInstructions from "../../../instructions/visuals.md?raw";
import { loadVisualReplies } from "../../settings/model/displayPrefs";

/**
 * What a turn tells the agent about visuals, or nothing when the setting is
 * off. It goes with every turn: compaction, handoffs and harnesses that keep
 * no history would otherwise lose it.
 */
export function visualRepliesContext(
  enabled: boolean = loadVisualReplies(),
): string | undefined {
  if (!enabled) return undefined;
  return `<onmicode_visuals>\n${visualInstructions.trim()}\n</onmicode_visuals>`;
}
