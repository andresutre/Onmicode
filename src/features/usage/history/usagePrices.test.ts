import { describe, expect, it } from "vitest";
import {
  cacheSavings,
  costByType,
  modelPrice,
  modelPriceKey,
} from "./usagePrices";

describe("modelPriceKey", () => {
  it.each([
    ["claude:opus-4.5", "claude-opus-4-5"],
    ["claude:opus-5-5", "claude-opus-5-5"],
    ["claude-opus-4-5-20251101", "claude-opus-4-5"],
    ["claude:sonnet-5[1m]", "claude-sonnet-5"],
    ["cursor:claude-4.5-sonnet", "claude-sonnet-4-5"],
    ["claude-3-7-sonnet-latest", "claude-sonnet-3-7"],
    ["opencode:anthropic/claude-sonnet-4.6", "claude-sonnet-4-6"],
    ["pi:openai-codex/gpt-5.1-codex", "gpt-5.1-codex"],
    ["Claude Opus 5.5", "claude-opus-5-5"],
    ["Gemini 3.8 Flash (High)", "gemini-3.8-flash"],
    ["claude:opus", "opus"],
  ])("%s → %s", (model, key) => {
    expect(modelPriceKey(model)).toBe(key);
  });
});

describe("modelPrice", () => {
  it("prices saved ids from every agent", () => {
    expect(modelPrice("claude:opus-5-5")).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
    expect(modelPrice("codex:gpt-5.1-codex-max")?.input).toBe(1.25);
    expect(modelPrice("opencode:moonshotai/kimi-k2.5")?.output).toBe(3);
    expect(modelPrice("antigravity:gemini-3.8-flash-high")?.input).toBe(0.75);
    expect(modelPrice("grok:grok-4.6")?.cacheRead).toBe(0.5);
  });

  it("prices a -codex model like the model it tunes", () => {
    expect(modelPrice("codex:gpt-5.4-codex")).toEqual(modelPrice("gpt-5.4"));
  });

  it("resolves a moving alias through the label it was sent with", () => {
    expect(modelPrice("claude:opus")).toBeNull();
    expect(modelPrice("claude:opus", "Opus 5.5")).toEqual(
      modelPrice("claude-opus-5-5"),
    );
  });

  it("leaves agent-chosen and unknown models unpriced", () => {
    expect(modelPrice("pi:default", "Default")).toBeNull();
    expect(modelPrice("cursor:auto", "Auto")).toBeNull();
    expect(modelPrice("devin:adaptive", "Adaptive")).toBeNull();
    expect(modelPrice("fx:zai/glm-5.2-fast", "GLM 5.2 Fast")).toBeNull();
  });
});

describe("cost", () => {
  const tokens = {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 10_000_000,
    cacheWriteTokens: 200_000,
  };

  it("prices each token type at its own rate", () => {
    const cost = costByType(tokens, modelPrice("claude-sonnet-4-5")!);
    expect(cost.input).toBeCloseTo(3);
    expect(cost.output).toBeCloseTo(7.5);
    expect(cost.cacheRead).toBeCloseTo(3);
    expect(cost.cacheWrite).toBeCloseTo(0.75);
  });

  it("counts what cache reads saved over plain input", () => {
    expect(cacheSavings(tokens, modelPrice("claude-sonnet-4-5")!)).toBeCloseTo(
      27,
    );
  });
});
