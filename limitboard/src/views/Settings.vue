<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useProvidersStore } from "../stores/providers";
import { useSettingsStore } from "../stores/settings";
import type { ProviderId } from "../adapters/types";
import Toggle from "../components/Toggle.vue";

const providers = useProvidersStore();
const settings = useSettingsStore();

const orKey = ref("");
const orKeySaved = ref(false);

// Ticks so a timed mute's countdown label stays live and expiry flips the UI.
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  nowTimer = setInterval(() => (now.value = Date.now()), 1000);
  const stored = await invoke<string | null>("get_secret", { name: "openrouter" });
  orKeySaved.value = !!stored;
});

onUnmounted(() => clearInterval(nowTimer));

async function onToggle(id: ProviderId) {
  const p = providers.byId(id);
  if (!p) return;
  const next = !p.enabled;
  providers.setEnabled(id, next);
  await settings.setEnabled(id, next);
}

async function saveOrKey() {
  const key = orKey.value.trim();
  if (!key) return;
  await invoke("set_secret", { name: "openrouter", value: key });
  orKey.value = "";
  orKeySaved.value = true;
  await providers.rescan();
}

async function clearOrKey() {
  await invoke("delete_secret", { name: "openrouter" });
  orKeySaved.value = false;
  await providers.rescan();
}

async function onIntervalChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (v >= 10) {
    settings.pollIntervalSec = v;
    await settings.save();
  }
}

async function onThresholdChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (v >= 1 && v <= 100) {
    settings.notifyPct = v;
    await settings.save();
  }
}

async function onProviderPctChange(id: ProviderId, e: Event) {
  const input = e.target as HTMLInputElement;
  const raw = input.value.trim();
  if (!raw) {
    await settings.setProviderNotifyPct(id, undefined); // blank ⇒ inherit global
    return;
  }
  const v = Number(raw);
  if (v >= 1 && v <= 100) await settings.setProviderNotifyPct(id, v);
  else input.value = String(settings.notifyPctByProvider?.[id] ?? "");
}

const HOUR = 3_600_000;
const MUTE_PRESETS = [
  { label: "1H", ms: HOUR },
  { label: "8H", ms: 8 * HOUR },
  { label: "24H", ms: 24 * HOUR },
];

const muted = computed(() => settings.isMuted(now.value));

const muteLabel = computed(() => {
  if (settings.muteUntil === "forever") return "muted until you unmute";
  if (typeof settings.muteUntil === "number" && settings.muteUntil > now.value) {
    const t = new Date(settings.muteUntil).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `muted until ${t}`;
  }
  return "notifications active";
});

async function onSoftCapChange(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  settings.openrouterSoftCapUsd = raw ? Math.max(0, Number(raw)) || undefined : undefined;
  await settings.save();
}

async function onAutostartToggle() {
  settings.autostart = !settings.autostart;
  try {
    if (settings.autostart) await enable();
    else await disable();
  } catch {
    settings.autostart = await isEnabled().catch(() => false);
  }
  await settings.save();
}

const openrouter = computed(() => providers.byId("openrouter"));
</script>

