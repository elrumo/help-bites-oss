<template>
  <!-- `tile` is the sidebar's team-style icon: the project's initial on its colour. -->
  <img
    v-if="tile && iconUrl"
    :src="iconUrl"
    :alt="name"
    class="size-[18px] shrink-0 rounded-[5px] object-cover ring-1 ring-inset ring-black/5 dark:ring-white/15"
  >
  <span
    v-else-if="tile"
    class="grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold text-white ring-1 ring-inset ring-black/5 dark:ring-white/15"
    :style="{ backgroundColor: color }"
    aria-hidden="true"
  >{{ (name || '?').slice(0, 1).toUpperCase() }}</span>
  <img
    v-else-if="iconUrl"
    :src="iconUrl"
    :alt="name"
    :title="name"
    class="inline-block size-2.5 shrink-0 rounded-full object-cover ring-2 ring-(--ui-bg)"
  >
  <span
    v-else
    class="inline-block size-2.5 rounded-full shrink-0 ring-2 ring-(--ui-bg)"
    :style="{ backgroundColor: color }"
    :title="name"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
// The one visual device the panel leans on: every project has a colour, and it
// tags every conversation, end user and filter that belongs to it.
import { projectColor } from '~/utils/projectColor'

const props = defineProps<{ projectId?: string, accent?: string, name?: string, tile?: boolean, iconUrl?: string }>()
const color = computed(() => props.accent || projectColor(props.projectId || ''))
</script>
