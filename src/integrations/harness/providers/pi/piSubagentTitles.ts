import { sanitizeThreadTitle } from "../../../../features/sessions/model/sessionTitle";
import {
  extractJsonObject,
  limitSection,
} from "../../../../shared/lib/jsonText";
import { readableTask } from "./piSubagentName";

const BRIEF_LIMIT = 1_500;
const MAX_BRIEFS = 16;

const SUBAGENT_TITLE_PROMPT = `Name each delegated subagent task below so the user can tell the runs apart at a glance, the way a coding session gets its title.
Return JSON only: {"titles": [...]} with exactly one string per task, in the same order.
Do not call tools.

Before answering, silently reduce each task to its subject and outcome. Drop setup: repository paths, worktrees, branches to check out, files to read first, tools to use, and rules about what not to do.

Editorial rules:
- 2-6 words, fewer than 40 characters.
- Use a compact noun phrase or clear action phrase, such as "Review PR #487" or "Fix chart legend overlap".
- Keep the issue or PR numbers and names that tell one task from another.
- Do not copy and truncate the task.
- Avoid quotes, labels, filler, and trailing punctuation.`;

/**
 * The briefs a `subagent` call hands its runs, in run order: one for a single
 * run, one per task for a batch or a parallel workflow. Redacted or missing
 * briefs stay as gaps so indexes still line up with the runs.
 */
export function piSubagentBriefs(
  input: Record<string, unknown>,
): Array<string | undefined> {
  if (input.action != null) return [];
  const args =
    input.args && typeof input.args === "object"
      ? (input.args as Record<string, unknown>)
      : undefined;
  const list = Array.isArray(input.tasks)
    ? input.tasks
    : Array.isArray(args?.tasks)
      ? args.tasks
      : Array.isArray(input.chain)
        ? input.chain
        : undefined;
  if (list) return list.slice(0, MAX_BRIEFS).map(briefOf);
  if (input.workflow != null && input.workflow !== false) return [];
  const single = briefOf(input);
  return single ? [single] : [];
}

function briefOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = (value as Record<string, unknown>).task;
  return typeof task === "string" ? readableTask(task) : undefined;
}

export function buildSubagentTitlePrompt(
  briefs: Array<string | undefined>,
): string {
  const tasks = briefs
    .map(
      (brief, index) =>
        `Task ${index + 1}:\n${brief ? limitSection(brief, BRIEF_LIMIT) : "(not shown)"}`,
    )
    .join("\n\n");
  return `${SUBAGENT_TITLE_PROMPT}\n\n${tasks}`;
}

/** One title per brief, in order; a gap where the model gave none. */
export function parseSubagentTitles(
  raw: string,
  count: number,
): Array<string | undefined> {
  const json = extractJsonObject(raw);
  if (!json) return [];
  let titles: unknown;
  try {
    titles = (JSON.parse(json) as { titles?: unknown }).titles;
  } catch {
    return [];
  }
  if (!Array.isArray(titles)) return [];
  return titles.slice(0, count).map((title) => {
    if (typeof title !== "string") return undefined;
    const clean = sanitizeThreadTitle(title).replace(/[.:;,]+$/, "");
    return clean || undefined;
  });
}

/**
 * Which brief a transcript row belongs to. A single run's row is the launch
 * itself; a batch's rows are `<launch>:agent:<key>`, keyed by index or by a
 * workflow's `task-N`.
 */
export function subagentRowBrief(
  launchId: string,
  rowId: string,
): number | undefined {
  if (rowId === launchId) return 0;
  const prefix = `${launchId}:agent:`;
  if (!rowId.startsWith(prefix)) return undefined;
  const key = rowId.slice(prefix.length);
  const task = /^task-(\d+)$/.exec(key);
  if (task) return Number(task[1]) - 1;
  return /^\d+$/.test(key) ? Number(key) : undefined;
}
