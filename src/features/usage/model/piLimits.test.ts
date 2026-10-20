import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearPiLimits, loadPiLimits } from "./piLimits";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const usage = {
  status: "ok",
  windows: {
    session: {
      usedPercent: 25,
      windowMinutes: 300,
      resetsAt: 1_800_000_000_000,
    },
    weekly: null,
  },
};

afterEach(() => {
  clearPiLimits();
  vi.mocked(invoke).mockReset();
});

describe("loadPiLimits", () => {
  it("reads each provider once, then again only when forced", async () => {
    vi.mocked(invoke).mockResolvedValue(usage);

    const first = await loadPiLimits("anthropic");
    expect(first.provider).toBe("claude");
    expect(first.session?.usedPercent).toBe(25);
    await loadPiLimits("anthropic");
    expect(invoke).toHaveBeenCalledTimes(1);

    await loadPiLimits("anthropic", true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("fetch_pi_usage", {
      provider: "anthropic",
    });
  });

  it("shares a read that is already running", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    vi.mocked(invoke).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const first = loadPiLimits("openai-codex");
    const second = loadPiLimits("openai-codex", true);
    resolve({ status: "unavailable", message: "Sign in through Pi" });

    expect(await first).toBe(await second);
    expect((await first).status).toBe("unavailable");
    expect((await first).provider).toBe("codex");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
