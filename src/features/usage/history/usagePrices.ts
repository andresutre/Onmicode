/** List price in USD per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type TokenCounts = {
  /** Input that was neither read from nor written to the cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type CostByType = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Anthropic bills a five-minute cache write at 1.25x input. */
function anthropic(input: number, output: number, cacheRead: number) {
  return { input, output, cacheRead, cacheWrite: input * 1.25 };
}

/** Most other providers charge nothing extra to write the cache. */
function price(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite = input,
): ModelPrice {
  return { input, output, cacheRead, cacheWrite };
}

function same(keys: string[], value: ModelPrice): [string, ModelPrice][] {
  return keys.map((key) => [key, value]);
}

/**
 * Standard-tier API list prices, checked against Anthropic's model docs and
 * LiteLLM's published price list on 2026-10-20. Bundled so the page never
 * goes online. Long-context tiers, fast modes, batch discounts and
 * subscription plans are not modelled: what a turn actually cost may differ,
 * which is why the page calls this an estimate.
 */
const PRICES = new Map<string, ModelPrice>([
  // Anthropic
  ...same(["claude-fable-5-1", "claude-mythos-5-1"], anthropic(10, 50, 0.25)),
  ...same(["claude-fable-5", "claude-mythos-5"], anthropic(10, 50, 1)),
  ["claude-opus-5-5", anthropic(4, 20, 0.2)],
  ...same(
    [
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
    ],
    anthropic(5, 25, 0.5),
  ),
  ...same(
    ["claude-opus-4-1", "claude-opus-4", "claude-opus-4-0"],
    anthropic(15, 75, 1.5),
  ),
  ...same(["claude-sonnet-5-5", "claude-sonnet-5"], anthropic(2, 10, 0.2)),
  ...same(
    [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4",
      "claude-sonnet-4-0",
      "claude-sonnet-3-7",
    ],
    anthropic(3, 15, 0.3),
  ),
  ["claude-haiku-5-5", anthropic(0.1, 0.5, 0.01)],
  ["claude-haiku-4-5", anthropic(1, 5, 0.1)],
  ["claude-haiku-3-5", anthropic(0.8, 4, 0.08)],
  ["claude-haiku-3", anthropic(0.25, 1.25, 0.03)],
  // OpenAI
  ["gpt-6.1-sol", price(2, 10, 0.1, 2.5)],
  ["gpt-6-sol", price(2, 10, 0.2, 2.5)],
  ["gpt-6-luna", price(0.1, 0.5, 0.01, 0.125)],
  ["gpt-6-astra", price(10, 50, 1, 12.5)],
  ...same(["gpt-5.6", "gpt-5.6-sol"], price(4, 20, 0.4, 5)),
  ["gpt-5.6-terra", price(2, 12, 0.2, 2.5)],
  ["gpt-5.6-luna", price(0.2, 1.2, 0.02, 0.25)],
  ["gpt-5.5", price(5, 30, 0.5)],
  ["gpt-5.4", price(2.5, 15, 0.25)],
  ["gpt-5.4-mini", price(0.75, 4.5, 0.075)],
  ["gpt-5.4-nano", price(0.2, 1.25, 0.02)],
  ...same(
    ["gpt-5.3-codex", "gpt-5.2", "gpt-5.2-codex"],
    price(1.75, 14, 0.175),
  ),
  ...same(
    ["gpt-5.1", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5", "gpt-5-codex"],
    price(1.25, 10, 0.125),
  ),
  ...same(["gpt-5.1-codex-mini", "gpt-5-mini"], price(0.25, 2, 0.025)),
  ["gpt-5-nano", price(0.05, 0.4, 0.005)],
  ["gpt-4.1", price(2, 8, 0.5)],
  ["gpt-4.1-mini", price(0.4, 1.6, 0.1)],
  ["gpt-4.1-nano", price(0.1, 0.4, 0.025)],
  ["gpt-4o", price(2.5, 10, 1.25)],
  ["gpt-4o-mini", price(0.15, 0.6, 0.075)],
  ["o3", price(2, 8, 0.5)],
  ["o4-mini", price(1.1, 4.4, 0.275)],
  // Google
  ...same(
    ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"],
    price(0.75, 3.75, 0.075),
  ),
  ["gemini-3.5-flash", price(1.5, 9, 0.15)],
  ["gemini-3.5-flash-lite", price(0.3, 2.5, 0.03)],
  ["gemini-3.1-pro", price(2, 12, 0.2)],
  ["gemini-3.1-flash-lite", price(0.25, 1.5, 0.025)],
  ["gemini-3-flash", price(0.5, 3, 0.05)],
  ["gemini-2.5-pro", price(1.25, 10, 0.125)],
  ["gemini-2.5-flash", price(0.3, 2.5, 0.03)],
  ["gemini-2.5-flash-lite", price(0.1, 0.4, 0.01)],
  // xAI
  ...same(["grok-4.7", "grok-4.6"], price(2, 6, 0.5)),
  ["grok-4.5", price(2, 6, 0.3)],
  ...same(["grok-4.3", "grok-4.20"], price(1.25, 2.5, 0.2)),
  ...same(["grok-code-fast-1", "grok-code-fast"], price(1, 2, 0.2)),
  // Z.ai
  ...same(["glm-5.3", "glm-5.2", "glm-5.1"], price(1.4, 4.4, 0.26)),
  ["glm-5", price(1, 3.2, 0.2)],
  ["glm-5-code", price(1.2, 5, 0.3)],
  ["glm-5.3-flash", price(0.15, 0.5, 0.03)],
  ...same(["glm-4.7", "glm-4.6"], price(0.6, 2.2, 0.11)),
  // Moonshot
  ["kimi-k3", price(3, 15, 0.3)],
  ["kimi-k2.7-code", price(0.95, 4, 0.19)],
  ["kimi-k2.6", price(0.95, 4, 0.16)],
  ["kimi-k2.5", price(0.6, 3, 0.1)],
  // DeepSeek
  ["deepseek-v4-pro", price(1.32, 3.96, 0.044)],
  ["deepseek-v4-flash", price(0.3, 1.2, 0.006)],
  ["deepseek-v3.2", price(0.28, 0.4, 0.028)],
  // MiniMax
  ...same(
    ["minimax-m2.5", "minimax-m2.1", "minimax-m2"],
    price(0.3, 1.2, 0.03, 0.375),
  ),
  ["minimax-m3", price(0.3, 1.2, 0.06)],
  // Qwen
  ["qwen3.8-max", price(2, 6, 0.25)],
  ["qwen3.7-max", price(2.5, 7.5, 0.5, 3.125)],
  ["qwen3.8-flash", price(0.15, 0.47, 0.016, 0.2)],
]);

const HARNESS_PREFIX =
  /^(?:claude|codex|cursor|grok|opencode|pi|omp|fx|hermes|antigravity|devin):/;
/** Picker variants that bill at the base model's rate. */
const VARIANT_SUFFIX =
  /-(?:minimal|low|medium|high|xhigh|thinking|(?:non-)?reasoning|preview)$/;
const CLAUDE_MODEL =
  /^(?:claude-)?(?:(opus|sonnet|haiku|fable|mythos)-(\d+(?:[.-]\d+)?)|(\d+(?:[.-]\d+)?)-(opus|sonnet|haiku))$/;

/**
 * Comparable key for a saved model id or picker label: no harness or
 * upstream provider prefix, no `[1m]` tier, parenthesised note or date
 * stamp, and Claude ids in one shape (`opus-4.5`, `claude-4.5-opus` →
 * `claude-opus-4-5`).
 */
export function modelPriceKey(model: string): string {
  let key = model.trim().toLowerCase().replace(HARNESS_PREFIX, "");
  key = key.replace(/\[[^\]]*\]$/, "");
  key = key.slice(key.lastIndexOf("/") + 1);
  key = key
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-(?:\d{8}|latest)$/, "");
  const claude = CLAUDE_MODEL.exec(key);
  if (claude) {
    const family = claude[1] ?? claude[4];
    const version = (claude[2] ?? claude[3]).replace(".", "-");
    key = `claude-${family}-${version}`;
  }
  return key;
}

