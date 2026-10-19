<script setup lang="ts">
/**
 * The contacts page's sections, in the page bar next to its title: the
 * people, the saved segments, and the databases they sync from. Each is a
 * `?view=` of the same page.
 */
defineProps<{ current: 'people' | 'segments' | 'sources' }>()

const tabs = [
  { value: 'people', label: 'People', icon: 'i-lucide-users' },
  { value: 'segments', label: 'Segments', icon: 'i-lucide-filter' },
  { value: 'sources', label: 'Sources', icon: 'i-lucide-database' }
] as const
</script>

<template>
  <nav class="ml-1.5 flex shrink-0 items-center gap-0.5 rounded-md border border-default p-0.5" aria-label="Contacts sections">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.value"
      :to="{ query: tab.value === 'people' ? {} : { view: tab.value } }"
      class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-colors"
      :class="current === tab.value ? 'bg-elevated text-highlighted' : 'text-muted hover:text-default'"
      :aria-current="current === tab.value ? 'page' : undefined"
    >
      <UIcon :name="tab.icon" class="size-3.5" />
      <span class="hidden sm:inline">{{ tab.label }}</span>
    </NuxtLink>
  </nav>
</template>
