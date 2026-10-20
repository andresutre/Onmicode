export type MobileSelection = { projectIds: string[] };

export function normalizeSelection(value: unknown): MobileSelection | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.projectIds)) return null;
  return {
    projectIds: [
      ...new Set(
        item.projectIds.filter(
          (value): value is string => typeof value === "string",
        ),
      ),
    ],
  };
}
export function selectedWorkspace<
  T extends {
    projects: { id: string }[];
    sessions: { projectId: string }[];
  },
>(catalog: T, selection: MobileSelection | null) {
  const projects = new Set(selection?.projectIds ?? []);
  return {
    ...catalog,
    projects: catalog.projects.filter((project) => projects.has(project.id)),
    sessions: catalog.sessions.filter((session) =>
      projects.has(session.projectId),
    ),
  };
}
