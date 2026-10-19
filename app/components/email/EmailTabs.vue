<script setup lang="ts">
/**
 * The email page's sections, in the page bar next to its title: the
 * templates (masters on /emails), the component library, the log of
 * everything sent, and the addresses that are no longer mailed. Each is a
 * `?view=` of the same page; the log is the one you land on.
 */
const props = defineProps<{ current: 'templates' | 'components' | 'log' | 'suppressions', masters?: boolean }>()

const tabs = computed(() => [
  { value: 'templates', label: props.masters ? 'Masters' : 'Templates', icon: 'i-lucide-layout-template' },
  { value: 'components', label: 'Components', icon: 'i-lucide-puzzle' },
  { value: 'log', label: 'Log', icon: 'i-lucide-history' },
  { value: 'suppressions', label: 'Suppressed', icon: 'i-lucide-mail-x' }
] as const)
</script>

<template>
  <nav class="ml-1.5 flex shrink-0 items-center gap-0.5 rounded-md border border-default p-0.5" aria-label="Email sections">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.value"
      :to="{ query: { view: tab.value } }"
      class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-colors"
      :class="current === tab.value ? 'bg-elevated text-highlighted' : 'text-muted hover:text-default'"
      :aria-current="current === tab.value ? 'page' : undefined"
    >
      <UIcon :name="tab.icon" class="size-3.5" />
      <span class="hidden sm:inline">{{ tab.label }}</span>
    </NuxtLink>
  </nav>
</template>
