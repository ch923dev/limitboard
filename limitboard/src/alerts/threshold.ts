// Threshold engine (spec FR-5): one toast per window per upward crossing.
// Hysteresis: after firing, a window re-arms only when it drops below
// (threshold − 5) or its reset timestamp changes (window rolled over).
import type { UsageWindow } from "../adapters/types";
import { windowPct } from "../adapters/types";

export interface AlertEvent {
  providerId: string;
  providerName: string;
  window: UsageWindow;
  pct: number;
}

interface WindowState {
  armed: boolean;
  lastResetsAt?: string;
}

const HYSTERESIS = 5;

export class ThresholdEngine {
  private states = new Map<string, WindowState>();

  constructor(private getNotifyPct: () => number) {}

  private key(providerId: string, w: UsageWindow): string {
    return `${providerId}|${w.label}|${w.sub ?? ""}`;
  }

  /**
   * Evaluate a provider's freshly reduced windows.
   * Returns the alerts to fire (0..n) and updates arming state.
   */
  evaluate(
    providerId: string,
    providerName: string,
    windows: UsageWindow[],
  ): AlertEvent[] {
    const notifyPct = this.getNotifyPct();
    const events: AlertEvent[] = [];

    for (const w of windows) {
      const pct = windowPct(w);
      if (pct == null) continue; // uncapped spend windows never alert

      const k = this.key(providerId, w);
      const st = this.states.get(k) ?? { armed: true, lastResetsAt: w.resetsAt };

      // Window reset (new reset timestamp) ⇒ re-arm.
      if (w.resetsAt && st.lastResetsAt && w.resetsAt !== st.lastResetsAt) {
        st.armed = true;
      }
      st.lastResetsAt = w.resetsAt ?? st.lastResetsAt;

      if (st.armed && pct >= notifyPct) {
        events.push({ providerId, providerName, window: w, pct });
        st.armed = false;
      } else if (!st.armed && pct < notifyPct - HYSTERESIS) {
        st.armed = true;
      }

      this.states.set(k, st);
    }

    return events;
  }

  reset() {
    this.states.clear();
  }
}

/** "Claude Code · Session 82% · resets in 1h 14m" */
export function formatAlert(e: AlertEvent, nowMs = Date.now()): string {
  const parts = [`${e.providerName} · ${e.window.label} ${Math.round(e.pct)}%`];
  if (e.window.resetsAt) {
    const ms = new Date(e.window.resetsAt).getTime() - nowMs;
    if (ms > 0) {
      const h = Math.floor(ms / 3600_000);
      const m = Math.floor((ms % 3600_000) / 60_000);
      parts.push(`resets in ${h > 0 ? `${h}h ` : ""}${m}m`);
    }
  }
  return parts.join(" · ");
}
