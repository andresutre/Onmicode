// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWelcomeCompleted, openWelcome } from "../model/welcome";
import { useWelcome } from "./useWelcome";

let container: HTMLDivElement;
let root: Root;
let welcome: ReturnType<typeof useWelcome>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function Probe(boot: Parameters<typeof useWelcome>[0]) {
  welcome = useWelcome(boot);
  return null;
}

function mount(boot: Partial<Parameters<typeof useWelcome>[0]> = {}): void {
  act(() =>
    root.render(
      createElement(Probe, {
        transferred: false,
        resumed: false,
        sessions: 0,
        ...boot,
      }),
    ),
  );
}

describe("useWelcome", () => {
  it("opens on a fresh install and stays done once closed", () => {
    mount();
    expect(welcome.open).toBe(true);
    expect(loadWelcomeCompleted()).toBe(false);

    act(() => welcome.close());
    expect(welcome.open).toBe(false);
    expect(loadWelcomeCompleted()).toBe(true);
  });

  it("marks an existing user done on boot without opening", () => {
    localStorage.setItem(
      "monocode.recentProjects",
      JSON.stringify([{ path: "/work/app", openedAt: 1 }]),
    );
    mount();
    expect(welcome.open).toBe(false);
    expect(loadWelcomeCompleted()).toBe(true);
  });

  it("counts archived projects and a resumed workspace as an existing user", () => {
    localStorage.setItem(
      "monocode.archivedProjects",
      JSON.stringify([{ path: "/work/old", archivedAt: 1 }]),
    );
    mount();
    expect(welcome.open).toBe(false);

    act(() => root.unmount());
    localStorage.clear();
    root = createRoot(container);
    mount({ resumed: true });
    expect(welcome.open).toBe(false);
    expect(loadWelcomeCompleted()).toBe(true);
  });

  it("decides from the first render, before a project is remembered", () => {
    mount();
    localStorage.setItem(
      "monocode.recentProjects",
      JSON.stringify([{ path: "/launch/dir", openedAt: 1 }]),
    );
    mount();
    expect(welcome.open).toBe(true);
  });

  it("reopens from Settings or the palette", () => {
    localStorage.setItem("monocode.welcomeCompleted", "1");
    mount();
    expect(welcome.open).toBe(false);

    act(() => openWelcome());
    expect(welcome.open).toBe(true);
  });
});
