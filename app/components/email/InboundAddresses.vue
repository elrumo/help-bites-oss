<template>
  <div class="space-y-4">
    <p class="text-muted">{{ $t('inboundAddresses.intro') }} <NuxtLink to="/docs/inbound-email" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('inboundAddresses.docs') }}</NuxtLink></p>
    <PlanLock feature="inboundEmail" inline />

    <div v-if="!mode" class="grid gap-3 sm:grid-cols-2">
      <button v-for="option in modes" :key="option.key" type="button" class="rounded-xl border border-default p-4 text-left transition-colors hover:bg-elevated disabled:opacity-50" :disabled="option.key === 'forward' && !forwardingDomain" @click="start(option.key)">
        <span class="flex items-center gap-2 text-[13px] font-medium text-highlighted"><UIcon :name="option.icon" class="size-4" />{{ option.title }}</span>
        <span class="mt-1 block text-xs text-muted">{{ option.hint }}</span>
      </button>
    </div>
    <p v-if="!mode && !forwardingDomain && !loading" class="text-xs text-muted">{{ $t('inboundAddresses.noForwarding') }}</p>

    <form v-if="mode" class="space-y-3 rounded-xl border border-default p-4" @submit.prevent="create">
      <UFormField v-if="mode === 'forward'" :label="$t('inboundAddresses.publicAddress')"><UInput v-model="form.publicAddress" type="email" :placeholder="$t('inboundAddresses.publicPlaceholder')" class="w-full" /></UFormField>
      <UFormField v-else :label="$t('inboundAddresses.address')"><UInput v-model="form.address" type="email" required :placeholder="$t('inboundAddresses.addressPlaceholder')" class="w-full" /></UFormField>
      <UFormField :label="$t('inboundAddresses.fromName')"><UInput v-model="form.fromName" maxlength="80" :placeholder="projectName" class="w-full" /></UFormField>
      <div class="flex items-center gap-3">
        <UButton type="submit" size="sm" :loading="saving" :label="$t('inboundAddresses.create')" />
        <UButton type="button" size="sm" color="neutral" variant="ghost" :label="$t('inboundAddresses.cancel')" @click="mode = ''" />
      </div>
    </form>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-14 rounded-xl" /></div>
    <p v-else-if="!addresses.length && !mode" class="rounded-xl border border-dashed border-default px-4 py-6 text-center text-[13px] text-muted">{{ $t('inboundAddresses.empty') }}</p>
    <ul v-else-if="addresses.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
      <li v-for="item in addresses" :key="item.id" class="space-y-3 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="size-2 shrink-0 rounded-full" :class="item.state === 'verified' ? 'bg-success' : item.state === 'failed' ? 'bg-error' : 'bg-warning'" />
          <code class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ item.kind === 'forward' && item.publicAddress ? item.publicAddress : item.address }}</code>
          <UBadge color="neutral" variant="subtle" size="sm">{{ $t(`inboundAddresses.kind.${item.kind}`) }}</UBadge>
          <UBadge :color="item.state === 'verified' ? 'success' : 'neutral'" variant="subtle" size="sm">{{ $t(`inboundAddresses.state.${item.state}`) }}</UBadge>
          <UButton v-if="item.kind === 'domain'" icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="outline" :label="$t('inboundAddresses.verify')" :loading="busy === item.id" @click="verify(item)" />
          <UButton icon="i-lucide-trash-2" size="sm" color="neutral" variant="ghost" square :aria-label="$t('inboundAddresses.remove')" @click="remove(item)" />
        </div>
        <div v-if="item.kind === 'forward'" class="flex items-center gap-2 rounded-lg bg-elevated px-3 py-2 text-xs">
          <span class="min-w-0 flex-1 text-muted">{{ item.publicAddress ? $t('inboundAddresses.forwardTo', { public: item.publicAddress }) : $t('inboundAddresses.forwardAnywhere') }} <code class="font-mono text-default break-all">{{ item.address }}</code></span>
          <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" square :aria-label="$t('inboundAddresses.copy')" @click="copy(item.address)" />
        </div>
        <div v-else-if="item.state !== 'verified'" class="space-y-2 rounded-lg bg-elevated p-3">
          <p class="text-[13px] font-medium text-highlighted">{{ $t('inboundAddresses.mxTitle') }}</p>
          <p class="text-xs text-muted">{{ $t('inboundAddresses.mxHint') }}</p>
          <table class="w-full text-left text-xs">
            <thead class="text-muted"><tr><th class="py-1 pr-3 font-medium">{{ $t('inboundAddresses.type') }}</th><th class="py-1 pr-3 font-medium">{{ $t('inboundAddresses.host') }}</th><th class="py-1 pr-3 font-medium">{{ $t('inboundAddresses.value') }}</th><th class="py-1 font-medium">{{ $t('inboundAddresses.priority') }}</th><th /></tr></thead>
            <tbody>
              <tr v-for="record in item.mxRecords" :key="record.value">
                <td class="py-1 pr-3 font-mono">{{ record.type }}</td>
                <td class="py-1 pr-3 font-mono break-all">{{ record.host }}</td>
                <td class="py-1 pr-3 font-mono break-all">{{ record.value }}</td>
                <td class="py-1 font-mono">{{ record.priority }}</td>
                <td class="py-1 pl-3"><UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" square :aria-label="$t('inboundAddresses.copy')" @click="copy(record.value)" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { InboundAddressDto } from '#shared/inboundEmail'

