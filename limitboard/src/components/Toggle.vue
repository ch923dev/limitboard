<script setup lang="ts">
defineProps<{
  on: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    class="toggle"
    :class="{ on, disabled }"
    :disabled="disabled"
    role="switch"
    :aria-checked="on"
    @click="emit('toggle')"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.toggle {
  width: 40px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--lb-faint);
  background: transparent;
  cursor: pointer;
  position: relative;
  padding: 0;
}

.toggle.on {
  border-color: var(--lb-ok);
  background: color-mix(in srgb, var(--lb-ok) 20%, transparent);
}

.toggle.disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--lb-muted);
  transition: left 200ms;
}

.toggle.on .knob {
  left: 21px;
  background: var(--lb-ok);
}
</style>
