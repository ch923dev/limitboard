import { defineStore } from "pinia";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { ProviderId } from "../adapters/types";

// JSON config in the app data dir (spec FR-6). Secrets never live here.
const store = new LazyStore("settings.json");

/** Epoch ms the mute expires at, or "forever" until manually unmuted. */
export type MuteUntil = number | "forever";

export interface PersistedSettings {
  enabled: ProviderId[];
  pollIntervalSec: number;
  notifyPct: number;
  autostart: boolean;
  openrouterSoftCapUsd?: number;
  muteUntil?: MuteUntil;
  /** Per-provider notify threshold; absent ⇒ inherit global notifyPct. */
  notifyPctByProvider?: Partial<Record<ProviderId, number>>;
}

export const isMutedAt = (
  muteUntil: MuteUntil | undefined,
  nowMs: number,
): boolean =>
  muteUntil === "forever" ||
  (typeof muteUntil === "number" && nowMs < muteUntil);

const DEFAULTS: PersistedSettings = {
  enabled: [],
  pollIntervalSec: 60,
  notifyPct: 80,
  autostart: false,
  muteUntil: undefined,
  notifyPctByProvider: {},
};

export const useSettingsStore = defineStore("settings", {
  state: () => ({ ...DEFAULTS, loaded: false }),

  getters: {
    /** Effective threshold for a provider: override, else global. */
    notifyPctFor(state) {
      return (id: ProviderId) =>
        state.notifyPctByProvider?.[id] ?? state.notifyPct;
    },
  },

  actions: {
    async load() {
      const saved = await store.get<Partial<PersistedSettings>>("settings");
      if (saved) Object.assign(this, { ...DEFAULTS, ...saved });
      // Expired timed mute — drop it so the UI shows notifications active.
      if (typeof this.muteUntil === "number" && this.muteUntil <= Date.now()) {
        this.muteUntil = undefined;
      }
      this.loaded = true;
    },

    async save() {
      const data: PersistedSettings = {
        enabled: [...this.enabled],
        pollIntervalSec: this.pollIntervalSec,
        notifyPct: this.notifyPct,
        autostart: this.autostart,
        openrouterSoftCapUsd: this.openrouterSoftCapUsd,
        muteUntil: this.muteUntil,
        notifyPctByProvider: { ...this.notifyPctByProvider },
      };
      await store.set("settings", data);
      await store.save();
    },

    isMuted(nowMs = Date.now()): boolean {
      return isMutedAt(this.muteUntil, nowMs);
    },

    async muteFor(ms: number) {
      this.muteUntil = Date.now() + ms;
      await this.save();
    },

    async muteForever() {
      this.muteUntil = "forever";
      await this.save();
    },

    async unmute() {
      this.muteUntil = undefined;
      await this.save();
    },

    async setProviderNotifyPct(id: ProviderId, pct: number | undefined) {
      const map = { ...this.notifyPctByProvider };
      if (pct == null) delete map[id];
      else map[id] = pct;
      this.notifyPctByProvider = map;
      await this.save();
    },

    async setEnabled(id: ProviderId, on: boolean) {
      const set = new Set(this.enabled);
      if (on) set.add(id);
      else set.delete(id);
      this.enabled = [...set];
      await this.save();
    },
  },
});
