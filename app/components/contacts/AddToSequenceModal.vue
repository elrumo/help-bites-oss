<script setup lang="ts">
/**
 * Put one person, or everyone in a segment, on a sequence by hand
 * (POST /v1/sequences/:id/enrollments). Only an active sequence takes people
 * and only subscribed people are enrolled; the answer says who was left out and why.
 */
import type { Sequence } from '#shared/marketing'
import type { AdminProject } from '~~/server/utils/projects'

const props = defineProps<{ project: AdminProject, contactId?: string, segmentId?: string, segmentName?: string }>()
const open = defineModel<boolean>('open', { default: false })

type Summary = { enrolled: number, skipped: { notSubscribed: number, optedOut: number, alreadyEnrolled: number, notFound: number }, truncated: boolean }

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const sequences = ref<Sequence[]>([])
const loading = ref(false)
const picked = ref('')
const adding = ref(false)
const summary = ref<Summary | null>(null)

const items = computed(() => sequences.value.map(s => ({ label: s.name, value: s.id })))

watch(open, async (value) => {
  if (!value) return
  summary.value = null
  loading.value = true
  try {
    sequences.value = (await api<{ sequences: Sequence[] }>('/sequences', { query: { project: props.project.id } })).sequences.filter(s => s.status === 'active')
    picked.value = sequences.value.some(s => s.id === picked.value) ? picked.value : sequences.value[0]?.id || ''
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sequence.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
})

async function add() {
  adding.value = true
  try {
    summary.value = await api<Summary>(`/sequences/${picked.value}/enrollments`, { method: 'POST', body: { project: props.project.id, ...(props.segmentId ? { segment: props.segmentId } : { contacts: [props.contactId] }) } })
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sequence.addError'), color: 'error' })
  } finally {
    adding.value = false
  }
}

// Who was left out, by reason: only the reasons that apply.
const skipped = computed(() => {
  const s = summary.value?.skipped
  if (!s) return []
  return [
    s.alreadyEnrolled && t('contacts.sequence.alreadyOn', { count: s.alreadyEnrolled }),
    s.notSubscribed && t('contacts.sequence.notSubscribed', { count: s.notSubscribed }),
    s.optedOut && t('contacts.sequence.optedOut', { count: s.optedOut }),
    s.notFound && t('contacts.sequence.notFound', { count: s.notFound })
  ].filter(Boolean) as string[]
})
</script>

<template>
  <UModal v-model:open="open" :title="$t('contacts.sequence.title')" :description="segmentId ? $t('contacts.sequence.descriptionSegment', { name: segmentName || '' }) : $t('contacts.sequence.descriptionOne')">
    <template #body>
      <div class="space-y-4 text-[13px]">
        <div v-if="loading" class="space-y-2"><USkeleton class="h-8" /></div>
        <p v-else-if="!sequences.length" class="text-muted">
          {{ $t('contacts.sequence.none') }}
          <NuxtLink :to="`/projects/${project.id}/campaigns?view=sequences`" class="underline">{{ $t('contacts.sequence.openSequences') }}</NuxtLink>
        </p>
        <template v-else>
          <UFormField :label="$t('contacts.sequence.pick')"><USelect v-model="picked" :items="items" value-key="value" class="w-full" :disabled="adding" /></UFormField>
          <p class="text-xs text-muted">{{ $t('contacts.sequence.rule') }}</p>
        </template>

        <div v-if="summary" class="space-y-1 rounded-lg border border-default p-3" role="status">
          <p class="font-medium text-highlighted">{{ $t('contacts.sequence.added', { count: summary.enrolled }) }}</p>
          <p v-if="skipped.length" class="text-xs text-muted">{{ $t('contacts.sequence.skipped') }} {{ skipped.join(' · ') }}</p>
          <p v-if="summary.truncated" class="text-xs text-warning">{{ $t('contacts.sequence.truncated') }}</p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">{{ summary ? $t('contacts.csv.done') : $t('common.cancel') }}</UButton>
          <UButton v-if="sequences.length" :loading="adding" :disabled="!picked" :label="summary?.truncated ? $t('contacts.sequence.addMore') : $t('contacts.sequence.add')" @click="add" />
        </div>
      </div>
    </template>
  </UModal>
</template>
