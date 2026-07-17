import { describe, expect, it } from "vitest";
import {
  createOpenRouterAdapter,
  mapToWindows,
  nextUtcMidnight,
  nextUtcMonday,
  nextUtcMonthStart,
  type OpenRouterKeyData,
} from "./openrouter";

// Wed 2026-07-15 12:00 UTC
const NOW = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));

const keyFixture = (over: Partial<OpenRouterKeyData> = {}): OpenRouterKeyData => ({
  label: "sk-or-v1-...abcd",
  usage: 52.1,
  usage_daily: 1.84,
  usage_weekly: 12.4,
  usage_monthly: 38.75,
  is_free_tier: false,
  limit: null,
  limit_remaining: null,
  limit_reset: null,
  ...over,
});

const mockFetch =
  (keyData: OpenRouterKeyData, credits = { total_credits: 25, total_usage: 3.75 }) =>
  async (url: RequestInfo | URL): Promise<Response> => {
    const u = String(url);
    const body = u.endsWith("/key") ? { data: keyData } : { data: credits };
    return new Response(JSON.stringify(body), { status: 200 });
  };

describe("UTC reset boundaries", () => {
  it("computes next UTC midnight", () => {
    expect(nextUtcMidnight(NOW)).toBe("2026-07-16T00:00:00.000Z");
  });
  it("computes next Monday UTC from a Wednesday", () => {
    expect(nextUtcMonday(NOW)).toBe("2026-07-20T00:00:00.000Z");
  });
  it("computes next Monday UTC from a Sunday", () => {
    const sun = new Date(Date.UTC(2026, 6, 19));
    expect(nextUtcMonday(sun)).toBe("2026-07-20T00:00:00.000Z");
  });
  it("computes next month start incl. year rollover", () => {
    expect(nextUtcMonthStart(NOW)).toBe("2026-08-01T00:00:00.000Z");
    expect(nextUtcMonthStart(new Date(Date.UTC(2026, 11, 31)))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("mapToWindows", () => {
  it("uncapped key (limit: null) → three spend windows, no pct anywhere", () => {
    const ws = mapToWindows(keyFixture(), undefined, NOW);
    expect(ws).toHaveLength(3);
    expect(ws.map((w) => w.label)).toEqual(["Today", "This week", "This month"]);
    expect(ws.every((w) => w.usedPct === undefined)).toBe(true);
    expect(ws[0].amountUsd).toBe(1.84);
  });

  it("soft cap → monthly window gains cap + pct", () => {
    const ws = mapToWindows(keyFixture(), 60, NOW);
    const monthly = ws.find((w) => w.label === "This month")!;
    expect(monthly.capUsd).toBe(60);
    expect(monthly.usedPct).toBeCloseTo((38.75 / 60) * 100, 5);
    expect(monthly.sub).toBe("vs soft cap");
  });

  it("capped key → extra Key limit window with pct from limit_remaining", () => {
    const ws = mapToWindows(
      keyFixture({ limit: 100, limit_remaining: 40, limit_reset: "monthly" }),
      undefined,
      NOW,
    );
    const cap = ws.find((w) => w.label === "Key limit")!;
    expect(cap.capUsd).toBe(100);
    expect(cap.amountUsd).toBe(60);
    expect(cap.usedPct).toBe(60);
  });

  it("free-tier key with zero usage → windows present, $0 amounts", () => {
    const ws = mapToWindows(
      keyFixture({
        is_free_tier: true,
        usage_daily: 0,
        usage_weekly: 0,
        usage_monthly: 0,
      }),
      undefined,
      NOW,
    );
    expect(ws.every((w) => (w.amountUsd ?? -1) === 0)).toBe(true);
  });
});

describe("createOpenRouterAdapter", () => {
  it("fetches key + credits, maps windows and balance stat", async () => {
    const adapter = createOpenRouterAdapter({
      getKey: async () => "sk-or-test",
      fetchFn: mockFetch(keyFixture()) as typeof fetch,
      now: () => NOW,
    });
    const snap = await adapter.fetchUsage();
    expect(snap.error).toBeUndefined();
    expect(snap.providerId).toBe("openrouter");
    expect(snap.windows).toHaveLength(3);
    expect(snap.stat).toBe("balance $21.25");
  });

  it("no key → error snapshot, empty windows", async () => {
    const adapter = createOpenRouterAdapter({
      getKey: async () => null,
      fetchFn: mockFetch(keyFixture()) as typeof fetch,
    });
    const snap = await adapter.fetchUsage();
    expect(snap.error).toBe("no API key");
    expect(snap.windows).toEqual([]);
  });

  it("HTTP failure → error snapshot, never throws", async () => {
    const adapter = createOpenRouterAdapter({
      getKey: async () => "sk-or-test",
      fetchFn: (async () => new Response("nope", { status: 401 })) as typeof fetch,
    });
    const snap = await adapter.fetchUsage();
    expect(snap.error).toMatch(/HTTP 401/);
  });

  it("detect() reflects key presence", async () => {
    const yes = createOpenRouterAdapter({ getKey: async () => "k" });
    const no = createOpenRouterAdapter({ getKey: async () => null });
    expect((await yes.detect()).detected).toBe(true);
    expect((await no.detect()).detected).toBe(false);
  });
});
