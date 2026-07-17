<script setup lang="ts">
import { computed } from "vue";
import { statusColor } from "../theme";

const props = defineProps<{ pct: number }>();

const TICKS = 40;

const ticks = computed(() =>
  Array.from({ length: TICKS }, (_, i) => {
    const tickPct = (i / (TICKS - 1)) * 100;
    return {
      lit: tickPct <= props.pct,
      major: i % 10 === 0 || i === TICKS - 1,
    };
  }),
);

const color = computed(() => statusColor(props.pct));
</script>

<template>
  <div class="gauge">
    <div class="scale">
      <div
        v-for="(t, i) in ticks"
        :key="i"
        class="tick"
        :class="{ major: t.major, lit: t.lit }"
        :style="t.lit ? { background: color } : undefined"
      />
    </div>
    <div class="needle" :style="{ left: `calc(${pct}% - 4px)` }" />
    <div class="labels">
      <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  height: 26px;
  margin-top: 6px;
}

.scale {
  display: flex;
  gap: 3px;
  align-items: flex-end;
  height: 14px;
}

.tick {
  flex: 1;
  height: 9px;
  background: var(--lb-faint);
  opacity: 0.55;
  border-radius: 1px;
  transition:
    background 600ms,
    opacity 600ms;
}

.tick.major {
  height: 14px;
}

.tick.lit {
  opacity: 1;
}

.needle {
  position: absolute;
  top: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid var(--lb-ink);
  transition: left 800ms cubic-bezier(0.4, 0, 0.2, 1);
}

.labels {
  display: flex;
  justify-content: space-between;
  font-family: var(--lb-mono);
  font-size: 9px;
  color: var(--lb-faint);
  margin-top: 4px;
  letter-spacing: 0.08em;
}
</style>
