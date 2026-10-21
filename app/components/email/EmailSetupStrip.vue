<script setup lang="ts">
/**
 * What the project's email still needs, across the top of every Email tab:
 * a mailer on the server, a sender, the delivery webhook, and (for campaigns and
 * sequences) a postal address and a sender that is not paused. Nothing shows
 * once there is nothing to say. The judging is the server's
 * (GET /v1/admin/projects/:id/email-setup); this only words it.
 */
import type { EmailSetup, EmailSetupCheck } from '#shared/emailSetup'

const props = defineProps<{ projectId: string, /** `bulk` on Campaigns and Sequences, which have two more things to be ready. */ scope?: 'all' | 'bulk' }>()
const { api } = useAgent()
const setup = ref<EmailSetup | null>(null)

async function load() {
  setup.value = await api<EmailSetup>(`/admin/projects/${props.projectId}/email-setup`).catch(() => null)
}
watch(() => props.projectId, load, { immediate: true })

// Blocking things first; the delivery webhook is a nudge, shown while there is nothing worse.
const problems = computed<EmailSetupCheck[]>(() => (setup.value?.checks || []).filter(check => check.state !== 'ok' && (check.scope === 'all' || props.scope === 'bulk')).sort((a, b) => Number(b.state === 'todo') - Number(a.state === 'todo')))
const blocking = computed(() => problems.value.some(check => check.state === 'todo'))
</script>

<template>
  <div v-if="problems.length" class="shrink-0 border-b border-default px-4 py-2.5 md:px-6" :class="blocking ? 'bg-warning/5' : 'bg-elevated/50'" role="status">
    <p class="flex items-center gap-2 text-[13px] font-medium text-highlighted">
      <UIcon :name="blocking ? 'i-lucide-triangle-alert' : 'i-lucide-info'" class="size-4 shrink-0" :class="blocking ? 'text-warning' : 'text-muted'" />
      {{ blocking ? $t('emailSetup.blocked') : $t('emailSetup.nudge') }}
      <NuxtLink :to="`/projects/${projectId}/email?view=settings`" class="ml-auto shrink-0 text-xs font-medium text-muted underline-offset-2 hover:text-default hover:underline">{{ $t('emailSetup.openSettings') }}</NuxtLink>
    </p>
    <ul class="mt-1.5 space-y-0.5 pl-6 text-xs text-muted">
      <li v-for="check in problems" :key="check.key">
        <span class="font-medium text-default">{{ $t(`emailSetup.${check.key}.title`) }}</span>
        {{ $t(`emailSetup.${check.key}.${check.state}`, { reason: check.value }) }}
      </li>
    </ul>
  </div>
</template>
