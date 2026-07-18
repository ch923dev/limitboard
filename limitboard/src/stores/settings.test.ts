import { describe, expect, it } from "vitest";
import { isMutedAt } from "./settings";

const NOW = new Date("2026-07-19T12:00:00Z").getTime();

describe("isMutedAt", () => {
  it("undefined ⇒ not muted", () => {
    expect(isMutedAt(undefined, NOW)).toBe(false);
  });

  it("forever ⇒ muted regardless of time", () => {
    expect(isMutedAt("forever", NOW)).toBe(true);
    expect(isMutedAt("forever", NOW + 365 * 24 * 3_600_000)).toBe(true);
  });

  it("timed mute active until expiry, then off", () => {
    const until = NOW + 3_600_000;
    expect(isMutedAt(until, NOW)).toBe(true);
    expect(isMutedAt(until, until - 1)).toBe(true);
    expect(isMutedAt(until, until)).toBe(false);
    expect(isMutedAt(until, until + 1)).toBe(false);
  });
});
