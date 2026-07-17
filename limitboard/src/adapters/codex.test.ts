import { describe, expect, it, vi } from "vitest";
import { createCodexAdapter, mapCodexUsage } from "./codex";

const NOW = 1_800_000_000_000;

const jwt = (expSec: number) =>
  `x.${btoa(JSON.stringify({ exp: expSec }))}.y`;

const authJson = (accessToken: string) =>
  JSON.stringify({
    tokens: {
      access_token: accessToken,
      refresh_token: "rt-1",
      account_id: "acct-1",
    },
  });

const USAGE = {
  rate_limits: {
    primary: { used_percent: 35, resets_in_seconds: 13_320 },
    secondary: { used_percent: 58, resets_in_seconds: 345_600 },
  },
};

describe("mapCodexUsage", () => {
  it("maps primary/secondary with absolute reset times", () => {
    const ws = mapCodexUsage(USAGE, NOW);
    expect(ws.map((w) => [w.label, w.usedPct])).toEqual([
      ["Primary", 35],
      ["Secondary", 58],
    ]);
    expect(ws[0].resetsAt).toBe(new Date(NOW + 13_320_000).toISOString());
  });

  it("tolerates top-level windows and missing fields", () => {
    expect(mapCodexUsage({ primary: { used_percent: 5 } }, NOW)).toHaveLength(1);
    expect(mapCodexUsage({}, NOW)).toHaveLength(0);
  });
});

describe("createCodexAdapter", () => {
  it("valid token → no refresh, usage fetched with account header", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>)["chatgpt-account-id"]).toBe("acct-1");
      return new Response(JSON.stringify(USAGE), { status: 200 });
    }) as typeof fetch;

    const a = createCodexAdapter({
      fetchFn,
      readAuth: async () => authJson(jwt(NOW / 1000 + 3600)),
      now: () => NOW,
    });
    const snap = await a.fetchUsage();
    expect(snap.error).toBeUndefined();
    expect(snap.windows).toHaveLength(2);
    expect(calls).toEqual(["https://chatgpt.com/backend-api/codex/usage"]);
  });

  it("expired token → refresh grant first, new token used, cached across polls", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("auth.openai.com")) {
        const body = JSON.parse(String(init?.body));
        expect(body.grant_type).toBe("refresh_token");
        return new Response(JSON.stringify({ access_token: "fresh-tok" }), { status: 200 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fresh-tok");
      return new Response(JSON.stringify(USAGE), { status: 200 });
    }) as unknown as typeof fetch;

    const a = createCodexAdapter({
      fetchFn,
      readAuth: async () => authJson(jwt(NOW / 1000 - 10)),
      now: () => NOW,
    });
    expect((await a.fetchUsage()).error).toBeUndefined();
    expect((await a.fetchUsage()).error).toBeUndefined();
    // 1 refresh + 2 usage calls — refresh result cached in memory
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("refresh failure → error snapshot", async () => {
    const fetchFn = (async (url: RequestInfo | URL) =>
      String(url).includes("auth.openai.com")
        ? new Response("x", { status: 400 })
        : new Response(JSON.stringify(USAGE), { status: 200 })) as typeof fetch;

    const a = createCodexAdapter({
      fetchFn,
      readAuth: async () => authJson(jwt(NOW / 1000 - 10)),
      now: () => NOW,
    });
    expect((await a.fetchUsage()).error).toMatch(/HTTP 400/);
  });

  it("no auth.json → not detected", async () => {
    const a = createCodexAdapter({ readAuth: async () => null });
    expect((await a.detect()).detected).toBe(false);
  });
});
