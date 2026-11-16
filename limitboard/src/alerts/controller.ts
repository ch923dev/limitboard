// Glue: after each poll, run the threshold engine → toasts (T16) and push
// worst-gauge status to the tray (T17).
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { windowPct } from "../adapters/types";
import type { StoredSnapshot } from "../stores/usage";
import {
  formatSuggestion,
  suggestAccount,
  SwitchWatcher,
  type AccountCandidate,
  type Suggestion,
} from "./switch";
import { formatAlert, ThresholdEngine } from "./threshold";

/** Claude account switching inputs, read fresh on every poll. */
export interface ClaudeSwitchContext {
  candidates: AccountCandidate[];
  notifyPct: number;
  switchPct: number;
  notifyReset: boolean;
  autoSwitch: boolean;
  onAutoSwitch: (s: Suggestion) => void;
}

export class AlertController {
  private engine: ThresholdEngine;
  private switchWatcher = new SwitchWatcher();
  private lastTrayLevel: string | null = null;
  private lastTrayTooltip = "";

  constructor(
    getNotifyPct: (providerId: string) => number,
    private isMuted: () => boolean = () => false,
    private claude: () => ClaudeSwitchContext | null = () => null,
  ) {
    this.engine = new ThresholdEngine(getNotifyPct);
  }

  async onPoll(
    snapshots: Array<{ snap: StoredSnapshot; providerName: string }>,
  ): Promise<void> {
    let worstPct = 0;
    let worstSummary = "all nominal";

    // Engine always runs so arming state stays consistent; mute only
    // swallows the toasts (crossings during mute are consumed, not queued).
    const muted = this.isMuted();
    // Switching only means something with a second Claude Code account.
    const ctx = this.claude();
    const claude = ctx && ctx.candidates.length > 1 ? ctx : null;
    const now = Date.now();

    for (const { snap, providerName } of snapshots) {
      const events = this.engine.evaluate(snap.providerId, providerName, snap.windows);
      if (!muted) {
        for (const e of events) {
          let body = formatAlert(e);
          const active = claude?.candidates.find((c) => c.active);
          if (claude && active && e.providerId === "claude-code") {
            body += ` · ${formatSuggestion(suggestAccount(claude.candidates, active, claude.notifyPct, claude.switchPct, now))}`;
          }
          await this.toast(body);
        }
      }

      for (const w of snap.windows) {
        const pct = windowPct(w);
        if (pct != null && pct >= worstPct) {
          worstPct = pct;
          worstSummary = `${providerName} · ${w.label} ${Math.round(pct)}%`;
        }
      }
    }

    if (claude) {
      for (const ev of this.switchWatcher.evaluate(claude.candidates, claude, now)) {
        if (ev.kind === "switch") {
          if (!muted) {
            await this.toast(
              `${ev.accountName} · ${ev.window?.label ?? "limit"} ${Math.round(ev.pct)}% — ${formatSuggestion(ev.suggestion ?? null)}`,
              "Time to switch Claude account",
            );
          }
          // Auto-switch is an action, not a notification: mute doesn't stop it.
          const s = ev.suggestion;
          if (claude.autoSwitch && s && s.pct != null && s.pct < claude.notifyPct) claude.onAutoSwitch(s);
        } else if (!muted && claude.notifyReset) {
          await this.toast(`${ev.accountName} is available again — its limit reset`, "Claude account available");
        }
      }
    }

    const level = worstPct >= 80 ? "crit" : worstPct >= 50 ? "warn" : "ok";
    const tooltip = `Limitboard — ${worstSummary}`;
    if (level !== this.lastTrayLevel || tooltip !== this.lastTrayTooltip) {
      this.lastTrayLevel = level;
      this.lastTrayTooltip = tooltip;
      try {
        await invoke("set_tray_status", { level, tooltip });
      } catch {
        // tray unavailable (e.g. dev reload) — never break the poll loop
      }
    }
  }

  private async toast(body: string, title = "Limitboard"): Promise<void> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    } catch {
      // notifications unavailable — degrade silently
    }
  }
}
