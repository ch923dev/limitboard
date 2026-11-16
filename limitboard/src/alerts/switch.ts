// Claude account switching alerts. Pure logic, no Tauri: which account to
// move to, when the account in use crosses the switch threshold, and when an
// account that ran out is available again.
import type { UsageWindow } from "../adapters/types";
import { windowPct } from "../adapters/types";
import { ThresholdEngine } from "./threshold";

const HYSTERESIS = 5;

/** A window's usage as it stands now: once its reset time has passed it's 0%. */
export function currentPct(w: UsageWindow, nowMs: number): number | null {
  const pct = windowPct(w);
  if (pct == null) return null;
  if (w.resetsAt && new Date(w.resetsAt).getTime() <= nowMs) return 0;
  return pct;
}

/** Worst window of an account right now; null when there's no reading. */
export function worstPct(windows: UsageWindow[] | undefined, nowMs: number): number | null {
  const pcts = (windows ?? [])
    .map((w) => currentPct(w, nowMs))
    .filter((v): v is number => v != null);
  return pcts.length ? Math.max(...pcts) : null;
}

export interface AccountCandidate {
  id: string;
  name: string;
  active: boolean;
  /** Claude account id; two logins of one Claude account share limits. */
  uuid?: string | null;
  windows?: UsageWindow[];
}

export interface Suggestion {
  id: string;
  name: string;
  /** Worst window of the suggested account; null = no reading yet. */
  pct: number | null;
}

/**
 * The account with the most room left. Never one at the switch threshold or
 * the same Claude account as `from`. A known low reading beats no reading,
 * which beats a reading already past the notify threshold.
 */
export function suggestAccount(
  cands: AccountCandidate[],
  from: AccountCandidate,
  notifyPct: number,
  switchPct: number,
  nowMs: number,
): Suggestion | null {
  let best: { rank: number; pct: number; c: AccountCandidate; worst: number | null } | null = null;
  for (const c of cands) {
    if (c.id === from.id || c.active) continue;
    if (from.uuid && c.uuid === from.uuid) continue;
    const worst = worstPct(c.windows, nowMs);
    if (worst != null && worst >= switchPct) continue;
    const rank = worst == null ? 1 : worst < notifyPct ? 0 : 2;
    const pct = worst ?? 0;
    if (!best || rank < best.rank || (rank === best.rank && pct < best.pct)) {
      best = { rank, pct, c, worst };
    }
  }
  return best ? { id: best.c.id, name: best.c.name, pct: best.worst } : null;
}

export function formatSuggestion(s: Suggestion | null): string {
  if (!s) return "no other account has room left";
  return s.pct != null
    ? `switch to ${s.name} (${Math.round(s.pct)}%)`
    : `switch to ${s.name} (no reading yet)`;
}

export interface SwitchEvent {
  kind: "switch" | "reset";
  accountId: string;
  accountName: string;
  pct: number;
  window?: UsageWindow;
  suggestion?: Suggestion | null;
}

export interface SwitchOptions {
  notifyPct: number;
  switchPct: number;
}

/**
 * Watches Claude Code accounts after each poll:
 *  - "switch": the account in use crossed the switch threshold (once per
 *    crossing, same hysteresis and re-arming as the notify threshold).
 *  - "reset": an account that reached the switch threshold is back under the
 *    notify threshold (its window reset), whether or not it's in use.
 */
export class SwitchWatcher {
  private switchPct = 95;
  private engine = new ThresholdEngine(() => this.switchPct);
  private exhausted = new Set<string>();

  evaluate(cands: AccountCandidate[], opts: SwitchOptions, nowMs = Date.now()): SwitchEvent[] {
    this.switchPct = opts.switchPct;
    const events: SwitchEvent[] = [];

    for (const c of cands) {
      const worst = worstPct(c.windows, nowMs);
      if (worst == null) continue;
      if (worst >= opts.switchPct) {
        this.exhausted.add(c.id);
      } else if (this.exhausted.has(c.id) && worst < opts.notifyPct - HYSTERESIS) {
        this.exhausted.delete(c.id);
        events.push({ kind: "reset", accountId: c.id, accountName: c.name, pct: worst });
      }
    }

    const active = cands.find((c) => c.active);
    if (active?.windows?.length) {
      const now = active.windows.map((w) => ({ ...w, usedPct: currentPct(w, nowMs) ?? w.usedPct }));
      for (const e of this.engine.evaluate(`claude-code:${active.id}`, active.name, now)) {
        events.push({
          kind: "switch",
          accountId: active.id,
          accountName: active.name,
          pct: e.pct,
          window: e.window,
          suggestion: suggestAccount(cands, active, opts.notifyPct, opts.switchPct, nowMs),
        });
      }
    }
    return events;
  }
}
