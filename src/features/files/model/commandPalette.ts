import { fuzzyMatch, type FuzzyHit } from "../../../shared/lib/fuzzy";
import { projectName } from "../../../shared/lib/paths";
import {
  KEYBINDINGS,
  keybindingShortcutLabel,
} from "../../settings/model/settings";

export type PaletteGroup = "Commands" | "Sessions" | "Projects";

/** One row in the command palette. `id` is what `onRunAction` receives. */
export type PaletteItem = {
  id: string;
  label: string;
  group: PaletteGroup;
  /** Shortcut shown on the right, already formatted for this platform. */
  hint?: string;
  /** Secondary text, such as a session's project. */
  detail?: string;
  /** Extra words that should match but are not shown. */
  keywords?: string;
};

export type RankedPaletteItem = PaletteItem & FuzzyHit;

/** App commands the palette can run; ids are handled in App's `onRunAction`. */
const COMMANDS: { id: string; label: string; keybinding?: string; keywords?: string }[] = [
  { id: "new-session", label: "New Session", keybinding: "Tab: New", keywords: "tab chat" },
  { id: "open-project", label: "Open Project…", keybinding: "App: Open Project", keywords: "folder" },
  { id: "go-to-file", label: "Go to File…", keybinding: "App: Go to File", keywords: "open" },
  { id: "search", label: "Search Sessions", keybinding: "App: Search", keywords: "find history" },
  { id: "find-in-files", label: "Find in Files", keybinding: "App: Find in Files", keywords: "grep project" },
  { id: "inbox", label: "Open Inbox", keywords: "notifications" },
  { id: "notes", label: "Open Notes" },
  { id: "automations", label: "Open Automations", keywords: "schedule" },
  { id: "usage", label: "Open Usage", keywords: "limits quota rate plan accounts" },
  { id: "settings", label: "Open Settings", keybinding: "App: Settings", keywords: "preferences" },
  { id: "keybindings", label: "Keyboard Shortcuts", keywords: "keybindings settings" },
  { id: "toggle-sidebar", label: "Toggle Sidebar", keybinding: "App: Toggle Sidebar" },
  { id: "toggle-session-sidebar", label: "Toggle Session Sidebar", keybinding: "App: Toggle Session Sidebar" },
  { id: "split-right", label: "Split Right", keybinding: "Pane: Split Right", keywords: "pane" },
  { id: "split-down", label: "Split Down", keybinding: "Pane: Split Down", keywords: "pane" },
  { id: "new-terminal", label: "New Terminal", keybinding: "Terminal: New", keywords: "shell" },
  { id: "new-terminal-tab", label: "New Terminal Tab", keybinding: "Terminal: New Tab", keywords: "shell" },
  { id: "toggle-terminal", label: "Toggle Terminal Dock", keybinding: "Terminal: Toggle Dock", keywords: "shell" },
  { id: "close-other-tabs", label: "Close Other Tabs", keybinding: "Tab: Close Others" },
  { id: "close-all-tabs", label: "Close All Tabs", keybinding: "Tab: Close All" },
  { id: "zoom-in", label: "Zoom In", keybinding: "View: Zoom In", keywords: "bigger scale" },
  { id: "zoom-out", label: "Zoom Out", keybinding: "View: Zoom Out", keywords: "smaller scale" },
  { id: "zoom-reset", label: "Reset Zoom", keybinding: "View: Reset Zoom", keywords: "scale" },
  { id: "new-window", label: "New Window", keybinding: "App: New Window" },
  { id: "copy-prompt-link", label: "Copy Prompt Link", keywords: "share draft url" },
  { id: "copy-prompt-link-context", label: "Copy Prompt Link with Project and Model", keywords: "share draft url agent repository" },
  { id: "check-updates", label: "Check for Updates", keywords: "upgrade version" },
  { id: "show-welcome", label: "Show Welcome", keywords: "setup onboarding getting started agents" },
  { id: "reload", label: "Reload Onmicode", keybinding: "View: Reload", keywords: "refresh" },
];

function shortcut(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const row = KEYBINDINGS.find((binding) => binding.command === command);
  if (!row) return undefined;
  return keybindingShortcutLabel(command, row.keys) ?? undefined;
}

export function paletteCommands(): PaletteItem[] {
  return COMMANDS.map(({ id, label, keybinding, keywords }) => ({
    id,
    label,
    group: "Commands",
    hint: shortcut(keybinding),
    keywords,
  }));
}

/** How many sessions or projects to list before the user types. */
export const PALETTE_RECENT_LIMIT = 8;
/** How many sessions or projects to list for a query. */
export const PALETTE_MATCH_LIMIT = 20;

export function paletteSessions(
  sessions: { id: string; title: string; cwd: string; updatedAt: number; archived?: boolean; draft?: boolean; sidebarHidden?: boolean }[],
): PaletteItem[] {
  return sessions
    .filter((session) => !session.archived && !session.draft && !session.sidebarHidden && session.title.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((session) => ({
      id: `session:${session.id}`,
      label: session.title.trim(),
      group: "Sessions" as const,
      detail: projectName(session.cwd),
    }));
}

export function paletteProjects(paths: string[]): PaletteItem[] {
  return paths.map((path) => ({
    id: `project:${path}`,
    label: projectName(path),
    group: "Projects" as const,
    detail: path,
  }));
}

/**
 * Filters and orders palette items. With no query: every command, then the
 * most recent sessions and projects. With a query: fuzzy matches by score,
 * commands first on ties, each group capped.
 */
export function rankPaletteItems(
  items: PaletteItem[],
  query: string,
): RankedPaletteItem[] {
  const q = query.trim();
  const counts = new Map<PaletteGroup, number>();
  const take = (item: PaletteItem, limit: number) => {
    if (item.group === "Commands") return true;
    const count = counts.get(item.group) ?? 0;
    if (count >= limit) return false;
    counts.set(item.group, count + 1);
    return true;
  };
  if (!q) {
    return items
      .filter((item) => take(item, PALETTE_RECENT_LIMIT))
      .map((item) => ({ ...item, score: 0, positions: [] }));
  }
  const order: Record<PaletteGroup, number> = { Commands: 0, Sessions: 1, Projects: 2 };
  const ranked = items.flatMap((item): RankedPaletteItem[] => {
    const hit = fuzzyMatch(q, item.label);
    if (hit) return [{ ...item, ...hit }];
    const extra = [item.keywords, item.detail].filter(Boolean).join(" ");
    const loose = extra ? fuzzyMatch(q, extra) : null;
    // Matched only on hidden words: rank low and highlight nothing.
    return loose ? [{ ...item, score: loose.score - 1000, positions: [] }] : [];
  });
  ranked.sort(
    (a, b) => b.score - a.score || order[a.group] - order[b.group],
  );
  return ranked.filter((item) => take(item, PALETTE_MATCH_LIMIT));
}
