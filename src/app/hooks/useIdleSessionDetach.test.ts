// @vitest-environment happy-dom
import {
  act,
  createElement,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushSessionWrites,
  upsertSession,
  type SessionRecord,
} from "../../features/sessions/data/sessionStore";
import { useUnseenFinishedSessions } from "../../features/sessions/hooks/useUnseenFinishedSessions";
import { liveAgentsFromSessions } from "../../features/sessions/model/liveAgents";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import {
  newTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { useIdleSessionDetach } from "./useIdleSessionDetach";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  forgetHarnessSession: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../integrations/harness/core/registry", () => ({
  forgetHarnessSession: mocks.forgetHarnessSession,
}));

let root: Root | undefined;
let container: HTMLDivElement;
let stored: Map<string, SessionRecord>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mocks.forgetHarnessSession.mockReset().mockResolvedValue(undefined);
  stored = new Map();
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "session_upsert") {
      const record = structuredClone({
        ...args.session,
        createdAt: 1,
        updatedAt: 2,
      });
      stored.set(record.id, record);
      return record;
    }
    if (command === "session_get") {
      return structuredClone(stored.get(args.sessionId) ?? null);
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root?.unmount());
  container.remove();
  await flushSessionWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chat(id: string, patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/repo"),
    id,
    blocks: [
      { id: `${id}-user`, role: "user", text: "Review the assigned files" },
      {
        id: `${id}-answer`,
        role: "assistant",
        text: "The assignment is complete.",
      },
    ],
    ...patch,
  };
}

type WorkspaceState = {
  sessions: Session[];
  tabs: WorkspaceTab[];
  busySessionIds: ReadonlySet<string>;
  activeSessionId: string;
  liveAgentsEnabled: boolean;
};

function mountWorkspace(initial: Partial<WorkspaceState> = {}) {
  let props: WorkspaceState = {
    sessions: [chat("lead", { busy: true }), chat("other")],
    tabs: [newTab("lead"), newTab("other")],
    busySessionIds: new Set(["lead"]),
    activeSessionId: "other",
    liveAgentsEnabled: true,
    ...initial,
  };
  const sessionsRef = { current: props.sessions };
  const tabsRef = { current: props.tabs };
  const openingSessionIds = { current: new Set<string>() };
  const loadedSessionCache = { current: new Map<string, Session>() };
  const skipForgetSessionIds = { current: new Set<string>() };
  const persistSession = vi.fn((session: Session | undefined) => {
    if (session) void upsertSession(session);
  });
  let snapshot!: {
    sessions: Session[];
    unseenFinishedIds: Set<string>;
    setSessions: Dispatch<SetStateAction<Session[]>>;
  };

  function Workspace(state: WorkspaceState) {
    const [sessions, setSessions] = useState(state.sessions);
    sessionsRef.current = sessions;
    tabsRef.current = state.tabs;
    const unseenFinishedIds = useUnseenFinishedSessions(
      sessions,
      state.busySessionIds,
      state.activeSessionId,
    );
    useIdleSessionDetach({
      ...state,
      sessions,
      sessionsRef,
      tabsRef,
      unseenFinishedIds,
      openingSessionIds,
      loadedSessionCache,
      skipForgetSessionIds,
      persistSession,
      setSessions,
    });
    snapshot = { sessions, unseenFinishedIds, setSessions };
    return null;
  }

  act(() => root!.render(createElement(Workspace, props)));
  const update = (patch: Partial<WorkspaceState>) => {
    props = { ...props, ...patch };
    act(() => {
      if (patch.sessions) snapshot.setSessions(patch.sessions);
      root!.render(createElement(Workspace, props));
    });
  };
  return {
    snapshot: () => snapshot,
    update,
    finish: () =>
      update({
        sessions: snapshot.sessions.map((session) => ({
          ...session,
          busy: false,
        })),
        busySessionIds: new Set(),
      }),
    persistSession,
    openingSessionIds: openingSessionIds.current,
    cache: loadedSessionCache.current,
    skipForgetSessionIds: skipForgetSessionIds.current,
  };
}

async function advance(milliseconds = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await flushSessionWrites();
}

describe("idle session detachment", () => {
  it("keeps ordinary unseen finished chats until they are focused", async () => {
    const workspace = mountWorkspace({
      sessions: [chat("ordinary", { busy: true }), chat("other")],
      tabs: [newTab("other")],
      busySessionIds: new Set(["ordinary"]),
    });
    workspace.finish();
    await advance();
    expect(workspace.snapshot().unseenFinishedIds).toEqual(
      new Set(["ordinary"]),
    );
    expect(mocks.forgetHarnessSession).not.toHaveBeenCalled();

    workspace.update({
      tabs: [newTab("ordinary")],
      activeSessionId: "ordinary",
    });
    await advance();
    expect(workspace.snapshot().unseenFinishedIds.size).toBe(0);
    expect(mocks.forgetHarnessSession).not.toHaveBeenCalledWith(
      "claude",
      "ordinary",
    );
    workspace.update({ tabs: [], activeSessionId: "other" });
    await advance();
    expect(
      workspace.snapshot().sessions.map((session) => session.id),
    ).not.toContain("ordinary");
    expect(mocks.forgetHarnessSession).toHaveBeenCalledWith(
      "claude",
      "ordinary",
    );
  });

  it("does not retain unseen finished chats when Live Agents is disabled", async () => {
    const workspace = mountWorkspace({
      sessions: [chat("ordinary", { busy: true }), chat("other")],
      tabs: [newTab("other")],
      busySessionIds: new Set(["ordinary"]),
    });
    workspace.finish();
    await advance();
    workspace.update({ liveAgentsEnabled: false });
    await advance();
    expect(workspace.snapshot().sessions.map((session) => session.id)).toEqual([
      "other",
    ]);
    expect(mocks.forgetHarnessSession).toHaveBeenCalledExactlyOnceWith(
      "claude",
      "ordinary",
    );
  });

  it("keeps inbox discussions mounted without marking them unseen", async () => {
    const workspace = mountWorkspace({
      sessions: [chat("inbox", { inboxAsk: true, busy: true }), chat("other")],
      tabs: [newTab("other")],
      busySessionIds: new Set(["inbox"]),
    });
    workspace.finish();
    await advance();
    expect(workspace.snapshot().unseenFinishedIds.size).toBe(0);
    expect(
      workspace.snapshot().sessions.map((session) => session.id),
    ).toContain("inbox");
    expect(workspace.persistSession).not.toHaveBeenCalled();
    expect(mocks.forgetHarnessSession).not.toHaveBeenCalled();
  });

  it("cancels pending detachment when the workspace unmounts", async () => {
    const workspace = mountWorkspace();
    workspace.finish();
    workspace.update({ tabs: [newTab("other")] });
    act(() => root!.unmount());
    root = undefined;
    await advance();
    expect(workspace.persistSession).not.toHaveBeenCalled();
    expect(mocks.forgetHarnessSession).not.toHaveBeenCalled();
  });
});
