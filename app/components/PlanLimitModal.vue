<template>
  <UModal v-model:open="open" :title="title" :description="shown?.message" :ui="{ content: 'sm:max-w-md' }">
    <template #body>
      <div class="space-y-4">
        <div v-if="usage" class="space-y-2 rounded-xl border border-default p-4">
          <div class="flex items-baseline gap-3 text-[13px]">
            <span class="text-muted">Used</span>
            <span class="ml-auto text-right font-medium tabular-nums text-highlighted">{{ usage.text }}</span>
          </div>
          <UProgress :model-value="usage.percent" :max="100" size="xs" :color="usage.percent >= 100 ? 'error' : 'warning'" />
          <p v-if="usage.hint" class="text-xs text-muted">{{ usage.hint }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Close</UButton>
          <UButton v-if="upgrade" @click="goUpgrade">Upgrade</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { COUNTER_PERIODS, describeLimit, formatBytes } from '#shared/entitlements'
import type { PlanLimit } from '~/composables/useAgent'

// Explains a 402 from anywhere in the panel: api() (and the email designer's
// stream) set `plan-limit`, and the screen that asked still shows its own error.
const { planLimit, context } = useAgent()
const { upgrade } = editionUi()

// Kept after closing, so the text doesn't vanish while the modal fades out.
const shown = ref<PlanLimit | null>(null)
watch(planLimit, (value) => { if (value) shown.value = value }, { immediate: true })
const open = computed({ get: () => !!planLimit.value, set: (value) => { if (!value) planLimit.value = null } })

const title = computed(() => shown.value?.code === 'plan_limit' ? 'You\'ve reached a plan limit' : 'Not part of your plan')

const usage = computed(() => {
  const limit = shown.value
  if (limit?.code !== 'plan_limit') return null
  const used = limit.metric === 'storageBytes' ? formatBytes(limit.used) : limit.used.toLocaleString('en-US')
  const period = limit.metric in COUNTER_PERIODS ? COUNTER_PERIODS[limit.metric as keyof typeof COUNTER_PERIODS] : null
  const hints = [
    period === 'month' ? 'This count starts over on the 1st of next month (UTC).' : period === 'day' ? 'This count starts over at midnight UTC.' : '',
    limit.metric === 'aiCredits' && context.value?.features.byoLlm ? 'Your own AI provider (Settings → AI) uses no credits.' : ''
  ]
  return {
    text: `${used} of ${describeLimit(limit.metric, limit.limit)}`,
    percent: limit.limit ? Math.min(100, Math.round(limit.used / limit.limit * 100)) : 100,
    hint: hints.filter(Boolean).join(' ')
  }
})

function goUpgrade() {
  open.value = false
  upgrade.value?.()
}
</script>