function lookup(model: string): ModelPrice | null {
  const key = modelPriceKey(model);
  const variant = modelPriceKey(key.replace(VARIANT_SUFFIX, ""));
  // OpenAI has priced each `-codex` model like the model it tunes.
  const base = variant.replace(/-codex$/, "");
  return PRICES.get(key) ?? PRICES.get(variant) ?? PRICES.get(base) ?? null;
}

/**
 * Price for a saved model id, falling back to its picker label. The label
 * resolves moving aliases: `claude:opus` was sent as "Opus 5.5". Bare family
 * names and agent-chosen models ("Default", "Auto") stay unpriced rather
 * than guessing a generation.
 */
export function modelPrice(model: string, name?: string): ModelPrice | null {
  return lookup(model) ?? (name ? lookup(name) : null);
}

export function costByType(tokens: TokenCounts, rate: ModelPrice): CostByType {
  return {
    input: (tokens.inputTokens * rate.input) / 1e6,
    output: (tokens.outputTokens * rate.output) / 1e6,
    cacheRead: (tokens.cacheReadTokens * rate.cacheRead) / 1e6,
    cacheWrite: (tokens.cacheWriteTokens * rate.cacheWrite) / 1e6,
  };
}

/** What the cache reads would have cost as plain input, less what they did. */
export function cacheSavings(tokens: TokenCounts, rate: ModelPrice): number {
  return (tokens.cacheReadTokens * (rate.input - rate.cacheRead)) / 1e6;
}
