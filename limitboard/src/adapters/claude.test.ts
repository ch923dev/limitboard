import { describe, expect, it } from "vitest";
import { createClaudeAdapter, mapOauthUsage } from "./claude";

const CREDS = JSON.stringify({
  claudeAiOauth: {
    accessToken: "tok-abc",
    expiresAt: Date.now() + 3600_000,
    subscriptionType: "max",
  },
});

const USAGE = {
  five_hour: { utilization: 62, resets_at: "2026-07-17T14:00:00Z" },
  seven_day: { utilization: 41, resets_at: "2026-07-20T00:00:00Z" },
  seven_day_opus: { utilization: 18, resets_at: "2026-07-20T00:00:00Z" },
};

describe("mapOauthUsage", () => {
  it("maps session/weekly/opus windows", () => {
    const ws = mapOauthUsage(USAGE);
    expect(ws.map((w) => [w.label, w.usedPct])).toEqual([
      ["Session", 62],
      ["Weekly", 41],
      ["Weekly", 18],
    ]);
    expect(ws[0].resetsAt).toBe("2026-07-17T14:00:00Z");
  });

  it("tolerates missing windows (schema drift)", () => {
    expect(mapOauthUsage({ five_hour: { utilization: 10 } })).toHaveLength(1);
    expect(mapOauthUsage({})).toHaveLength(0);
  });

  it("clamps utilization to 0..100", () => {
    const ws = mapOauthUsage({ five_hour: { utilization: 130 } });
    expect(ws[0].usedPct).toBe(100);
  });
});

describe("createClaudeAdapter", () => {
  const fetchOk = (async () =>
    new Response(JSON.stringify(USAGE), { status: 200 })) as typeof fetch;

  it("happy path → three windows", async () => {
    const a = createClaudeAdapter({
      fetchFn: fetchOk,
      readCredentials: async () => CREDS,
    });
    const snap = await a.fetchUsage();
    expect(snap.error).toBeUndefined();
    expect(snap.windows).toHaveLength(3);
  });

  it("missing credentials file → not detected + error snapshot", async () => {
    const a = createClaudeAdapter({
      fetchFn: fetchOk,
      readCredentials: async () => null,
    });
    expect((await a.detect()).detected).toBe(false);
    expect((await a.fetchUsage()).error).toBe("no credentials");
  });

  it("HTTP 401 → error snapshot, no throw", async () => {
    const a = createClaudeAdapter({
      fetchFn: (async () => new Response("x", { status: 401 })) as typeof fetch,
      readCredentials: async () => CREDS,
    });
    expect((await a.fetchUsage()).error).toMatch(/HTTP 401/);
  });

  it("sends the direct-browser-access header (plugin fetch carries an Origin)", async () => {
    let seen: Record<string, string> | undefined;
    const a = createClaudeAdapter({
      fetchFn: (async (_u: RequestInfo | URL, init?: RequestInit) => {
        seen = init?.headers as Record<string, string>;
        return new Response(JSON.stringify(USAGE), { status: 200 });
      }) as typeof fetch,
      readCredentials: async () => CREDS,
    });
    await a.fetchUsage();
    expect(seen?.["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("HTTP 429 with Retry-After → retryAfterMs surfaced (server sends ~47min)", async () => {
    const a = createClaudeAdapter({
      fetchFn: (async () =>
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2833" },
        })) as typeof fetch,
      readCredentials: async () => CREDS,
    });
    const snap = await a.fetchUsage();
    expect(snap.error).toMatch(/HTTP 429/);
    expect(snap.error).toMatch(/retry in ~48m/);
    expect(snap.retryAfterMs).toBe(2_833_000);
  });
});
