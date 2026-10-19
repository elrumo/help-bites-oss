<script setup lang="ts">
/** The campaigns page's sections: broadcasts, automated sequences, and the newsletter settings. */
defineProps<{ current: 'campaigns' | 'sequences' | 'settings' }>()

const { t } = useI18n()
const tabs = computed(() => [
  { value: 'campaigns', label: t('campaigns.tabs.campaigns'), icon: 'i-lucide-megaphone' },
  { value: 'sequences', label: t('campaigns.tabs.sequences'), icon: 'i-lucide-workflow' },
  { value: 'settings', label: t('campaigns.tabs.settings'), icon: 'i-lucide-settings-2' }
] as const)
</script>

<template>
  <nav class="ml-1.5 flex shrink-0 items-center gap-0.5 rounded-md border border-default p-0.5" :aria-label="$t('campaigns.tabs.label')">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.value"
      :to="{ path: $route.path.replace(/\/campaigns\/.*$/, '/campaigns'), query: tab.value === 'campaigns' ? {} : { view: tab.value } }"
      class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-colors"
      :class="current === tab.value ? 'bg-elevated text-highlighted' : 'text-muted hover:text-default'"
      :aria-current="current === tab.value ? 'page' : undefined"
    >
      <UIcon :name="tab.icon" class="size-3.5" />
      <span class="hidden sm:inline">{{ tab.label }}</span>
    </NuxtLink>
  </nav>
</template>
