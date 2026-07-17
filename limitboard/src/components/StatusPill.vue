<script setup lang="ts">
import { computed } from "vue";
import { statusColor, statusWord } from "../theme";

const props = defineProps<{ pct: number }>();

const color = computed(() => statusColor(props.pct));
const word = computed(() => statusWord(props.pct));
</script>

<template>
  <span
    class="pill"
    :style="{
      color,
      borderColor: `${color}44`,
      background: `${color}14`,
    }"
  >
    {{ word }}
  </span>
</template>

<style scoped>
.pill {
  font-family: var(--lb-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  border: 1px solid;
  padding: 3px 8px;
  border-radius: 3px;
}
</style>
