<template>
  <UModal v-model:open="open" :title="$t('legal.analyse.title')" :ui="{ content: 'sm:max-w-2xl', header: 'relative z-10 bg-default' }">
    <template #body>
      <form class="space-y-4" @submit.prevent="run">
        <p class="text-[13px] text-muted">{{ $t('legal.analyse.intro') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('legal.analyse.document')">
            <USelect v-model="type" :items="typeItems" class="w-full" />
          </UFormField>
        </div>
        <UFormField :label="$t('legal.analyse.regions')">
          <USelectMenu v-model="regions" multiple :items="regionItems" value-key="value" :placeholder="$t('legal.selectRegions')" class="w-full" />
        </UFormField>
        <UFormField :label="$t('legal.analyse.text')">
          <UTextarea v-model="text" :rows="8" :placeholder="$t('legal.analyse.textPlaceholder')" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="$t('legal.close')" @click="open = false" />
          <UButton type="submit" :label="$t('legal.analyse.submit')" icon="i-lucide-scan-search" :loading="loading" :disabled="!text.trim()" />
        </div>
      </form>

      <ul v-if="findings" class="mt-6 divide-y divide-default overflow-hidden rounded-xl border border-default">
        <li v-if="!findings.length" class="px-4 py-3 text-[13px] text-muted">{{ $t('legal.analyse.noRequirements') }}</li>
        <li v-for="f in findings" :key="f.requirement" class="flex items-start gap-3 px-4 py-3">
          <UBadge :label="$t(`legal.findingStatus.${f.status}`)" :color="STATUS_COLOR[f.status]" variant="soft" size="sm" class="mt-0.5 shrink-0" />
          <div class="min-w-0">
            <p class="text-[13px] text-highlighted">{{ summaries[f.requirement] || f.requirement }}</p>
            <p class="text-[13px] text-muted">{{ f.note }}</p>
          </div>
        </li>
      </ul>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, LEGAL_REGIONS, LEGAL_REGION_LABELS, type LegalDocType, type LegalFinding } from '#shared/legal/types'

const open = defineModel<boolean>('open', { default: false })
const { api } = useAgent()
const { t } = useI18n()

const typeItems = LEGAL_DOC_TYPES.map(value => ({ value, label: LEGAL_DOC_LABELS[value] }))
const regionItems = LEGAL_REGIONS.map(value => ({ value, label: LEGAL_REGION_LABELS[value] }))
const STATUS_COLOR = { ok: 'success', unclear: 'warning', missing: 'error', conflict: 'error' } as const

const type = ref<LegalDocType>('privacy')
const regions = ref<string[]>([])
const text = ref('')
const loading = ref(false)
const error = ref('')
const findings = ref<LegalFinding[] | null>(null)
const summaries = ref<Record<string, string>>({})

async function run() {
  loading.value = true
  error.value = ''
  findings.value = null
  try {
    const [result, packs] = await Promise.all([
      api<{ findings: LegalFinding[] }>('/admin/legal/analyse', { method: 'POST', body: { type: type.value, text: text.value, answers: { regions: regions.value } } }),
      api<{ rulepacks: { requirements: { id: string, summary: string }[] }[] }>('/admin/legal/rulepacks', { query: { type: type.value } })
    ])
    summaries.value = Object.fromEntries(packs.rulepacks.flatMap(p => p.requirements.map(r => [r.id, r.summary])))
    findings.value = result.findings
  } catch (e: any) {
    error.value = e?.message || t('legal.analyse.couldNotAnalyse')
  } finally {
    loading.value = false
  }
}
</script>
