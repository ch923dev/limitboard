<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Board from "./views/Board.vue";
import Settings from "./views/Settings.vue";
import Demo from "./views/Demo.vue";
import { buildAdapters } from "./adapters";
import { windowPct, type ProviderId } from "./adapters/types";
import { AlertController } from "./alerts/controller";
import { statusColor } from "./theme";
import { useProvidersStore } from "./stores/providers";
import { useSettingsStore } from "./stores/settings";
import { useUsageStore } from "./stores/usage";

type View = "board" | "settings" | "demo";
const view = ref<View>("board");
const views: View[] = import.meta.env.DEV
  ? ["board", "settings", "demo"]
  : ["board", "settings"];

const providers = useProvidersStore();
const settings = useSettingsStore();
const usage = useUsageStore();

const adapters = buildAdapters(async () => settings.openrouterSoftCapUsd);
const alertController = new AlertController(
  (id) => settings.notifyPctFor(id as ProviderId),
  () => settings.isMuted(),
);

const enabledAdapters = () =>
  providers.enabledProviders
    .map((p) => adapters.get(p.id))
    .filter((a): a is NonNullable<typeof a> => !!a);

const clock = ref(new Date());
const now = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | undefined;
let unlistenRescan: UnlistenFn | undefined;

const win = getCurrentWindow();
const minimize = () => void win.minimize();
const toggleMaximize = () => void win.toggleMaximize();
const closeToTray = () => void win.close(); // intercepted in Rust → hide

onMounted(async () => {
  clockTimer = setInterval(() => {
    clock.value = new Date();
    now.value = Date.now();
  }, 1000);

  await settings.load();
  await providers.rescan();
  // Re-apply persisted enabled set onto detection results (spec AC-2).
  for (const id of settings.enabled) providers.setEnabled(id, true);

  usage.startPolling(enabledAdapters, settings.pollIntervalSec * 1000);

  // Tray menu → Rescan (T3 wiring).
  unlistenRescan = await listen("rescan", () => void providers.rescan());
});

onUnmounted(() => {
  clearInterval(clockTimer);
  unlistenRescan?.();
  usage.stopPolling();
});

// Interval changes take effect immediately.
watch(
  () => settings.pollIntervalSec,
  (sec) => {
    if (settings.loaded) usage.startPolling(enabledAdapters, sec * 1000);
  },
);

// After each poll: threshold toasts + tray status (T15–T17).
watch(
  () => usage.lastPollAt,
  () => {
    const snaps = providers.enabledProviders.flatMap((p) => {
      const snap = usage.snapshots[p.id];
      return snap ? [{ snap, providerName: p.name }] : [];
    });
    void alertController.onPoll(snaps);
  },
);

const worstOverall = computed(() => {
  const pcts = providers.enabledProviders.flatMap((p) =>
    (usage.snapshots[p.id]?.windows ?? [])
      .map(windowPct)
      .filter((v): v is number => v != null),
  );
  return pcts.length ? Math.max(...pcts) : 0;
});

const ledColor = computed(() => statusColor(worstOverall.value));

const nextPollSec = computed(() => {
  if (!usage.polling || !usage.lastPollAt) return null;
  const elapsed = now.value - usage.lastPollAt;
  return Math.max(0, Math.ceil((usage.intervalMs - elapsed) / 1000));
});

const clockText = computed(() =>
  clock.value.toLocaleTimeString([], { hour12: false }),
);
</script>

<template>
  <div class="shell">
    <header class="header" data-tauri-drag-region>
      <div class="brand">
        <span
          class="led"
          :style="{
            background: ledColor,
            boxShadow: `0 0 10px ${ledColor}88`,
          }"
        />
        <span class="wordmark">LIMITBOARD</span>
        <span class="version">v0.1 · windows</span>
      </div>
      <div class="header-right">
        <span class="counts">
          {{ providers.detected.length }} DETECTED ·
          {{ providers.enabledProviders.length }} MONITORED
        </span>
        <span class="clock">{{ clockText }}</span>
        <nav class="nav">
          <button
            v-for="v in views"
            :key="v"
            class="nav-btn"
            :class="{ active: view === v }"
            @click="view = v"
          >
            {{ v }}
          </button>
        </nav>
        <div class="win-controls">
          <button class="wc" title="Minimize" @click="minimize">–</button>
          <button class="wc" title="Maximize / restore" @click="toggleMaximize">□</button>
          <button class="wc wc-close" title="Hide to tray" @click="closeToTray">✕</button>
        </div>
      </div>
    </header>

    <main class="body">
      <Board v-if="view === 'board'" />
      <Demo v-else-if="view === 'demo'" />
      <Settings v-else />
    </main>

    <footer class="footer">
      <span>
        THRESHOLDS · <span class="sw ok">■</span> &lt;50 ·
        <span class="sw warn">■</span> 50–80 ·
        <span class="sw crit">■</span> ≥80
      </span>
      <span>
        <template v-if="nextPollSec != null">NEXT POLL {{ nextPollSec }}s · </template>
        NATIVE ADAPTERS · LOCAL ONLY
      </span>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--lb-bg);
  color: var(--lb-ink);
  font-family: var(--lb-sans);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  border-bottom: 1px solid var(--lb-panel-edge);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.led {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.wordmark {
  font-family: var(--lb-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.22em;
}

.version {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-faint);
  letter-spacing: 0.1em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.counts,
.clock {
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-muted);
  letter-spacing: 0.08em;
}

.nav {
  display: flex;
  gap: 4px;
}

.nav-btn {
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--lb-muted);
  cursor: pointer;
}

.nav-btn.active {
  border-color: var(--lb-muted);
  background: var(--lb-panel);
  color: var(--lb-ink);
}

.win-controls {
  display: flex;
  gap: 2px;
  margin-left: 8px;
}

.wc {
  width: 30px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--lb-muted);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.wc:hover {
  background: var(--lb-panel);
  color: var(--lb-ink);
}

.wc-close:hover {
  background: color-mix(in srgb, var(--lb-crit) 25%, transparent);
  color: var(--lb-ink);
}

.body {
  flex: 1;
  padding: 28px;
  overflow-y: auto;
}

.footer {
  display: flex;
  justify-content: space-between;
  padding: 10px 28px;
  border-top: 1px solid var(--lb-panel-edge);
  font-family: var(--lb-mono);
  font-size: 9px;
  color: var(--lb-faint);
  letter-spacing: 0.1em;
}

.sw.ok {
  color: var(--lb-ok);
}
.sw.warn {
  color: var(--lb-warn);
}
.sw.crit {
  color: var(--lb-crit);
}
</style>
