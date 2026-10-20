import { formatAgentType } from "../../core/preview";

/**
 * A readable name for a pi-subagents child, built from what Pi gives us: an
 * agent type and the task brief. Briefs usually open with setup — "Read
 * <path> and follow it exactly", "You are in a git worktree at <path>",
 * "Repo root: …" — so naming a run after its first words gives every run in a
 * batch the same useless name. This skips the setup sentences and names the
 * run after the first one that says what the job is.
 */
export function piSubagentName(input: {
  description?: string;
  task?: string;
  sessionName?: string;
  agent?: string;
}): string | undefined {
  const description = input.description?.trim();
  if (description) return description;
  const task = readableTask(input.task);
  const fromTask = task ? taskHeadline(task) : undefined;
  if (fromTask) return fromTask;
  // pi-subagents' own name is "<agent>: <first 60 chars of the task>"; with
  // the task redacted it is the best text left.
  const session = input.sessionName?.trim();
  if (session) {
    const agent = input.agent?.trim();
    const rest =
      agent && session.startsWith(`${agent}:`)
        ? session.slice(agent.length + 1)
        : session;
    const headline = taskHeadline(rest.replace(/(?:\.{3}|\u2026)$/, ""));
    if (headline) return headline;
  }
  const agent = input.agent?.trim();
  return agent ? formatAgentType(agent) : undefined;
}

/** pi-subagents hides task text from hosts behind this placeholder. */
export function readableTask(task: string | undefined): string | undefined {
  const text = task?.trim();
  return text && !/^\[[a-z ]*redacted\]$/i.test(text) ? text : undefined;
}

/** Sentences that set a run up rather than say what it is for. */
const SETUP = [
  // "Read <brief> and follow it exactly", "FIRST read the README fully"
  /^(?:first\s+)?read\b.*\b(?:follow|first|fully|before)\b/i,
  // "You are in a git worktree at …, on branch …"
  /^you(?:'re| are) (?:in|inside|on|working in)\b/i,
  /^(?:repo(?:sitory)? root|cwd|working directory|worktree|branch)\b[^:]*:/i,
  /^use (?:the )?worktree\b/i,
  /^(?:never|do not|don't|avoid)\b/i,
  /^final (?:message|answer|reply|output)\b/i,
];

/** The first sentence of a brief that names the job, cleaned for a row. */
export function taskHeadline(task: string): string | undefined {
  const sentences = splitSentences(task);
  const job = sentences.find((sentence) => !isSetup(sentence));
  const chosen = job ?? sentences[0];
  if (!chosen) return undefined;
  const cleaned = clean(chosen);
  return cleaned || undefined;
}

function isSetup(sentence: string): boolean {
  return SETUP.some((pattern) => pattern.test(sentence));
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) =>
      line
        // A sentence ends at . ! ? before a capital, a quote, a # or a digit;
        // `pr/437...pr/438` and `v1.2` stay whole.
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`#(])/),
    )
    .map((sentence) =>
      sentence
        .replace(/^[\s\-*\u2022\d.)]+(?=\S)/, (lead) =>
          // Keep a leading number that is the sentence ("2 bugs …"), drop list
          // markers ("1. ", "- ").
          /^\s*\d+\s/.test(lead) ? lead : "",
        )
        .trim(),
    )
    .filter(Boolean);
}

/** Absolute or deep paths read as their last part. */
const LONG_PATH =
  /(?:[A-Za-z]:)?(?:[\\/]?[\w.@~-]+){0,1}(?:[\\/][\w.@~<>-]+){2,}[\\/]?/g;

function clean(sentence: string): string {
  let text = sentence
    .replace(/`([^`]*)`/g, "$1")
    // pi-subagents cuts its own names mid-word, leaving a quote open.
    .replace(/`/g, "")
    .replace(LONG_PATH, (path) => {
      const parts = path.split(/[\\/]/).filter(Boolean);
      return parts[parts.length - 1] ?? path;
    })
    // Asides in parentheses are detail, not the name.
    .replace(/\s*\([^()]*\)/g, "")
    // "You are building X" names the job as "Building X".
    .replace(
      /^you(?:'re| are) (\w+ing)\b/i,
      (_, verb: string) =>
        verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase(),
    )
    // "Scope: …", "Task: …" label the brief rather than name it.
    .replace(/^(?:scope|task|goal|job|objective|context)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  text = firstClause(text).replace(/[\s,;:.\u2014-]+$/, "");
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  return text;
}

/** Names past this get cut back to their first clause. */
const CLAUSE_AT = 44;
const MIN_CLAUSE = 12;
const CLAUSE_BREAK =
  /\s+[\u2014\u2013]\s+|\s+-\s+|;\s+|,\s+|\s+(?:because|so that|since|then|and then|which|while|but)\s+/gi;

/** A long sentence read only up to its first break: "Run X, each as …" → "Run X". */
function firstClause(text: string): string {
  if (text.length <= CLAUSE_AT) return text;
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    if ((match.index ?? 0) >= MIN_CLAUSE) return text.slice(0, match.index);
  }
  return text;
}

/**
 * The launch row's title for a `subagent` call, before any child reports.
 * Batches and workflows name the group; a single run names its job.
 */
export function piSubagentLaunchTitle(
  input: Record<string, unknown>,
): string | undefined {
  const args =
    input.args && typeof input.args === "object"
      ? (input.args as Record<string, unknown>)
      : undefined;
  const tasks = Array.isArray(input.tasks)
    ? input.tasks
    : Array.isArray(args?.tasks)
      ? args.tasks
      : undefined;
  if (tasks) {
    const count = tasks.length;
    return count === 1 ? taskTitle(tasks[0]) : `${count} parallel subagents`;
  }
  const chain = Array.isArray(input.chain) ? input.chain : undefined;
  if (chain) return `Chain of ${chain.length} subagents`;
  if (input.workflow != null && input.workflow !== false) {
    const name =
      typeof input.workflow === "string" &&
      !/^(?:true|parallel)$/.test(input.workflow)
        ? input.workflow.split(/[\\/]/).pop()
        : undefined;
    return name ? `Workflow ${name}` : "Workflow";
  }
  return taskTitle(input);
}

function taskTitle(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const text = (key: string) =>
    typeof item[key] === "string" ? (item[key] as string) : undefined;
  return piSubagentName({
    description: text("description"),
    task: text("task"),
    agent: text("agent"),
  });
}
