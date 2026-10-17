<script setup lang="ts">
defineProps<{ start: number; label?: string }>()
defineEmits<{ change: [value: number] }>()
</script>

<template>
  <button type="button">{{ label }}</button>
</template>