<template>
  <div class="settings">
    <div class="head-row">
      <div>
        <div class="kicker">DETECTED AGENTS — SELECT WIDGETS</div>
        <div class="hint">
          Limitboard scans config directories and PATH on launch. Enabled
          agents render as gauges on the board.
        </div>
      </div>
      <button class="rescan" :disabled="providers.scanning" @click="providers.rescan()">
        {{ providers.scanning ? "SCANNING…" : "RESCAN" }}
      </button>
    </div>

    <div
      v-for="p in providers.providers"
      :key="p.id"
      class="row"
      :class="{ undetected: !p.detected }"
    >
      <div class="row-main">
        <span class="glyph" :style="{ color: p.detected ? 'var(--lb-ok)' : 'var(--lb-faint)' }">
          {{ p.glyph }}
        </span>
        <div>
          <div class="row-name">
            {{ p.name }}
            <span v-if="!p.detected" class="nd">NOT DETECTED</span>
          </div>
          <div class="row-evidence">{{ p.evidence }}</div>
        </div>
      </div>
      <div class="row-controls">
        <label v-if="p.detected" class="pct-override">
          NOTIFY
          <input
            type="number"
            class="field pct-field"
            min="1"
            max="100"
            step="5"
            :value="settings.notifyPctByProvider?.[p.id] ?? ''"
            :placeholder="String(settings.notifyPct)"
            @change="onProviderPctChange(p.id, $event)"
          />
          %
        </label>
        <Toggle :on="p.enabled" :disabled="!p.detected" @toggle="onToggle(p.id)" />
      </div>
    </div>

    <!-- OpenRouter key management: sole manual-credential exception (spec FR-1). -->
    <div v-if="openrouter" class="or-key">
      <div class="kicker">OPENROUTER API KEY</div>
      <div class="or-key-row">
        <template v-if="orKeySaved">
          <span class="or-status">key stored in Windows Credential Manager</span>
          <button class="btn danger" @click="clearOrKey">REMOVE KEY</button>
        </template>
        <template v-else>
          <input
            v-model="orKey"
            type="password"
            class="field key-field"
            placeholder="sk-or-v1-…"
            spellcheck="false"
          />
          <button class="btn" :disabled="!orKey.trim()" @click="saveOrKey">SAVE</button>
        </template>
      </div>
      <div class="or-cap-row">
        <label class="cap-label" for="softcap">MONTHLY SOFT CAP $</label>
        <input
          id="softcap"
          type="number"
          class="field cap-field"
          min="0"
          step="5"
          :value="settings.openrouterSoftCapUsd ?? ''"
          placeholder="none"
          @change="onSoftCapChange"
        />
        <span class="cap-hint">gauge + alerts for uncapped keys</span>
      </div>
    </div>

    <div class="mute-panel">
      <div class="kicker">NOTIFICATIONS</div>
      <div class="mute-row">
        <span class="mute-status" :class="{ 'is-muted': muted }">
          {{ muteLabel }}
        </span>
        <div class="mute-actions">
          <template v-if="muted">
            <button class="btn" @click="settings.unmute()">UNMUTE</button>
          </template>
          <template v-else>
            <button
              v-for="preset in MUTE_PRESETS"
              :key="preset.label"
              class="btn"
              @click="settings.muteFor(preset.ms)"
            >
              MUTE {{ preset.label }}
            </button>
            <button class="btn" @click="settings.muteForever()">
              MUTE FOREVER
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="globals">
      <label class="global">
        POLL INTERVAL
        <input
          type="number"
          class="field num"
          min="10"
          step="10"
          :value="settings.pollIntervalSec"
          @change="onIntervalChange"
        />
        s
      </label>
      <label class="global">
        NOTIFY AT
        <input
          type="number"
          class="field num"
          min="1"
          max="100"
          step="5"
          :value="settings.notifyPct"
          @change="onThresholdChange"
        />
        % <span class="global-hint">default — per-agent NOTIFY overrides</span>
      </label>
      <label class="global autostart">
        LAUNCH AT STARTUP
        <Toggle :on="settings.autostart" @toggle="onAutostartToggle" />
      </label>
    </div>
  </div>
</template>

<style scoped>
.settings {
  max-width: 760px;
  margin: 0 auto;
  width: 100%;
}

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.kicker {
  margin-bottom: 6px;
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--lb-muted);
}

.hint {
  font-size: 13px;
  color: var(--lb-muted);
  margin-bottom: 20px;
}

.rescan,
.btn {
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  padding: 7px 14px;
  border-radius: 4px;
  border: 1px solid var(--lb-faint);
  background: var(--lb-panel);
  color: var(--lb-ink);
  cursor: pointer;
  white-space: nowrap;
}

.rescan:disabled,
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn.danger {
  border-color: color-mix(in srgb, var(--lb-crit) 50%, transparent);
  color: var(--lb-crit);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 10px;
}

.row.undetected {
  opacity: 0.5;
}

.row-main {
  display: flex;
  align-items: center;
  gap: 14px;
}

.glyph {
  font-size: 13px;
}

.row-name {
  font-size: 14px;
  font-weight: 600;
}

.nd {
  font-family: var(--lb-mono);
  font-size: 9px;
  color: var(--lb-faint);
  margin-left: 10px;
  letter-spacing: 0.14em;
}

.row-evidence {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-muted);
  margin-top: 3px;
}

.or-key {
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 14px 18px;
  margin: 18px 0;
}

.or-key-row,
.or-cap-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.or-status {
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-ok);
}

.field {
  font-family: var(--lb-mono);
  font-size: 12px;
  background: var(--lb-bg);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 4px;
  color: var(--lb-ink);
  padding: 7px 10px;
  outline: none;
}

.field:focus {
  border-color: var(--lb-muted);
}

.key-field {
  flex: 1;
}

.cap-field {
  width: 90px;
}

.cap-label {
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--lb-muted);
}

.cap-hint {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-faint);
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 18px;
}

.pct-override {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--lb-muted);
}

.pct-field {
  width: 58px;
}

.pct-field::placeholder {
  color: var(--lb-faint);
}

.mute-panel {
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 14px 18px;
  margin: 18px 0;
}

.mute-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.mute-status {
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-ok);
}

.mute-status.is-muted {
  color: var(--lb-crit);
}

.mute-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.global-hint {
  font-family: var(--lb-mono);
  font-size: 9px;
  color: var(--lb-faint);
  letter-spacing: 0.06em;
}

.globals {
  margin-top: 24px;
  display: flex;
  gap: 28px;
  align-items: center;
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-muted);
  letter-spacing: 0.06em;
  flex-wrap: wrap;
}

.global {
  display: flex;
  align-items: center;
  gap: 8px;
}

.num {
  width: 70px;
}
</style>
