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
  // Footprint the widget will open at — captured once per drag.
  w: WIDGET_DEFAULT.w,
  h: WIDGET_DEFAULT.h,
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

// ── native drag ghost ────────────────────────────────────────
// A DOM ghost can't leave the webview, so the footprint preview is a real
// transparent click-through window that follows the cursor everywhere.
let ghostVisible = false;
let ghostPending = false;
let lastGhostMove = 0;

async function showGhost(e: PointerEvent) {
  if (ghostVisible || ghostPending) return;
  ghostPending = true;
  try {
    await invoke("show_drag_ghost", {
      x: e.screenX,
      y: e.screenY,
      width: drag.w,
      height: drag.h,
    });
    ghostVisible = true;
  } finally {
    ghostPending = false;
  }
}

function moveGhost(e: PointerEvent) {
  if (!ghostVisible) return;
  const t = performance.now();
  if (t - lastGhostMove < 30) return; // ~33fps is plenty for a preview
  lastGhostMove = t;
  void invoke("move_drag_ghost", { x: e.screenX, y: e.screenY, width: drag.w });
}

function hideGhost() {
  if (!ghostVisible && !ghostPending) return;
  ghostVisible = false;
  void invoke("hide_drag_ghost");
}

function onCardPointerDown(id: ProviderId, e: PointerEvent) {
  // Left button only; buttons inside the card keep their own clicks.
  if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
  drag.id = id;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.active = false;
  const size = loadWidgetSize(id);
  drag.w = size.w;
  drag.h = size.h;
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
  void showGhost(e);
  moveGhost(e);
}

async function onCardPointerUp(e: PointerEvent) {
  const id = drag.id;
  const wasActive = drag.active;
  const outside = drag.outside;
  const w = drag.w;
  drag.id = null;
  drag.active = false;
  drag.outside = false;
  hideGhost();
  if (!id || !wasActive || !outside) return;
  // screenX/Y are OS screen coords (CSS px) — the widget replaces the ghost
  // exactly where it was hovering.
  await openWidget(id, e.screenX - Math.round(w / 2), e.screenY - 40);
}

function onCardPointerCancel() {
  drag.id = null;
  drag.active = false;
  drag.outside = false;
  hideGhost();
}
</script>

<template>
  <div
    v-if="cards.length"
    @pointermove="onCardPointerMove"
    @pointerup="onCardPointerUp"
    @pointercancel="onCardPointerCancel"
  >
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
        @pointercancel="onCardPointerCancel"
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
      · {{ drag.w }} × {{ drag.h }}
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

.empty {
  text-align: center;
  margin-top: 120px;
  color: var(--lb-muted);
  font-size: 14px;
}
</style>
