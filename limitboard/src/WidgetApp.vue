<script setup lang="ts">
// Floating provider widget window (T25): one card, draggable chrome,
// pin-to-foreground toggle (Task Manager style always-on-top).
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { buildAdapters } from "./adapters";
import type { ProviderId } from "./adapters/types";
import { PROVIDER_META } from "./stores/providers";
import { useSettingsStore } from "./stores/settings";
import { useUsageStore } from "./stores/usage";
import ProviderCard from "./components/ProviderCard.vue";

const props = defineProps<{ providerId: ProviderId }>();

const meta = PROVIDER_META.find((m) => m.id === props.providerId);
const settings = useSettingsStore();
const usage = useUsageStore();
const adapters = buildAdapters(async () => settings.openrouterSoftCapUsd);

const win = getCurrentWindow();
const pinned = ref(true); // widgets open pinned

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
  await settings.load();
  const adapter = adapters.get(props.providerId);
  if (adapter) {
    usage.startPolling(() => [adapter], settings.pollIntervalSec * 1000);
  }
});

onUnmounted(() => {
  clearInterval(timer);
  usage.stopPolling();
});

async function togglePin() {
  pinned.value = !pinned.value;
  await win.setAlwaysOnTop(pinned.value);
}

const closeWidget = () => void win.destroy();

const snap = computed(() => usage.snapshots[props.providerId]);
const syncAge = computed(() =>
  snap.value
    ? Math.max(0, Math.floor((now.value - snap.value.fetchedAt) / 1000))
    : 0,
);
</script>

<template>
  <div class="widget">
    <div class="chrome" data-tauri-drag-region>
      <span class="chrome-title" data-tauri-drag-region>
        {{ meta?.name ?? providerId }}
      </span>
      <div class="chrome-actions">
        <button
          class="chip"
          :class="{ on: pinned }"
          :title="pinned ? 'Unpin from foreground' : 'Pin to foreground'"
          @click="togglePin"
        >
          {{ pinned ? "📌 PINNED" : "📌 PIN" }}
        </button>
        <button class="chip close" title="Close widget" @click="closeWidget">✕</button>
      </div>
    </div>

    <ProviderCard
      v-if="meta"
      class="card"
      :name="meta.name"
      :plan="meta.plan"
      :glyph="meta.glyph"
      :method="meta.method"
      :windows="snap?.windows ?? []"
      :stat="snap?.stat"
      :error="snap?.error"
      :sync-age="syncAge"
      :retry-in-sec="usage.retryInSec(providerId, now)"
    />
    <div v-else class="unknown">unknown provider: {{ providerId }}</div>
  </div>
</template>

<style scoped>
.widget {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--lb-bg);
  color: var(--lb-ink);
  font-family: var(--lb-sans);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  overflow: hidden;
}

.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lb-panel-edge);
  cursor: grab;
  user-select: none;
}

.chrome-title {
  font-family: var(--lb-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--lb-muted);
}

.chrome-actions {
  display: flex;
  gap: 6px;
}

.chip {
  font-family: var(--lb-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid var(--lb-faint);
  background: transparent;
  color: var(--lb-muted);
  cursor: pointer;
}

.chip.on {
  border-color: color-mix(in srgb, var(--lb-ok) 50%, transparent);
  background: color-mix(in srgb, var(--lb-ok) 12%, transparent);
  color: var(--lb-ok);
}

.chip.close:hover {
  border-color: color-mix(in srgb, var(--lb-crit) 50%, transparent);
  color: var(--lb-crit);
}

.card {
  flex: 1;
  margin: 10px;
  overflow-y: auto;
}

.unknown {
  padding: 24px;
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-crit);
}
</style>
