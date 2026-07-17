<script setup lang="ts">
import { computed } from "vue";
import { statusColor, T } from "../theme";
import { windowPct, type UsageWindow } from "../adapters/types";
import Countdown from "./Countdown.vue";
import Gauge from "./Gauge.vue";

const props = defineProps<{ w: UsageWindow }>();

const pct = computed(() => windowPct(props.w));
const color = computed(() => (pct.value != null ? statusColor(pct.value) : T.ink));
</script>

<template>
  <div class="meter">
    <div class="row">
      <div>
        <span class="label">{{ w.label }}</span>
        <span class="sub">{{ w.sub }}</span>
      </div>
      <div class="right">
        <span class="reset">
          <template v-if="w.resetsAt">↻ <Countdown :target="w.resetsAt" /></template>
          <template v-else>no reset</template>
        </span>
        <span class="value" :style="{ color }">
          <template v-if="w.amountUsd != null">
            <span class="unit">$</span>{{ w.amountUsd.toFixed(2)
            }}<span v-if="w.capUsd != null" class="unit"> / ${{ w.capUsd.toFixed(0) }}</span>
          </template>
          <template v-else-if="w.usedPct != null">
            {{ Math.round(w.usedPct) }}<span class="unit">%</span>
          </template>
        </span>
      </div>
    </div>
    <Gauge v-if="pct != null" :pct="pct" />
  </div>
</template>

<style scoped>
.meter {
  padding: 14px 0;
  border-top: 1px solid var(--lb-panel-edge);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.label {
  font-family: var(--lb-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--lb-muted);
  text-transform: uppercase;
}

.sub {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-faint);
  margin-left: 8px;
}

.right {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.reset {
  font-family: var(--lb-mono);
  font-size: 10px;
  color: var(--lb-muted);
}

.value {
  font-family: var(--lb-mono);
  font-size: 20px;
  font-weight: 600;
}

.unit {
  font-size: 11px;
  color: var(--lb-muted);
}
</style>
