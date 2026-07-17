<script setup lang="ts">
import { computed } from "vue";
import { statusColor } from "../theme";
import { windowPct, type UsageWindow } from "../adapters/types";
import StatusPill from "./StatusPill.vue";
import WindowMeter from "./WindowMeter.vue";

const props = defineProps<{
  name: string;
  plan: string;
  glyph: string;
  method: string;
  windows: UsageWindow[];
  stat?: string;
  /** Seconds since last successful poll. */
  syncAge: number;
  /** Set ⇒ degraded: data is stale, show the error badge. */
  error?: string;
  /** Seconds until the next poll attempt (error cooldown); 0/absent = none. */
  retryInSec?: number;
  /** Show the pop-out affordance (board only, not inside a widget window). */
  popoutable?: boolean;
}>();

const emit = defineEmits<{ popout: [] }>();

const worst = computed(() => {
  const pcts = props.windows
    .map(windowPct)
    .filter((v): v is number => v != null);
  return pcts.length ? Math.max(...pcts) : 0;
});

const color = computed(() => statusColor(worst.value));

const syncText = computed(() => {
  const s = props.syncAge;
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
});

const retryText = computed(() => {
  const s = props.retryInSec ?? 0;
  if (s <= 0) return null;
  return s < 90 ? `retry in ${s}s` : `retry in ${Math.ceil(s / 60)}m`;
});

// The snapshot's error text may carry a "retry in ~Xm" hint frozen at poll
// time — replace it with the live cooldown countdown when we have one.
const errorText = computed(() => {
  if (!props.error) return null;
  return retryText.value
    ? props.error.replace(/ · retry in ~\d+[a-z]*$/, "")
    : props.error;
});
</script>

<template>
  <div class="card" :class="{ degraded: !!error }">
    <div class="head">
      <div class="identity">
        <span class="glyph" :style="{ color }">{{ glyph }}</span>
        <div>
          <div class="name">{{ name }}</div>
          <div class="plan">{{ plan }}</div>
        </div>
      </div>
      <div class="head-right">
        <span v-if="error" class="stale">STALE</span>
        <StatusPill :pct="worst" />
        <button
          v-if="popoutable"
          class="popout"
          title="Pop out as widget"
          @click="emit('popout')"
        >
          ⧉
        </button>
      </div>
    </div>

    <WindowMeter v-for="(w, i) in windows" :key="i" :w="w" />

    <div v-if="!windows.length" class="nodata">
      {{ errorText ? `awaiting data · ${errorText}` : "awaiting first poll…" }}
      <div v-if="error && retryText" class="retry">{{ retryText }}</div>
    </div>

    <div class="foot">
      <span class="method">{{ method }}</span>
      <span>
        {{ stat ? `${stat} · ` : "" }}sync {{ syncText
        }}{{ windows.length && retryText ? ` · ${retryText}` : "" }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--lb-panel);
  border: 1px solid var(--lb-panel-edge);
  border-radius: 8px;
  padding: 18px 20px 8px;
  display: flex;
  flex-direction: column;
}

.card.degraded {
  border-style: dashed;
  opacity: 0.75;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.glyph {
  font-size: 14px;
}

.name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.plan {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-muted);
  margin-top: 1px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stale {
  font-family: var(--lb-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--lb-warn);
  border: 1px solid color-mix(in srgb, var(--lb-warn) 27%, transparent);
  background: color-mix(in srgb, var(--lb-warn) 8%, transparent);
  padding: 3px 8px;
  border-radius: 3px;
}

.popout {
  font-size: 12px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 3px;
  border: 1px solid var(--lb-panel-edge);
  background: transparent;
  color: var(--lb-muted);
  cursor: pointer;
}

.popout:hover {
  color: var(--lb-ink);
  border-color: var(--lb-muted);
}

.nodata {
  padding: 26px 0;
  border-top: 1px solid var(--lb-panel-edge);
  font-family: var(--lb-mono);
  font-size: 11px;
  color: var(--lb-muted);
  text-align: center;
}

.retry {
  margin-top: 8px;
  font-size: 10px;
  color: var(--lb-warn);
  letter-spacing: 0.08em;
}

.foot {
  border-top: 1px solid var(--lb-panel-edge);
  margin-top: auto;
  padding: 10px 0;
  display: flex;
  justify-content: space-between;
  font-family: var(--lb-mono);
  font-size: 9px;
  color: var(--lb-faint);
  letter-spacing: 0.04em;
}

.method {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}
</style>
