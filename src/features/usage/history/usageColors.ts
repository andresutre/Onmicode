/**
 * One colour per agent, fixed so an agent keeps its colour whatever else is
 * in the period. The eight hues are a categorical palette validated for
 * colour-blind separation between neighbours, with a darker-surface step for
 * the dark theme, so stacks are always drawn in slot order. Agents past the
 * eighth share a neutral "Other" series in the chart; tables still list them
 * by name.
 */
export type AgentSeries = {
  key: string;
  /** SVG fill for chart marks. */
  fill: string;
  /** Background for legend swatches and table bars. */
  swatch: string;
};

// Full class strings, so Tailwind finds them when it scans the source.
const SLOTS: Omit<AgentSeries, "key">[] = [
  {
    fill: "fill-[#2a78d6] dark:fill-[#3987e5]",
    swatch: "bg-[#2a78d6] dark:bg-[#3987e5]",
  },
  {
    fill: "fill-[#eb6834] dark:fill-[#d95926]",
    swatch: "bg-[#eb6834] dark:bg-[#d95926]",
  },
  {
    fill: "fill-[#1baf7a] dark:fill-[#199e70]",
    swatch: "bg-[#1baf7a] dark:bg-[#199e70]",
  },
  {
    fill: "fill-[#eda100] dark:fill-[#c98500]",
    swatch: "bg-[#eda100] dark:bg-[#c98500]",
  },
  {
    fill: "fill-[#e87ba4] dark:fill-[#d55181]",
    swatch: "bg-[#e87ba4] dark:bg-[#d55181]",
  },
  {
    fill: "fill-[#008300] dark:fill-[#008300]",
    swatch: "bg-[#008300] dark:bg-[#008300]",
  },
  {
    fill: "fill-[#6250d6] dark:fill-[#9085e9]",
    swatch: "bg-[#6250d6] dark:bg-[#9085e9]",
  },
  {
    fill: "fill-[#e34948] dark:fill-[#e66767]",
    swatch: "bg-[#e34948] dark:bg-[#e66767]",
  },
];

const OTHER: Omit<AgentSeries, "key"> = {
  fill: "fill-content/35",
  swatch: "bg-content/35",
};

/** Agents most likely to report tokens get the eight hues, in this order. */
const AGENT_ORDER = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "grok",
  "antigravity",
  "devin",
  "omp",
];

export const OTHER_AGENTS = "other";

/** Chart series an agent belongs to: its own, or the shared "Other". */
export function agentSeriesKey(harness: string): string {
  return AGENT_ORDER.includes(harness) ? harness : OTHER_AGENTS;
}

export function agentSeries(key: string): AgentSeries {
  const slot = AGENT_ORDER.indexOf(key);
  return { key, ...(slot >= 0 ? SLOTS[slot] : OTHER) };
}

/** Stack and legend order: palette slots first, "Other" last. */
export function compareAgentSeries(a: string, b: string): number {
  const rank = (key: string) => {
    const slot = AGENT_ORDER.indexOf(key);
    return slot >= 0 ? slot : AGENT_ORDER.length;
  };
  return rank(a) - rank(b);
}
