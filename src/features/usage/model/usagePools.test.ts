import { describe, expect, it } from "vitest";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  unavailableRateLimits,
  type ProviderRateLimits,
} from "../../providers/model/rateLimits";
import { poolRoomLabel, usagePools, type PoolAccountInput } from "./usagePools";

const now = Date.parse("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;

/** Codex limits: [used, hours to reset] for the 5-hour and weekly windows. */
function codex(
  session: [number, number | null] | null,
  weekly: [number, number | null] | null,
  monthly: [number, number | null] | null = null,
): ProviderRateLimits {
  const window = (
    entry: [number, number | null] | null,
    windowMinutes: number,
  ) =>
    entry
      ? {
          usedPercent: entry[0],
          windowMinutes,
          resetsAt: entry[1] == null ? null : now + entry[1] * HOUR,
        }
      : null;
  return {
    ...idleRateLimits("codex"),
    session: window(session, 300),
    weekly: window(weekly, 10_080),
    monthly: window(monthly, 43_200),
    updatedAt: now,
    status: "ok",
  };
}

function account(
  label: string,
  limits: ProviderRateLimits | undefined,
): PoolAccountInput {
  return { key: `codex:${label}`, label, limits };
}

describe("usagePools", () => {
  it("leaves a provider with fewer than two accounts with usage unpooled", () => {
    expect(usagePools([account("Default", codex([10, 2], [5, 50]))], now)).toBe(
      null,
    );
    expect(
      usagePools(
        [
          account("Default", codex([10, 2], [5, 50])),
          account(
            "Work",
            unavailableRateLimits("codex", "Codex not signed in"),
          ),
        ],
        now,
      ),
    ).toBe(null);
  });

  it("averages the accounts' shares, each counted equally", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account("Work", codex([60, 3], [10, 90])),
        account("Spare", codex([100, 1], [70, 20])),
      ],
      now,
    );
    const [session, weekly] = summary!.pools;
    expect(summary!.included).toBe(3);
    expect(session.kind).toBe("session");
    expect(session.members.map((member) => member.label)).toEqual([
      "Default",
      "Work",
      "Spare",
    ]);
    expect(session.averageUsedPercent).toBe(60);
    expect(weekly.kind).toBe("weekly");
    expect(weekly.averageUsedPercent).toBe(40);
  });

  it("counts the accounts with room and when the next one frees up", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account("Work", codex([100, 3], [10, 90])),
        account("Spare", codex([100, 1], [70, 20])),
      ],
      now,
    );
    const [session, weekly] = summary!.pools;
    expect(session.withRoom).toBe(1);
    expect(session.nextFreeAt).toBe(now + HOUR);
    expect(weekly.withRoom).toBe(3);
    expect(weekly.nextFreeAt).toBeNull();
  });

  it("treats a spent weekly window as blocking the account's 5-hour room", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        // Five-hour room left, but the week is spent until it resets in 20h.
        account("Work", codex([30, 3], [100, 20])),
      ],
      now,
    );
    const work = summary!.pools[0].members[1];
    expect(work.usedPercent).toBe(100);
    expect(work.blockedBy).toBe("weekly");
    expect(work.freesAt).toBe(now + 20 * HOUR);
    expect(summary!.pools[0].withRoom).toBe(1);
    expect(summary!.pools[0].averageUsedPercent).toBe(60);
    expect(summary!.pools[0].nextFreeAt).toBe(now + 20 * HOUR);
  });

  it("frees an account only once every window holding it back resets", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account("Work", codex([100, 30], [100, 20])),
      ],
      now,
    );
    expect(summary!.pools[0].members[1].freesAt).toBe(now + 30 * HOUR);
  });

  it("does not guess when a full account frees up without a reset time", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account("Work", codex([100, null], [10, 90])),
      ],
      now,
    );
    expect(summary!.pools[0].members[1].freesAt).toBeNull();
    expect(summary!.pools[0].withRoom).toBe(1);
    expect(summary!.pools[0].nextFreeAt).toBeNull();
  });

  it("reads a window whose reset has passed as unused", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account("Work", codex([100, -1], [10, 90])),
      ],
      now,
    );
    expect(summary!.pools[0].members[1].usedPercent).toBe(0);
    expect(summary!.pools[0].withRoom).toBe(2);
  });

  it("pools a window kind only when two accounts report it", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account("Work", codex([60, 3], [10, 90], [5, 400])),
      ],
      now,
    );
    expect(summary!.pools.map((pool) => pool.kind)).toEqual([
      "session",
      "weekly",
    ]);
  });

  it("notes the accounts left out and keeps a stale snapshot in", () => {
    const summary = usagePools(
      [
        account("Default", codex([20, 2], [40, 50])),
        account(
          "Work",
          errorRateLimits("codex", "offline", codex([60, 3], [10, 90])),
        ),
        account("Spare", errorRateLimits("codex", "Codex sign-in expired")),
        account("New", fetchingRateLimits("codex")),
        account("Old", undefined),
      ],
      now,
    );
    expect(summary!.included).toBe(2);
    expect(summary!.excluded).toEqual([
      { key: "codex:Spare", label: "Spare", reason: "Codex sign-in expired" },
      { key: "codex:New", label: "New", reason: "Checking…" },
      { key: "codex:Old", label: "Old", reason: "Checking…" },
    ]);
  });
});

describe("poolRoomLabel", () => {
  it("says how many accounts still have room", () => {
    expect(poolRoomLabel(2, 3)).toBe("2 of 3 accounts have room");
    expect(poolRoomLabel(1, 2)).toBe("1 of 2 accounts have room");
    expect(poolRoomLabel(2, 2)).toBe("Both accounts have room");
    expect(poolRoomLabel(4, 4)).toBe("All 4 accounts have room");
    expect(poolRoomLabel(0, 3)).toBe("No account has room");
  });
});
