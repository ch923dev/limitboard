import { describe, expect, it } from "vitest";
import type { UsageWindow } from "../adapters/types";
import {
  currentPct,
  formatSuggestion,
  suggestAccount,
  SwitchWatcher,
  worstPct,
  type AccountCandidate,
} from "./switch";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const LATER = "2026-11-16T14:00:00Z";
const PAST = "2026-11-16T11:00:00Z";

const win = (pct: number, resetsAt = LATER, label = "Session"): UsageWindow => ({
  label,
  sub: "5h rolling",
  usedPct: pct,
  resetsAt,
});

const acct = (id: string, pct: number | null, over: Partial<AccountCandidate> = {}): AccountCandidate => ({
  id,
  name: id,
  active: false,
  uuid: `uuid-${id}`,
  windows: pct == null ? undefined : [win(pct)],
  ...over,
});

const OPTS = { notifyPct: 80, switchPct: 95 };

describe("currentPct / worstPct", () => {
  it("counts a window whose reset passed as 0%", () => {
    expect(currentPct(win(97, PAST), NOW)).toBe(0);
    expect(currentPct(win(97), NOW)).toBe(97);
    expect(worstPct([win(10), win(60, LATER, "Weekly")], NOW)).toBe(60);
    expect(worstPct(undefined, NOW)).toBeNull();
  });
});

describe("suggestAccount", () => {
  const from = acct("main", 96, { active: true });

  it("prefers a known low reading, then unknown, never an exhausted one", () => {
    const cands = [from, acct("unknown", null), acct("busy", 85), acct("full", 99), acct("free", 20)];
    expect(suggestAccount(cands, from, 80, 95, NOW)?.id).toBe("free");
    const noFree = cands.filter((c) => c.id !== "free");
    expect(suggestAccount(noFree, from, 80, 95, NOW)?.id).toBe("unknown");
    expect(suggestAccount([from, acct("full", 99)], from, 80, 95, NOW)).toBeNull();
  });

  it("skips another login of the same Claude account", () => {
    const twin = acct("twin", 5, { uuid: "uuid-main" });
    expect(suggestAccount([from, twin, acct("b", 50)], from, 80, 95, NOW)?.id).toBe("b");
  });

  it("treats an account whose window reset as having room", () => {
    const reset = acct("reset", null, { windows: [win(99, PAST)] });
    expect(suggestAccount([from, reset], from, 80, 95, NOW)).toEqual({ id: "reset", name: "reset", pct: 0 });
  });

  it("formats", () => {
    expect(formatSuggestion({ id: "w", name: "Work", pct: 12.4 })).toBe("switch to Work (12%)");
    expect(formatSuggestion(null)).toBe("no other account has room left");
  });
});

describe("SwitchWatcher", () => {
  it("fires once when the account in use crosses the switch threshold, with a suggestion", () => {
    const w = new SwitchWatcher();
    const cands = [acct("main", 90, { active: true }), acct("work", 12)];
    expect(w.evaluate(cands, OPTS, NOW)).toHaveLength(0);

    cands[0].windows = [win(96)];
    const ev = w.evaluate(cands, OPTS, NOW);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "switch", accountId: "main", suggestion: { id: "work", pct: 12 } });

    cands[0].windows = [win(98)];
    expect(w.evaluate(cands, OPTS, NOW)).toHaveLength(0);
  });

  it("never fires 'switch' for an account that isn't in use", () => {
    const w = new SwitchWatcher();
    expect(w.evaluate([acct("main", 10, { active: true }), acct("work", 99)], OPTS, NOW)).toHaveLength(0);
  });

  it("announces when an exhausted account resets, even after switching away", () => {
    const w = new SwitchWatcher();
    const cands = [acct("main", 97, { active: true }), acct("work", 5)];
    w.evaluate(cands, OPTS, NOW);

    // Switched to work; main's reading stays at 97% until its reset passes.
    cands[0].active = false;
    cands[1].active = true;
    expect(w.evaluate(cands, OPTS, NOW)).toHaveLength(0);

    cands[0].windows = [win(97, PAST)];
    const ev = w.evaluate(cands, OPTS, NOW);
    expect(ev).toEqual([{ kind: "reset", accountId: "main", accountName: "main", pct: 0 }]);
    expect(w.evaluate(cands, OPTS, NOW)).toHaveLength(0);
  });
});
