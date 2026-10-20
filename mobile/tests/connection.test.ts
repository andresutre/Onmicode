import { describe, expect, it } from "vitest";
import {
  normalizeSelection,
  selectedWorkspace,
} from "@/features/connection/selection";
import { parseInvitation } from "@/features/connection/invitation";
const catalog = {
  projects: [{ id: "a" }, { id: "b" }],
  sessions: [
    { id: "s1", projectId: "a" },
    { id: "s2", projectId: "b" },
  ],
};
describe("mobile workspace choices", () => {
  it("keeps only the chosen projects and their sessions", () => {
    const selected = selectedWorkspace(catalog, { projectIds: ["a"] });
    expect(selected.projects).toEqual([{ id: "a" }]);
    expect(selected.sessions.map((session) => session.id)).toEqual(["s1"]);
  });
  it("preserves an explicit empty choice on restore", () => {
    const restored = normalizeSelection(
      JSON.parse(JSON.stringify({ projectIds: [] })),
    );
    expect(restored).toEqual({ projectIds: [] });
    expect(selectedWorkspace(catalog, restored).projects).toEqual([]);
    expect(normalizeSelection({ projectIds: "all" })).toBeNull();
  });
  it("retains unavailable choices so they can reappear when a desktop project returns", () => {
    const chosen = normalizeSelection({
      projectIds: ["a", "a", 5, "later"],
      // Saved by older versions that had Monos; ignored now.
      monoIds: ["m"],
    });
    expect(chosen).toEqual({ projectIds: ["a", "later"] });
    expect(
      selectedWorkspace(
        { ...catalog, projects: [...catalog.projects, { id: "later" }] },
        chosen,
      ).projects,
    ).toEqual([{ id: "a" }, { id: "later" }]);
  });
});
const invitation = {
  version: 1,
  name: "Desktop 🖥",
  fingerprint: "a".repeat(64),
  addresses: [{ host: "desktop.example", port: 38416 }],
  identity: { certificate: "certificate", privateKey: "temporary-key" },
  expires: Date.now() / 1000 + 900,
};
function link(value: unknown) {
  return (
    "monocode://pair?i=" +
    Buffer.from(JSON.stringify(value)).toString("base64url")
  );
}
describe("QR invitation", () => {
  it("accepts the one-use desktop scheme and UTF-8 names", () =>
    expect(parseInvitation(link(invitation))).toEqual(invitation));
  it("rejects expired codes, foreign links and invalid endpoints before pairing", () => {
    expect(() => parseInvitation(link({ ...invitation, expires: 1 }))).toThrow(
      "expired",
    );
    expect(() => parseInvitation("https://example.com/?i=abc")).toThrow();
    expect(() =>
      parseInvitation(
        link({ ...invitation, addresses: [{ host: "host", port: 0 }] }),
      ),
    ).toThrow();
    expect(() =>
      parseInvitation(link({ ...invitation, fingerprint: "bad" })),
    ).toThrow();
  });
});
