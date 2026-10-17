<script setup lang="ts">
import { ref } from 'vue'

import Counter from './Counter.vue'
import Clean from '@/components/Clean.vue'
import { format } from '../format'

const count: number = 'not a number'
const user = ref({ name: 'x' })
function pick(value: number): string {
  return format(value + count)
}
</script>

<template>
  <div>
    {{ user.missing }}
    <Counter :start="'1'" @change="pick('a')" />
    <Counter :start="1" label="ok" />
    <Clean :extra="true" />
  </div>
</template>
