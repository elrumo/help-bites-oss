<script setup lang="ts">
/**
 * Ask an assistant a question the way a customer would and see what it would
 * do, and why: hand it to the team (a routing rule, or nothing matched well
 * enough), stay silent, or answer, with the knowledge it found and, when it
 * has an AI provider, the reply it would send. The decision is the server's,
 * the one the support runtime makes (POST /v1/admin/support-agents/:id/test-answer).
 */
import type { AgentDecision, AgentRule } from '#shared/knowledge'
import type { ConversationType } from '#shared/support'

const props = defineProps<{ assistantId: string, types: ConversationType[] }>()

type Result = { decision: AgentDecision, rule: AgentRule | null, live: boolean, model: string, answer: string | null, knowledge: { faqId: string, question: string, pathCache: string, score: number }[] }

const { api } = useAgent()
const { t } = useI18n()
const settingsTab = useState('settings-tab', () => '')
const question = ref('')
const type = ref('support')
const running = ref(false)
const error = ref('')
const result = ref<Result | null>(null)

const typeItems = computed(() => (props.types.length ? props.types : [{ key: 'support', name: t('assistants.test.supportType') }]).map(item => ({ label: item.name, value: item.key })))
const percent = (score: number) => `${Math.round(score * 100)}%`

async function run() {
  if (!question.value.trim() || running.value) return
  running.value = true
  error.value = ''
  try {
    result.value = await api<Result>(`/admin/support-agents/${props.assistantId}/test-answer`, { method: 'POST', body: { query: question.value, conversationType: type.value } })
  } catch (e: any) {
    result.value = null
    error.value = e?.message || t('assistants.test.error')
  } finally {
    running.value = false
  }
}

const OUTCOMES = { answer: { color: 'success', icon: 'i-lucide-message-circle-reply' }, handoff: { color: 'warning', icon: 'i-lucide-hand' }, silent: { color: 'neutral', icon: 'i-lucide-volume-x' } } as const
const outcome = computed(() => (result.value ? OUTCOMES[result.value.decision.outcome] : null))
// "ticket type billing · keywords refund, chargeback": what the rule that decided looks for.
const ruleText = computed(() => {
  const rule = result.value?.rule
  if (!rule) return ''
  const conditions = [rule.conversationType ? t('assistants.test.ruleType', { type: rule.conversationType }) : '', rule.keywords?.length ? t('assistants.test.ruleKeywords', { keywords: rule.keywords.join(', ') }) : ''].filter(Boolean).join(' · ')
  return conditions ? ` (${conditions})` : ''
})
</script>

<template>
  <div class="space-y-3">
    <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('assistants.test.title') }}</h2>
    <p class="text-xs text-muted">{{ $t('assistants.test.hint') }}</p>
    <form class="flex flex-wrap gap-2" @submit.prevent="run">
      <UInput v-model="question" class="min-w-[12rem] flex-1" :placeholder="$t('assistants.test.placeholder')" :aria-label="$t('assistants.test.placeholder')" />
      <USelect v-model="type" :items="typeItems" class="w-40" :aria-label="$t('assistants.ticketType')" />
      <UButton type="submit" color="neutral" variant="soft" icon="i-lucide-flask-conical" :loading="running" :disabled="!question.trim()">{{ $t('assistants.test.run') }}</UButton>
    </form>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>

    <div v-if="result && outcome" class="space-y-3 rounded-xl border border-default p-4" aria-live="polite">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge :icon="outcome.icon" :color="outcome.color" variant="subtle" :label="$t(`assistants.test.outcome.${result.decision.outcome}`)" />
        <span v-if="!result.live" class="text-xs text-muted">{{ $t('assistants.test.notLive') }}</span>
      </div>
      <p class="text-[13px] text-default">
        {{ $t(`assistants.test.reason.${result.decision.reason}`, { rule: (result.decision.ruleIndex ?? 0) + 1, conditions: ruleText, best: percent(result.decision.best), bar: percent(result.decision.minConfidence) }) }}
        <template v-if="result.decision.ruleIndex !== null && result.decision.reason !== 'rule'">{{ $t('assistants.test.ruleLetThrough', { rule: result.decision.ruleIndex + 1, conditions: ruleText }) }}</template>
      </p>

      <div v-if="result.answer" class="space-y-1.5">
        <p class="text-xs font-medium text-muted">{{ $t('assistants.test.wouldSend', { model: result.model }) }}</p>
        <div class="rounded-lg bg-elevated/60 p-3 text-[13px]"><MarkdownBlock :text="result.answer" /></div>
      </div>
      <p v-else-if="result.decision.outcome === 'answer'" class="text-xs text-warning">
        {{ $t('assistants.test.noProvider') }} <button type="button" class="font-medium underline-offset-2 hover:underline" @click="settingsTab = 'ai'">{{ $t('assistants.readiness.llm.fix') }}</button>
      </p>

      <div v-if="result.knowledge.length" class="space-y-1.5">
        <p class="text-xs font-medium text-muted">{{ $t('assistants.test.found') }}</p>
        <ul class="space-y-1">
          <li v-for="item in result.knowledge" :key="item.faqId" class="flex items-center gap-2 text-xs">
            <span class="min-w-0 flex-1 truncate text-default">{{ item.question }}<span v-if="item.pathCache" class="text-dimmed"> · {{ item.pathCache }}</span></span>
            <span class="shrink-0 tabular-nums text-muted">{{ percent(item.score) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
