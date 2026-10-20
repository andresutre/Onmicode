import { useSyncExternalStore } from "react";
import type { VisualTheme } from "./visualDocument";

// Page-facing names, resolved to concrete colors: a page cannot see the app's
// own variables, and an unresolved `var()` or `color-mix()` means nothing there.
const THEME_COLORS: Record<string, string> = {
  "--background": "var(--color-background-base)",
  "--foreground": "var(--color-content)",
  // Blended against the background so they also work as solid colors.
  "--muted":
    "color-mix(in srgb, var(--color-content) 55%, var(--color-background-base))",
  "--surface":
    "color-mix(in srgb, var(--color-content) 5%, var(--color-background-base))",
  "--border":
    "color-mix(in srgb, var(--color-content) 12%, var(--color-background-base))",
  "--accent": "var(--color-accent)",
  "--link": "var(--link-color)",
  "--positive": "var(--color-diff-add)",
  "--negative": "var(--color-diff-del)",
};

const CHART_COLORS = [
  "var(--color-accent)",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#a78bfa",
  "#22d3ee",
];

const FALLBACK: VisualTheme = { scheme: "dark", vars: {} };

export function readVisualTheme(): VisualTheme {
  if (typeof document === "undefined" || !document.body) return FALLBACK;
  const root = document.documentElement;
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolve = (value: string) => {
    probe.style.color = value;
    return getComputedStyle(probe).color;
  };
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(THEME_COLORS))
    vars[name] = resolve(value);
  CHART_COLORS.forEach((value, index) => {
    vars[`--chart-${index + 1}`] = resolve(value);
  });
  probe.remove();
  const style = getComputedStyle(root);
  vars["--font-sans"] = style.getPropertyValue("--font-sans").trim();
  vars["--font-mono"] = style.getPropertyValue("--font-mono").trim();
  vars["--radius"] = "10px";
  return {
    scheme: root.classList.contains("theme-light") ? "light" : "dark",
    vars,
  };
}

// One observer serves every frame on screen, and the snapshot keeps its
// identity until a color actually changes.
let current: VisualTheme | null = null;
let currentKey = "";
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function refresh() {
  const next = readVisualTheme();
  const key = JSON.stringify(next);
  if (key === currentKey) return;
  current = next;
  currentKey = key;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
      current = null;
      currentKey = "";
    }
  };
}

export function getVisualTheme(): VisualTheme {
  if (!current) {
    current = readVisualTheme();
    currentKey = JSON.stringify(current);
  }
  return current;
}

/** The app theme as page variables, following theme and appearance changes. */
export function useVisualTheme(): VisualTheme {
  return useSyncExternalStore(subscribe, getVisualTheme, () => FALLBACK);
}