const props = defineProps<{ projectId: string, projectName?: string }>()
const { api } = useAgent()
const { t } = useI18n()

const addresses = ref<InboundAddressDto[]>([])
const forwardingDomain = ref('')
const loading = ref(true)
const saving = ref(false)
const busy = ref('')
const error = ref('')
const mode = ref<'' | 'forward' | 'domain'>('')
const form = reactive({ address: '', publicAddress: '', fromName: '' })

const modes = computed(() => [
  { key: 'forward' as const, icon: 'i-lucide-forward', title: t('inboundAddresses.forward'), hint: t('inboundAddresses.forwardHint') },
  { key: 'domain' as const, icon: 'i-lucide-at-sign', title: t('inboundAddresses.domain'), hint: t('inboundAddresses.domainHint') }
])
const base = () => `/admin/projects/${props.projectId}/inbound-addresses`
const fail = (e: any, fallback: string) => { error.value = e?.data?.statusMessage || e?.message || t(fallback) }

async function load() {
  loading.value = true
  try {
    const result = await api<{ addresses: InboundAddressDto[], forwardingDomain: string }>(base())
    addresses.value = result.addresses
    forwardingDomain.value = result.forwardingDomain
  } catch (e: any) {
    fail(e, 'inboundAddresses.loadFailed')
  } finally {
    loading.value = false
  }
}

function start(kind: 'forward' | 'domain') {
  Object.assign(form, { address: '', publicAddress: '', fromName: '' })
  error.value = ''
  mode.value = kind
}

async function create() {
  saving.value = true
  error.value = ''
  try {
    const body = mode.value === 'forward' ? { kind: 'forward', publicAddress: form.publicAddress, fromName: form.fromName } : { kind: 'domain', address: form.address, fromName: form.fromName }
    const { address } = await api<{ address: InboundAddressDto }>(base(), { method: 'POST', body })
    addresses.value = [...addresses.value, address]
    mode.value = ''
  } catch (e: any) {
    fail(e, 'inboundAddresses.saveFailed')
  } finally {
    saving.value = false
  }
}

async function verify(item: InboundAddressDto) {
  busy.value = item.id
  error.value = ''
  try {
    const { address } = await api<{ address: InboundAddressDto }>(`${base()}/${item.id}/verify`, { method: 'POST' })
    addresses.value = addresses.value.map(a => (a.id === item.id ? address : a))
  } catch (e: any) {
    fail(e, 'inboundAddresses.saveFailed')
  } finally {
    busy.value = ''
  }
}

async function remove(item: InboundAddressDto) {
  if (!confirm(t('inboundAddresses.removeConfirm', { address: item.publicAddress || item.address }))) return
  try {
    await api(`${base()}/${item.id}`, { method: 'DELETE' })
    addresses.value = addresses.value.filter(a => a.id !== item.id)
  } catch (e: any) {
    fail(e, 'inboundAddresses.saveFailed')
  }
}

const copy = (value: string) => navigator.clipboard?.writeText(value)

onMounted(load)
</script>
