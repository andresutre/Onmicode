import { hasReadableText } from "../../../../features/sessions/model/transcriptActivity";
import type { HarnessEvent } from "../../core/types";
import {
  asRecord,
  previewFromTool,
  stringField,
  textFromContent,
  toolKindFromName,
  toolTitle,
} from "./piProtocol";
import { piSubagentName } from "./piSubagentName";

/**
 * A `subagent` call that launches several runs. Its own row is the group's
 * heading, not a run, and must keep that kind on every update: a row whose
 * kind flips moves in and out of the ticker and the transcript each time.
 */
export function isPiSubagentBatch(input: Record<string, unknown>): boolean {
  return (
    Array.isArray(input.tasks) ||
    Array.isArray(asRecord(input.args)?.tasks) ||
    Array.isArray(input.chain) ||
    (input.workflow != null && input.workflow !== false)
  );
}

/** Pi extension results and omp TaskToolDetails are cumulative snapshots. */
export function piSubagentEvents(
  callId: string,
  input: Record<string, unknown>,
  result: unknown,
  completed: boolean,
  isError = false,
): HarnessEvent[] {
  const details = asRecord(asRecord(result)?.details);
  if (!details) return [];
  const results = records(details.results);
  const progress = records(details.progress);
  const inputTasks = records(
    Array.isArray(input.tasks) ? input.tasks : asRecord(input.args)?.tasks,
  );
  const entries = progress.length
    ? progress
    : results.length
      ? results
      : workflowChildEntries(details, inputTasks);
  if (!entries.length) return [];
  const batch = entries.length > 1 || isPiSubagentBatch(input);
  const events: HarnessEvent[] = [];
  if (batch) {
    events.push({
      type: "tool.updated",
      callId,
      kind: "other",
    });
  }
  entries.forEach((entry, index) => {
    // A workflow's children all report index 0; their workflow key tells
    // them apart.
    const key = stringField(entry, "workflowKey") ?? entry.index ?? index;
    const rowId = batch ? `${callId}:agent:${key}` : callId;
    const final = progress.length
      ? (results.find(
          (item) =>
            (item.id === entry.id && item.id != null) ||
            (item.workflowKey != null &&
              item.workflowKey === entry.workflowKey) ||
            item.index === key,
        ) ?? {})
      : entry;
    const failed =
      entry.status === "failed" ||
      entry.status === "aborted" ||
      final.aborted === true ||
      final.stopReason === "error" ||
      final.stopReason === "aborted" ||
      (typeof final.exitCode === "number" && final.exitCode > 0) ||
      (completed && isError && final.exitCode == null && entry.status == null);
    const background = asRecord(details.async)?.state === "running";
    const status = failed
      ? "failed"
      : entry.status === "completed" || (completed && !background)
        ? "completed"
        : "in_progress";
    const name =
      piSubagentName({
        description: stringField(entry, "description"),
        task: stringField(entry, "task"),
        sessionName: stringField(entry, "sessionName"),
        agent: stringField(entry, "agent"),
      }) ?? "Subagent";
    const agentType = stringField(entry, "agent");
    const model =
      stringField(entry, "model") ??
      stringField(final, "model") ??
      records(final.messages)
        .filter((message) => message.role === "assistant")
        .map((message) => stringField(message, "model"))
        .filter(Boolean)
        .slice(-1)[0];
    const report =
      stringField(final, "output") ??
      stringField(final, "errorMessage") ??
      stringField(final, "error") ??
      (failed
        ? (stringField(final, "stderr") ?? "Subagent failed.")
        : undefined);
    events.push({
      type: "tool.updated",
      callId: rowId,
      kind: "agent",
      title: name,
      status,
      ...(model ? { agentModel: model } : {}),
      ...(report ? { detail: report } : {}),
    });
    const emit = (
      step: Omit<
        Extract<HarnessEvent, { type: "agent.step" }>,
        "type" | "callId" | "agentName" | "agentType"
      >,
    ) => {
      events.push({
        type: "agent.step",
        callId: rowId,
        agentName: name,
        agentType,
        ...step,
      });
    };
    const messages = records(final.messages);
    const toolResults = new Map(
      records(final.messages)
        .filter((message) => message.role === "toolResult")
        .map((message) => [message.toolCallId, message]),
    );
    messages.forEach((message, messageIndex) => {
      if (message.role !== "assistant") return;
      records(message.content).forEach((part, partIndex) => {
        const stepId = `${rowId}:message:${messageIndex}:${partIndex}`;
        if (part.type === "text" || part.type === "thinking") {
          const text = stringField(
            part,
            part.type === "text" ? "text" : "thinking",
          );
          if (text && (part.type === "thinking" || hasReadableText(text)))
            emit({
              stepId,
              kind: part.type === "text" ? "message" : "reasoning",
              text,
            });
        } else if (part.type === "toolCall") {
          const id = stringField(part, "id");
          const tool = stringField(part, "name") ?? "tool";
          const args = asRecord(part.arguments) ?? {};
          const outcome = toolResults.get(id);
          const output = textFromContent(outcome?.content);
          emit({
            stepId: `${rowId}:tool:${id ?? `${messageIndex}:${partIndex}`}`,
            kind: "tool",
            text: toolTitle(tool, args),
            toolKind: toolKindFromName(tool),
            status: outcome
              ? outcome.isError
                ? "failed"
                : "completed"
              : status === "in_progress"
                ? "in_progress"
                : status,
            // Only a failure earns detail: a preview's output is never shown
            // on the row, so this is the one place the error can be read.
            ...(outcome?.isError && output ? { detail: output } : {}),
            preview: previewFromTool(tool, args, output),
          });
        }
      });
    });
    // omp reports newest-first bounded tails and an increasing toolCount.
    const count = typeof entry.toolCount === "number" ? entry.toolCount : 0;
    const current = stringField(entry, "currentTool");
    records(entry.recentTools)
      .slice()
      .reverse()
      .forEach((tool, index, all) => {
        const name = stringField(tool, "tool");
        if (!name) return;
        const number = count - (current ? 1 : 0) - all.length + index + 1;
        emit({
          stepId: `${rowId}:tool:${number}`,
          kind: "tool",
          text: [name, stringField(tool, "args")].filter(Boolean).join(" "),
          toolKind: toolKindFromName(name),
          status: "completed",
        });
      });
    if (current)
      emit({
        stepId: `${rowId}:tool:${count}`,
        kind: "tool",
        text: [current, stringField(entry, "currentToolArgs")]
          .filter(Boolean)
          .join(" "),
        toolKind: toolKindFromName(current),
        status,
      });
    const output = Array.isArray(entry.recentOutput)
      ? entry.recentOutput
          .filter((line): line is string => typeof line === "string")
          .slice()
          .reverse()
          .join("\n")
      : "";
    if (output)
      emit({
        stepId: `${rowId}:output:${entry.requests ?? count}`,
        kind: "message",
        text: output,
      });
  });
  return events;
}

