<script setup lang="ts">
/**
 * The short tour a new account sees once: five cards, skippable at any point (the close button,
 * Escape, or "Skip tour"), replayable from Settings → Account. `tourPending` on the agent is what
 * says it has not been seen; finishing or skipping clears it on the server (PATCH /admin/me), so
 * it stays gone on every device. The native app has the same tour (WelcomeTourSheet.swift).
 */
const { api, agent, projects, demo } = useAgent()
const open = useState('tour-open', () => false)
const newProjectOpen = useState('new-project-open', () => false)

const steps = [
  { key: 'welcome', icon: 'i-lucide-sparkles' },
  { key: 'projects', icon: 'i-lucide-boxes' },
  { key: 'talk', icon: 'i-lucide-inbox' },
  { key: 'grow', icon: 'i-lucide-lightbulb' },
  { key: 'team', icon: 'i-lucide-users-round' }
] as const
const step = ref(0)
const current = computed(() => steps[step.value]!)
const last = computed(() => step.value === steps.length - 1)

// A demo visitor has an agent that never signed up, so the tour only opens for real accounts.
onMounted(() => { if (agent.value?.tourPending && !demo.value) open.value = true })
watch(open, (isOpen) => {
  if (isOpen) step.value = 0
  else if (agent.value?.tourPending) markSeen()
})

async function markSeen() {
  if (agent.value) agent.value = { ...agent.value, tourPending: false }
  await api('/admin/me', { method: 'PATCH', body: { tourPending: false } }).catch(() => {})
}

function finish() {
  open.value = false
  // The one thing everything else hangs off.
  if (last.value && !projects.value.length) newProjectOpen.value = true
}
</script>

<template>
  <UModal v-model:open="open" :title="$t(`welcomeTour.${current.key}.title`)" :description="$t(`welcomeTour.${current.key}.body`)" :ui="{ content: 'sm:max-w-md' }">
    <template #body>
      <div class="flex flex-col items-center gap-5 py-2 text-center">
        <span class="grid size-14 place-items-center rounded-2xl bg-primary-500/10 text-primary-500" aria-hidden="true"><UIcon :name="current.icon" class="size-7" /></span>
        <ul class="w-full space-y-2 text-left text-[13px] text-default">
          <li v-for="n in 3" :key="`${current.key}-${n}`" class="flex items-start gap-2.5 rounded-lg bg-elevated/60 px-3 py-2">
            <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-primary-500" />
            <span>{{ $t(`welcomeTour.${current.key}.point${n}`) }}</span>
          </li>
        </ul>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full items-center gap-2">
        <UButton v-if="!last" color="neutral" variant="ghost" :label="$t('welcomeTour.skip')" @click="open = false" />
        <span class="mx-auto flex items-center gap-1.5" role="img" :aria-label="$t('welcomeTour.progress', { current: step + 1, total: steps.length })">
          <span v-for="(item, i) in steps" :key="item.key" class="h-1.5 rounded-full transition-all" :class="i === step ? 'w-4 bg-primary-500' : 'w-1.5 bg-accented'" />
        </span>
        <UButton v-if="step > 0" color="neutral" variant="outline" :label="$t('welcomeTour.back')" @click="step--" />
        <UButton v-if="!last" :label="$t('welcomeTour.next')" trailing-icon="i-lucide-arrow-right" @click="step++" />
        <UButton v-else :label="projects.length ? $t('welcomeTour.done') : $t('welcomeTour.createProject')" @click="finish" />
      </div>
    </template>
  </UModal>
</template>
