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
import { formatAlert, ThresholdEngine } from "./threshold";

export class AlertController {
  private engine: ThresholdEngine;
  private lastTrayLevel: string | null = null;
  private lastTrayTooltip = "";

  constructor(
    getNotifyPct: (providerId: string) => number,
    private isMuted: () => boolean = () => false,
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

    for (const { snap, providerName } of snapshots) {
      const events = this.engine.evaluate(snap.providerId, providerName, snap.windows);
      if (!muted) for (const e of events) await this.toast(formatAlert(e));

      for (const w of snap.windows) {
        const pct = windowPct(w);
        if (pct != null && pct >= worstPct) {
          worstPct = pct;
          worstSummary = `${providerName} · ${w.label} ${Math.round(pct)}%`;
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

  private async toast(body: string): Promise<void> {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title: "Limitboard", body });
    } catch {
      // notifications unavailable — degrade silently
    }
  }
}
