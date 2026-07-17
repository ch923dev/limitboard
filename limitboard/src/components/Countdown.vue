<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  /** Epoch ms or ISO 8601 string. */
  target: number | string;
}>();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clearInterval(timer));

const text = computed(() => {
  const targetMs =
    typeof props.target === "number"
      ? props.target
      : new Date(props.target).getTime();
  const s = Math.max(0, Math.floor((targetMs - now.value) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0
    ? `${d}d ${String(h).padStart(2, "0")}h`
    : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
});
</script>

<template>
  <span class="countdown">{{ text }}</span>
</template>

<style scoped>
.countdown {
  font-family: var(--lb-mono);
}
</style>
