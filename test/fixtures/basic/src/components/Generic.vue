<script setup lang="ts" generic="T extends string | number">
defineProps<{ items: T[]; selected?: T }>()
</script>

<template>
  <ul>
    <li v-for="item in items" :key="item">{{ item.toFixed(1) }}</li>
  </ul>
</template>
