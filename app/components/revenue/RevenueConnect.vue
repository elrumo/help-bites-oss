<template>
  <div class="w-full max-w-xl text-left">
    <div v-if="!picked" class="grid gap-2 sm:grid-cols-2">
      <button v-for="s in available" :key="s.id" type="button" class="flex items-start gap-3 rounded-lg border border-default p-3 text-left transition-colors hover:bg-elevated" @click="pick(s.id)">
        <UIcon :name="s.icon" class="mt-0.5 size-5 shrink-0 text-muted" />
        <span class="min-w-0">
          <span class="block text-[13px] font-medium text-highlighted">{{ nameOf(s.id) }}</span>
          <span class="mt-0.5 block text-xs text-muted">{{ $t(`projectTools.revenue.sources.${s.id}.blurb`) }}</span>
        </span>
      </button>
    </div>

    <form v-else class="space-y-3" @submit.prevent="connect">
      <UButton v-if="available.length > 1" color="neutral" variant="link" size="sm" class="px-0" icon="i-lucide-arrow-left" :label="$t('projectTools.revenue.back')" @click="picked = null" />
      <p class="text-[13px] text-muted">{{ $t(`projectTools.revenue.sources.${picked.id}.intro`) }}</p>
      <UFormField v-for="f in picked.fields" :key="f.key" :label="$t(`projectTools.revenue.sources.${picked.id}.fields.${f.key}.label`)" :help="$t(`projectTools.revenue.sources.${picked.id}.fields.${f.key}.help`)">
        <UTextarea v-if="f.multiline" v-model="values[f.key]" :rows="5" :placeholder="f.placeholder" autocomplete="off" spellcheck="false" class="w-full font-mono text-xs" />
        <UInput v-else v-model="values[f.key]" :type="f.secret ? 'password' : 'text'" :placeholder="f.placeholder" autocomplete="off" class="w-full" />
      </UFormField>
      <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
      <UButton type="submit" :label="$t('projectTools.revenue.connect', { name: nameOf(picked.id) })" :loading="connecting" :disabled="!ready" />
    </form>
  </div>
</template>

<script setup lang="ts">
import { REVENUE_SOURCES, revenueSource, type RevenueConnection, type RevenueSourceId } from '#shared/revenue'

const props = defineProps<{ projectId: string, exclude?: string[] }>()
const emit = defineEmits<{ connected: [connection: RevenueConnection] }>()
const { api } = useAgent()
const { t } = useI18n()
const nameOf = useRevenueSourceName()

const available = computed(() => REVENUE_SOURCES.filter(s => !props.exclude?.includes(s.id)))
const picked = ref<(typeof REVENUE_SOURCES)[number] | null>(null)
const values = reactive<Record<string, string>>({})
const connecting = ref(false)
const error = ref('')
const ready = computed(() => Boolean(picked.value?.fields.every(f => f.optional || values[f.key]?.trim())))

function pick(id: RevenueSourceId) {
  picked.value = revenueSource(id) || null
  for (const key of Object.keys(values)) delete values[key]
  error.value = ''
}

async function connect() {
  if (!picked.value) return
  connecting.value = true
  error.value = ''
  try {
    const res = await api<{ connection: RevenueConnection }>('/admin/revenue/connect', { method: 'POST', body: { project: props.projectId, source: picked.value.id, credentials: { ...values } } })
    for (const key of Object.keys(values)) delete values[key]
    picked.value = null
    emit('connected', res.connection)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.revenue.connectError')
  } finally {
    connecting.value = false
  }
}
</script>
