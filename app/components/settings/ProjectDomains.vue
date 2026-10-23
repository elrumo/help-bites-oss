<template>
  <div class="space-y-4">
    <PlanLock feature="customPublicDomain" inline />

    <form class="flex flex-wrap items-end gap-3" @submit.prevent="add">
      <UFormField :label="$t('projectDomains.hostLabel')" class="min-w-56 flex-1">
        <UInput v-model="host" :placeholder="$t('projectDomains.hostPlaceholder')" class="w-full" autocapitalize="off" spellcheck="false" />
      </UFormField>
      <UFormField :label="$t('projectDomains.targetLabel')">
        <USelect v-model="target" :items="targetItems" class="w-44" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-plus" :label="$t('projectDomains.add')" :loading="adding" :disabled="!host.trim()" />
    </form>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-14 rounded-xl" /></div>
    <p v-else-if="!domains.length" class="rounded-xl border border-dashed border-default px-4 py-6 text-center text-[13px] text-muted">{{ $t('projectDomains.empty') }}</p>
    <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
      <li v-for="domain in domains" :key="domain.id" class="space-y-3 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="size-2 shrink-0 rounded-full" :class="dot(domain)" />
          <code class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ domain.host }}</code>
          <UBadge :color="domain.state === 'verified' ? 'success' : 'neutral'" variant="subtle" size="sm">{{ $t(`projectDomains.state.${domain.state}`) }}</UBadge>
          <USelect :model-value="domain.target" :items="targetItems" size="sm" class="w-40" @update:model-value="setTarget(domain, $event as DomainTarget)" />
          <UButton v-if="domain.state === 'verified'" icon="i-lucide-external-link" size="sm" color="neutral" variant="ghost" square :to="`https://${domain.host}`" target="_blank" :aria-label="domain.host" />
          <UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="outline" :label="$t('projectDomains.verify')" :loading="busy === domain.id" @click="verify(domain)" />
          <UButton icon="i-lucide-trash-2" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectDomains.remove')" @click="remove(domain)" />
        </div>
        <div v-if="domain.state !== 'verified'" class="space-y-2 rounded-lg bg-elevated p-3">
          <p class="text-[13px] font-medium text-highlighted">{{ $t('projectDomains.records') }}</p>
          <p class="text-xs text-muted">{{ $t('projectDomains.recordsHint') }}</p>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-muted"><tr><th class="py-1 pr-3 font-medium">{{ $t('projectDomains.recordType') }}</th><th class="py-1 pr-3 font-medium">{{ $t('projectDomains.recordHost') }}</th><th class="py-1 font-medium">{{ $t('projectDomains.recordValue') }}</th><th /></tr></thead>
              <tbody>
                <tr v-for="record in domain.dnsRecords" :key="record.purpose">
                  <td class="py-1 pr-3 font-mono">{{ record.type }}</td>
                  <td class="py-1 pr-3 font-mono break-all">{{ record.host }}</td>
                  <td class="py-1 font-mono break-all">{{ record.value }}</td>
                  <td class="py-1 pl-3 whitespace-nowrap">
                    <UIcon v-if="record.valid !== 'unknown'" :name="record.valid === 'valid' ? 'i-lucide-check' : 'i-lucide-x'" :class="record.valid === 'valid' ? 'text-success' : 'text-error'" class="mr-1 size-3.5 align-middle" />
                    <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectDomains.copy')" @click="copy(record.value)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { DOMAIN_TARGETS, type DomainTarget, type ProjectDomainDto } from '#shared/domains'

const props = defineProps<{ projectId: string }>()
const { api } = useAgent()
const { t } = useI18n()

const domains = ref<ProjectDomainDto[]>([])
const loading = ref(true)
const adding = ref(false)
const busy = ref('')
const error = ref('')
const host = ref('')
const target = ref<DomainTarget>('hub')

const targetItems = computed(() => DOMAIN_TARGETS.map(value => ({ value, label: t(`projectDomains.target.${value}`) })))
const base = () => `/admin/projects/${props.projectId}/domains`
const fail = (e: any, fallback: string) => { error.value = e?.data?.statusMessage || e?.message || t(fallback) }
const dot = (domain: ProjectDomainDto) => (domain.state === 'verified' ? 'bg-success' : domain.state === 'failed' ? 'bg-error' : 'bg-warning')

async function load() {
  loading.value = true
  try {
    domains.value = (await api<{ domains: ProjectDomainDto[] }>(base())).domains
  } catch (e: any) {
    fail(e, 'projectDomains.loadFailed')
  } finally {
    loading.value = false
  }
}

async function add() {
  adding.value = true
  error.value = ''
  try {
    const { domain } = await api<{ domain: ProjectDomainDto }>(base(), { method: 'POST', body: { host: host.value, target: target.value } })
    domains.value = [...domains.value, domain]
    host.value = ''
  } catch (e: any) {
    fail(e, 'projectDomains.saveFailed')
  } finally {
    adding.value = false
  }
}

async function replace(domain: ProjectDomainDto, request: Promise<{ domain: ProjectDomainDto }>) {
  try {
    const result = await request
    domains.value = domains.value.map(d => (d.id === domain.id ? result.domain : d))
  } catch (e: any) {
    fail(e, 'projectDomains.saveFailed')
  }
}

async function verify(domain: ProjectDomainDto) {
  busy.value = domain.id
  error.value = ''
  await replace(domain, api(`${base()}/${domain.id}/verify`, { method: 'POST' }))
  busy.value = ''
}

const setTarget = (domain: ProjectDomainDto, value: DomainTarget) => replace(domain, api(`${base()}/${domain.id}`, { method: 'PATCH', body: { target: value } }))

async function remove(domain: ProjectDomainDto) {
  if (!confirm(t('projectDomains.removeConfirm', { host: domain.host }))) return
  try {
    await api(`${base()}/${domain.id}`, { method: 'DELETE' })
    domains.value = domains.value.filter(d => d.id !== domain.id)
  } catch (e: any) {
    fail(e, 'projectDomains.saveFailed')
  }
}

const copy = (value: string) => navigator.clipboard?.writeText(value)

onMounted(load)
</script>
