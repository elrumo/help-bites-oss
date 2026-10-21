<script setup lang="ts">
/**
 * One page bar for everything email. A project's Email section is Templates
 * (with the component library behind it), Campaigns, Sequences, the Log (with
 * the suppressed addresses behind it) and Settings, where its one sender lives.
 * The shared templates on /emails have no campaigns or sender of their own, so
 * they keep just templates, components, the log and suppressions. Each is a
 * `?view=` of the same page.
 */
type View = 'templates' | 'components' | 'log' | 'suppressions' | 'campaigns' | 'sequences' | 'settings'
const props = defineProps<{ current: View, masters?: boolean }>()
const { t } = useI18n()
const route = useRoute()
const { locked } = usePlanLocks()

/** Where the page is: the project's email section, or the shared templates. */
const base = computed(() => (props.masters ? '/emails' : `/projects/${String(route.params.id || '')}/email`))
// Components belong under Templates and suppressions under the Log, in a project's bar.
const highlighted = computed(() => (props.masters ? props.current : props.current === 'components' ? 'templates' : props.current === 'suppressions' ? 'log' : props.current))

const tabs = computed(() => props.masters
  ? [
      { value: 'templates', label: t('emailEditor.masters'), icon: 'i-lucide-layout-template' },
      { value: 'components', label: t('emailEditor.components'), icon: 'i-lucide-puzzle' },
      { value: 'log', label: t('emailEditor.log'), icon: 'i-lucide-history' },
      { value: 'suppressions', label: t('emailEditor.suppressed'), icon: 'i-lucide-mail-x' }
    ]
  : [
      { value: 'templates', label: t('emailEditor.templates'), icon: 'i-lucide-layout-template' },
      { value: 'campaigns', label: t('campaigns.tabs.campaigns'), icon: 'i-lucide-megaphone', lock: locked('campaigns') },
      { value: 'sequences', label: t('campaigns.tabs.sequences'), icon: 'i-lucide-workflow', lock: locked('campaigns') },
      { value: 'log', label: t('emailEditor.log'), icon: 'i-lucide-history' },
      { value: 'settings', label: t('emailEditor.settings'), icon: 'i-lucide-settings-2' }
    ])
</script>

<template>
  <nav class="ml-1.5 flex shrink-0 items-center gap-0.5 rounded-md border border-default p-0.5" :aria-label="$t('emailEditor.emailSections')">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.value"
      :to="{ path: base, query: { view: tab.value } }"
      class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-colors"
      :class="highlighted === tab.value ? 'bg-elevated text-highlighted' : 'text-muted hover:text-default'"
      :aria-current="highlighted === tab.value ? 'page' : undefined"
    >
      <UIcon :name="tab.icon" class="size-3.5" />
      <span class="hidden sm:inline">{{ tab.label }}</span>
      <UIcon v-if="'lock' in tab && tab.lock" name="i-lucide-lock" class="size-3 text-dimmed" :title="$t('workspaceSettings.planLimit.notInPlan')" />
    </NuxtLink>
  </nav>
</template>
