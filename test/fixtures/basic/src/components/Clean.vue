<script setup lang="ts">
import { computed, ref } from 'vue'

const count = ref(0)
const double = computed(() => count.value * 2)
</script>

<template>
  <p @click="count++">{{ double }}</p>
</template>
