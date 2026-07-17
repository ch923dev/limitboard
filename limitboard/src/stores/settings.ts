import { defineStore } from "pinia";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { ProviderId } from "../adapters/types";

// JSON config in the app data dir (spec FR-6). Secrets never live here.
const store = new LazyStore("settings.json");

export interface PersistedSettings {
  enabled: ProviderId[];
  pollIntervalSec: number;
  notifyPct: number;
  autostart: boolean;
  openrouterSoftCapUsd?: number;
}

const DEFAULTS: PersistedSettings = {
  enabled: [],
  pollIntervalSec: 60,
  notifyPct: 80,
  autostart: false,
};

export const useSettingsStore = defineStore("settings", {
  state: () => ({ ...DEFAULTS, loaded: false }),

  actions: {
    async load() {
      const saved = await store.get<Partial<PersistedSettings>>("settings");
      if (saved) Object.assign(this, { ...DEFAULTS, ...saved });
      this.loaded = true;
    },

    async save() {
      const data: PersistedSettings = {
        enabled: [...this.enabled],
        pollIntervalSec: this.pollIntervalSec,
        notifyPct: this.notifyPct,
        autostart: this.autostart,
        openrouterSoftCapUsd: this.openrouterSoftCapUsd,
      };
      await store.set("settings", data);
      await store.save();
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