/**
 * A running workflow lists its children only in `workflowChildren`, and only
 * by key and state; the brief comes from the call's own tasks (`task-N` is
 * the Nth task).
 */
function workflowChildEntries(
  details: Record<string, unknown>,
  inputTasks: Record<string, unknown>[],
): Record<string, unknown>[] {
  const children = records(asRecord(details.workflowChildren)?.children);
  return children.map((child, index) => {
    const key = stringField(child, "childId") ?? `task-${index + 1}`;
    const number = /^task-(\d+)$/.exec(key)?.[1];
    const task = inputTasks[number ? Number(number) - 1 : index] ?? {};
    const agent = stringField(child, "agent") ?? stringField(task, "agent");
    const sessionName = stringField(child, "sessionName");
    const state = stringField(child, "state");
    return {
      ...task,
      workflowKey: key,
      ...(agent ? { agent } : {}),
      ...(sessionName ? { sessionName } : {}),
      ...(state ? { status: state } : {}),
    };
  });
}

/** One background run from pi-subagents' async status widget. */
export type PiBackgroundRun = {
  id: string;
  label: string;
  state: string;
  model?: string;
  currentTool?: string;
  turnCount?: number;
};

const ASYNC_WIDGET_KEY = "subagent-async";
const ASYNC_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const ACTIVE_RUN_STATES = new Set(["queued", "running", "paused"]);

export function isActiveRunState(state: string): boolean {
  return ACTIVE_RUN_STATES.has(state);
}

export function runRowStatus(state: string): string {
  if (isActiveRunState(state)) return "in_progress";
  return state === "complete" || state === "completed" ? "completed" : "failed";
}

export type PiBackgroundSnapshot = {
  runs: PiBackgroundRun[];
  /**
   * Every run in the session is listed. pi-subagents caps the snapshot (20
   * runs, 32 KB) and counts what it left out; a run missing from a partial
   * snapshot may still be going.
   */
  complete: boolean;
};

/**
 * pi-subagents reports its background runs through a `subagent-async` widget
 * whose line is a JSON snapshot of the session's runs. Returns null for any
 * other frame, and no runs once the widget is cleared.
 */
