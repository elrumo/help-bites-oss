<script setup lang="ts">
/**
 * Whether an assistant will answer customers by itself, and what is missing
 * if not: an AI provider, knowledge it may read, an active status and
 * auto-reply on. The checks are the server's (shared/knowledge.ts
 * assistantReadiness), the same ones the project's setup checklist uses.
 */
import { ASSISTANT_FAQ_LOOKUP, type AssistantReadiness } from '#shared/knowledge'

const props = defineProps<{ readiness: AssistantReadiness }>()
// The server counts up to a lookup's worth, so a full count reads "50+".
const readable = computed(() => (props.readiness.faqs >= ASSISTANT_FAQ_LOOKUP ? `${ASSISTANT_FAQ_LOOKUP}+` : String(props.readiness.faqs)))
const settingsTab = useState('settings-tab', () => '')
// Where each missing thing is fixed: the workspace's AI settings, the knowledge section below, the form above it.
const fixes: Record<string, string> = { knowledge: '#knowledge-access', active: '#assistant-form', autoReply: '#assistant-form' }
</script>

<template>
  <section class="space-y-3 rounded-xl border p-4" :class="readiness.live ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'" :aria-label="$t('assistants.readiness.title')">
    <p class="flex items-center gap-2 text-[13px] font-medium text-highlighted">
      <UIcon :name="readiness.live ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" class="size-4 shrink-0" :class="readiness.live ? 'text-success' : 'text-warning'" />
      {{ readiness.live ? $t('assistants.readiness.live') : $t('assistants.readiness.notLive') }}
    </p>
    <ul class="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      <li v-for="check in readiness.checks" :key="check.key" class="flex items-start gap-1.5" :class="check.ok ? 'text-muted' : 'text-default'">
        <UIcon :name="check.ok ? 'i-lucide-check' : 'i-lucide-x'" class="mt-0.5 size-3.5 shrink-0" :class="check.ok ? 'text-success' : 'text-warning'" />
        <span>
          {{ $t(`assistants.readiness.${check.key}.${check.ok ? 'ok' : 'todo'}`, { count: readable }, readiness.faqs) }}
          <button v-if="!check.ok && check.key === 'llm'" type="button" class="font-medium underline-offset-2 hover:underline" @click="settingsTab = 'ai'">{{ $t('assistants.readiness.llm.fix') }}</button>
          <a v-else-if="!check.ok && fixes[check.key]" :href="fixes[check.key]" class="font-medium underline-offset-2 hover:underline">{{ $t(`assistants.readiness.${check.key}.fix`) }}</a>
        </span>
      </li>
    </ul>
  </section>
</template>
