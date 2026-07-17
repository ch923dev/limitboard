import { describe, expect, it } from "vitest";
import { formatAlert, ThresholdEngine } from "./threshold";
import type { UsageWindow } from "../adapters/types";

const w = (pct: number, over: Partial<UsageWindow> = {}): UsageWindow => ({
  label: "Session",
  sub: "5h rolling",
  usedPct: pct,
  resetsAt: "2026-07-17T14:00:00Z",
  ...over,
});

const engine = () => new ThresholdEngine(() => 80);

describe("ThresholdEngine", () => {
  it("fires exactly once on upward crossing", () => {
    const e = engine();
    expect(e.evaluate("claude-code", "Claude Code", [w(75)])).toHaveLength(0);
    expect(e.evaluate("claude-code", "Claude Code", [w(82)])).toHaveLength(1);
    expect(e.evaluate("claude-code", "Claude Code", [w(85)])).toHaveLength(0); // still over — no repeat
  });

  it("flapping around the threshold does not re-fire (hysteresis band)", () => {
    const e = engine();
    e.evaluate("p", "P", [w(82)]); // fires, disarms
    expect(e.evaluate("p", "P", [w(78)])).toHaveLength(0); // inside band (>75) — still disarmed
    expect(e.evaluate("p", "P", [w(81)])).toHaveLength(0); // back over — no re-fire
  });

  it("re-arms after dropping below threshold − 5", () => {
    const e = engine();
    e.evaluate("p", "P", [w(82)]);
    e.evaluate("p", "P", [w(74)]); // below 75 — re-armed
    expect(e.evaluate("p", "P", [w(80)])).toHaveLength(1);
  });

  it("re-arms when the window resets (new resetsAt)", () => {
    const e = engine();
    e.evaluate("p", "P", [w(82)]);
    // usage still high but a new reset timestamp = new window
    const fired = e.evaluate("p", "P", [w(81, { resetsAt: "2026-07-17T19:00:00Z" })]);
    expect(fired).toHaveLength(1);
  });

  it("first-ever poll already over threshold fires once", () => {
    const e = engine();
    expect(e.evaluate("p", "P", [w(91)])).toHaveLength(1);
  });

  it("uncapped spend windows never alert", () => {
    const e = engine();
    const spend: UsageWindow = { label: "Today", amountUsd: 999 };
    expect(e.evaluate("openrouter", "OpenRouter", [spend])).toHaveLength(0);
  });

  it("windows are tracked independently", () => {
    const e = engine();
    const fired = e.evaluate("p", "P", [w(85), w(30, { label: "Weekly" })]);
    expect(fired).toHaveLength(1);
    expect(fired[0].window.label).toBe("Session");
    expect(e.evaluate("p", "P", [w(85), w(85, { label: "Weekly" })])).toHaveLength(1);
  });
});

describe("formatAlert", () => {
  it("formats provider, window, pct and reset countdown", () => {
    const now = new Date("2026-07-17T12:46:00Z").getTime();
    const msg = formatAlert(
      {
        providerId: "claude-code",
        providerName: "Claude Code",
        window: w(82),
        pct: 82,
      },
      now,
    );
    expect(msg).toBe("Claude Code · Session 82% · resets in 1h 14m");
  });
});