export function piBackgroundRunsFromFrame(
  rec: Record<string, unknown>,
): PiBackgroundSnapshot | null {
  if (
    rec.type !== "extension_ui_request" ||
    rec.method !== "setWidget" ||
    rec.widgetKey !== ASYNC_WIDGET_KEY
  )
    return null;
  const line = Array.isArray(rec.widgetLines)
    ? rec.widgetLines.find(
        (item): item is string =>
          typeof item === "string" && item.startsWith(ASYNC_WIDGET_PREFIX),
      )
    : undefined;
  if (!line) return { runs: [], complete: true };
  let snapshot: Record<string, unknown> | null;
  try {
    snapshot = asRecord(JSON.parse(line.slice(ASYNC_WIDGET_PREFIX.length)));
  } catch {
    return null;
  }
  if (!snapshot || !Array.isArray(snapshot.runs)) return null;
  const omitted = asRecord(snapshot.omitted);
  // Missing counts are read as nothing omitted, as before they existed.
  const complete =
    !(typeof omitted?.runs === "number" && omitted.runs > 0) &&
    omitted?.byteLimitExceeded !== true;
  const runs = records(snapshot.runs).flatMap<PiBackgroundRun>((run) => {
    const id = stringField(run, "id");
    const state = stringField(run, "state");
    if (!id || !state) return [];
    const activity = asRecord(run.activity);
    const currentTool = stringField(activity, "currentTool");
    const turnCount = activity?.turnCount;
    const model = stringField(run, "model");
    return [
      {
        id,
        label:
          stringField(run, "label") ?? stringField(run, "agent") ?? "Subagent",
        state,
        ...(model ? { model } : {}),
        ...(currentTool ? { currentTool } : {}),
        ...(typeof turnCount === "number" ? { turnCount } : {}),
      },
    ];
  });
  return { runs, complete };
}

/** The folder where pi-subagents keeps a detached run's status files. */
export function piAsyncRunDir(result: unknown): string | undefined {
  return stringField(asRecord(asRecord(result)?.details), "asyncDir");
}

/** One step of a background run, from the run's `status.json`. */
export type PiRunStep = {
  entry: Record<string, unknown>;
  /** The child's own Pi session log, where its messages are. */
  sessionFile?: string;
};

/** A background run's `status.json`, or null if unreadable. */
export function piRunStatus(
  statusJson: string,
): { state?: string; steps: PiRunStep[] } | null {
  let status: Record<string, unknown> | null;
  try {
    status = asRecord(JSON.parse(statusJson));
  } catch {
    return null;
  }
  if (!status) return null;
  const state = stringField(status, "state");
  const steps = records(status.steps).map((entry, index) => {
    const sessionFile = stringField(entry, "sessionFile");
    return {
      entry: { ...entry, index },
      ...(sessionFile ? { sessionFile } : {}),
    };
  });
  return { ...(state ? { state } : {}), steps };
}

/**
 * The messages in a child's session log. The log is still being written, so
 * a last line cut off mid-write is skipped.
 */
export function piSessionMessages(jsonl: string): Record<string, unknown>[] {
  return jsonl.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const record = asRecord(JSON.parse(line));
      const message = record?.type === "message" && asRecord(record.message);
      return message ? [message] : [];
    } catch {
      return [];
    }
  });
}

/**
 * What a background run's subagents have done so far, as the same events a
 * foreground run reports. `messages` lines up with `steps`.
 */
export function piBackgroundProgressEvents(
  callId: string,
  input: Record<string, unknown>,
  steps: PiRunStep[],
  messages: Array<Record<string, unknown>[] | undefined>,
): HarnessEvent[] {
  if (!steps.length) return [];
  const results = steps.map(({ entry }, index) => {
    const own = messages[index] ?? [];
    // The status file's own tool tail repeats what the messages already show.
    const { recentTools, recentOutput, currentTool, ...rest } = entry;
    return {
      ...(own.length ? rest : entry),
      status: stepStatus(stringField(entry, "status")),
      messages: own,
    };
  });
  const running = results.some((step) => step.status === "running");
  return piSubagentEvents(
    callId,
    input,
    { details: { results, async: { state: running ? "running" : "done" } } },
    !running,
  );
}

function stepStatus(status: string | undefined): string {
  if (status === "complete" || status === "completed") return "completed";
  if (status === "failed" || status === "aborted" || status === "stopped")
    return "failed";
  return "running";
}

/** The run id a detached `subagent` launch returned, if it detached. */
export function piAsyncRunId(result: unknown): string | undefined {
  return stringField(asRecord(asRecord(result)?.details), "asyncId");
}

export type PiSubagentNotice = {
  runs: Array<{ runId: string; status?: string }>;
  /** What the parent was told, without the instructions addressed to it. */
  report: string;
};

/** pi-subagents' `subagent-notify` message: background runs that ended. */
export function piSubagentNotice(
  message: Record<string, unknown>,
): PiSubagentNotice | null {
  if (message.role !== "custom" || message.customType !== "subagent-notify")
    return null;
  const runs = records(asRecord(message.details)?.runs).flatMap((run) => {
    const runId = stringField(run, "runId");
    const status = stringField(run, "status");
    return runId ? [{ runId, ...(status ? { status } : {}) }] : [];
  });
  const content =
    typeof message.content === "string"
      ? message.content
      : textFromContent(message.content);
  const report = content.split(/\n\nParent action:/)[0]?.trim() ?? "";
  return { runs, report };
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap<Record<string, unknown>>((item) => asRecord(item) ?? [])
    : [];
}
