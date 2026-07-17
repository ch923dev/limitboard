<script setup lang="ts">
// Content of the transparent drag-ghost window: a dashed footprint outline
// with the live pixel size. The window itself is sized to the footprint, so
// the label just reads the viewport.
import { onMounted, onUnmounted, ref } from "vue";

const w = ref(window.innerWidth);
const h = ref(window.innerHeight);
const onResize = () => {
  w.value = window.innerWidth;
  h.value = window.innerHeight;
};

onMounted(() => {
  // styles.css paints an opaque app background — this window must stay clear.
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  window.addEventListener("resize", onResize);
});
onUnmounted(() => window.removeEventListener("resize", onResize));
</script>

<template>
  <div class="ghost">
    <span>{{ w }} × {{ h }}</span>
  </div>
</template>

<style scoped>
.ghost {
  position: fixed;
  inset: 0;
  border: 1.5px dashed color-mix(in srgb, var(--lb-ok) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--lb-ok) 7%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--lb-mono);
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--lb-ok);
}
</style>
