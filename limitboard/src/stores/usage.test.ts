import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { ProviderAdapter, UsageSnapshot } from "../adapters/types";
import { reduceSnapshot, useUsageStore, type StoredSnapshot } from "./usage";

const good = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  providerId: "claude-code",
  windows: [{ label: "Session", sub: "5h rolling", usedPct: 62 }],
  fetchedAt: 1_000,
  ...over,
});

describe("reduceSnapshot", () => {
  it("stores a good snapshot as-is", () => {
    const s = reduceSnapshot(undefined, good());
    expect(s.windows).toHaveLength(1);
    expect(s.error).toBeUndefined();
    expect(s.fetchedAt).toBe(1_000);
  });

  it("good snapshot clears a previous error", () => {
    const degraded: StoredSnapshot = {
      providerId: "claude-code",
      windows: [],
      fetchedAt: 500,
      error: "boom",
    };
    const s = reduceSnapshot(degraded, good({ fetchedAt: 2_000 }));
    expect(s.error).toBeUndefined();
    expect(s.fetchedAt).toBe(2_000);
  });

  it("failed poll keeps last-good windows, stat and fetchedAt", () => {
    const prev = reduceSnapshot(undefined, good({ stat: "balance $5.00" }));
    const s = reduceSnapshot(prev, {
      providerId: "claude-code",
      windows: [],
      fetchedAt: 9_000,
      error: "network unreachable",
    });
    expect(s.error).toBe("network unreachable");
    expect(s.windows).toHaveLength(1); // last-good kept
    expect(s.stat).toBe("balance $5.00");
    expect(s.fetchedAt).toBe(1_000); // staleness measured from last-good
  });

  it("failed poll with no prior data → empty degraded snapshot", () => {
    const s = reduceSnapshot(undefined, {
      providerId: "codex",
      windows: [],
      fetchedAt: 3_000,
      error: "no auth",
    });
    expect(s.windows).toEqual([]);
    expect(s.error).toBe("no auth");
  });
});

describe("usage store poll loop", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockAdapter = (snap: UsageSnapshot): ProviderAdapter => ({
    id: snap.providerId,
    displayName: snap.providerId,
    detect: async () => ({ detected: true, evidence: "mock" }),
    fetchUsage: async () => snap,
  });

  it("pollOnce reduces snapshots from all adapters", async () => {
    const store = useUsageStore();
    await store.pollOnce([
      mockAdapter(good()),
      mockAdapter(good({ providerId: "codex" })),
    ]);
    expect(Object.keys(store.snapshots)).toEqual(["claude-code", "codex"]);
  });

  it("throwing adapter degrades its card, does not kill the loop", async () => {
    const store = useUsageStore();
    const bad: ProviderAdapter = {
      id: "cursor",
      displayName: "Cursor",
      detect: async () => ({ detected: true, evidence: "mock" }),
      fetchUsage: async () => {
        throw new Error("adapter bug");
      },
    };
    await store.pollOnce([bad, mockAdapter(good())]);
    expect(store.snapshots.cursor?.error).toBe("adapter bug");
    expect(store.snapshots["claude-code"]?.error).toBeUndefined();
  });

  it("server Retry-After overrides formula backoff and gates pollOnce", async () => {
    const store = useUsageStore();
    store.reduce({
      providerId: "claude-code",
      windows: [],
      fetchedAt: Date.now(),
      error: "oauth/usage → HTTP 429 · retry in ~48m",
      retryAfterMs: 2_833_000, // far beyond the 15min formula cap
    });
    const wait = (store._nextAllowedAt["claude-code"] ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(2_833_000); // retry-after + buffer, not capped at 15min

    const fetchUsage = vi.fn(async () => good());
    await store.pollOnce([
      {
        id: "claude-code",
        displayName: "Claude Code",
        detect: async () => ({ detected: true, evidence: "mock" }),
        fetchUsage,
      },
    ]);
    expect(fetchUsage).not.toHaveBeenCalled(); // still in server-mandated cooldown
  });

  it("startPolling polls immediately and on the interval", async () => {
    vi.useFakeTimers();
    const store = useUsageStore();
    const fetchUsage = vi.fn(async () => good({ fetchedAt: Date.now() }));
    const adapter: ProviderAdapter = {
      id: "claude-code",
      displayName: "Claude Code",
      detect: async () => ({ detected: true, evidence: "mock" }),
      fetchUsage,
    };
    store.startPolling(() => [adapter], 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchUsage).toHaveBeenCalledTimes(3);
    store.stopPolling();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchUsage).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
