<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderId } from "../adapters/types";
import { useProvidersStore } from "../stores/providers";
import { useUsageStore } from "../stores/usage";
import { loadWidgetSize, WIDGET_DEFAULT } from "../stores/widgetSize";
import ProviderCard from "../components/ProviderCard.vue";

const providers = useProvidersStore();
const usage = useUsageStore();

// 1s ticker so staleness ages and countdowns feel live.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clearInterval(timer));

const cards = computed(() =>
  providers.enabledProviders.map((p) => {
    const snap = usage.snapshots[p.id];
    return {
      ...p,
      windows: snap?.windows ?? [],
      stat: snap?.stat,
      error: snap?.error,
      syncAge: snap
        ? Math.max(0, Math.floor((now.value - snap.fetchedAt) / 1000))
        : 0,
      retryInSec: usage.retryInSec(p.id, now.value),
    };
  }),
);

// Network-loss case (spec AC-4): every enabled card degraded at once.
const allDegraded = computed(
  () => cards.value.length > 0 && cards.value.every((c) => !!c.error),
);

// ── drag-to-widget ───────────────────────────────────────────
// Drag a card past the app window's edge and release → it opens as a
// floating always-on-top widget window at the drop point (T25).
const drag = reactive({
  active: false,
  id: null as ProviderId | null,
  x: 0,
  y: 0,
  startX: 0,
  startY: 0,
  outside: false,
});

async function openWidget(id: ProviderId, screenX?: number, screenY?: number) {
  const size = loadWidgetSize(id); // widget reopens at its remembered size
  await invoke("open_widget", {
    providerId: id,
    x: screenX ?? 120,
    y: screenY ?? 120,
    width: size.w,
    height: size.h,
  });
}

// Footprint the dragged card will occupy as a widget — drives the ghost
// preview and the drop offset (cursor sits at the ghost's title bar).
const ghostSize = computed(() =>
  drag.id ? loadWidgetSize(drag.id) : WIDGET_DEFAULT,
);

function onCardPointerDown(id: ProviderId, e: PointerEvent) {
  // Left button only; buttons inside the card keep their own clicks.
  if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
  drag.id = id;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.active = false;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onCardPointerMove(e: PointerEvent) {
  if (!drag.id) return;
  if (!drag.active) {
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved < 10) return;
    drag.active = true;
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.outside =
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight;
}

async function onCardPointerUp(e: PointerEvent) {
  const id = drag.id;
  const wasActive = drag.active;
  const outside = drag.outside;
  drag.id = null;
  drag.active = false;
  drag.outside = false;
  if (!id || !wasActive || !outside) return;
  // screenX/Y are OS screen coords (CSS px) — good enough for placement.
  const { w } = loadWidgetSize(id);
  await openWidget(id, e.screenX - Math.round(w / 2), e.screenY - 40);
}
</script>

<template>
  <div v-if="cards.length" @pointermove="onCardPointerMove" @pointerup="onCardPointerUp">
    <div v-if="allDegraded" class="banner">
      ALL PROVIDERS DEGRADED — showing last-good data · check network
    </div>
    <div class="grid">
      <div
        v-for="c in cards"
        :key="c.id"
        class="card-slot"
        :class="{ lifting: drag.active && drag.id === c.id }"
        @pointerdown="onCardPointerDown(c.id, $event)"
        @pointermove="onCardPointerMove"
        @pointerup="onCardPointerUp"
      >
        <ProviderCard
          :name="c.name"
          :plan="c.plan"
          :glyph="c.glyph"
          :method="c.method"
          :windows="c.windows"
          :stat="c.stat"
          :error="c.error"
          :sync-age="c.syncAge"
          :retry-in-sec="c.retryInSec"
          popoutable
          @popout="openWidget(c.id)"
        />
      </div>
    </div>
    <div v-if="drag.active" class="drag-hint" :class="{ armed: drag.outside }">
      {{ drag.outside ? "release to pop out ⧉" : "drag past the window edge to pop out" }}
      · {{ ghostSize.w }} × {{ ghostSize.h }}
    </div>
    <div
      v-if="drag.active"
      class="ghost"
      :class="{ armed: drag.outside }"
      :style="{
        left: `${drag.x - Math.round(ghostSize.w / 2)}px`,
        top: `${drag.y - 40}px`,
        width: `${ghostSize.w}px`,
        height: `${ghostSize.h}px`,
      }"
    >
      <span>{{ ghostSize.w }} × {{ ghostSize.h }}</span>
    </div>
  </div>
  <div v-else class="empty">
    No agents monitored. Enable one in Settings to add its gauge.
  </div>
</template>

<style scoped>
.banner {
  max-width: 1400px;
  margin: 0 auto 16px;
  padding: 10px 16px;
  border: 1px solid color-mix(in srgb, var(--lb-warn) 40%, transparent);
  background: color-mix(in srgb, var(--lb-warn) 10%, transparent);
  border-radius: 6px;
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--lb-warn);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px;
  max-width: 1400px;
  margin: 0 auto;
}

.card-slot {
  touch-action: none;
}

.card-slot.lifting {
  opacity: 0.55;
  outline: 1px dashed var(--lb-muted);
  outline-offset: 4px;
  border-radius: 8px;
}

.drag-hint {
  position: fixed;
  bottom: 46px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--lb-panel-edge);
  background: var(--lb-panel);
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--lb-muted);
  pointer-events: none;
}

.drag-hint.armed {
  border-color: color-mix(in srgb, var(--lb-ok) 50%, transparent);
  color: var(--lb-ok);
}

/* Footprint preview of the widget window that will open on release. */
.ghost {
  position: fixed;
  border: 1px dashed var(--lb-muted);
  border-radius: 8px;
  background: color-mix(in srgb, var(--lb-panel) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--lb-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--lb-muted);
  pointer-events: none;
  z-index: 10;
}

.ghost.armed {
  border-color: color-mix(in srgb, var(--lb-ok) 60%, transparent);
  color: var(--lb-ok);
}

.empty {
  text-align: center;
  margin-top: 120px;
  color: var(--lb-muted);
  font-size: 14px;
}
</style>
