<template>
  <section id="webhooks" class="scroll-mt-6 space-y-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="section-title">{{ $t('webhookEndpoints.title') }}</h2>
        <p class="mt-1 text-[13px] text-muted">{{ $t('webhookEndpoints.intro') }} <NuxtLink to="/docs/events" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('webhookEndpoints.docs') }}</NuxtLink></p>
      </div>
      <UButton v-if="!editing" icon="i-lucide-plus" size="sm" :label="$t('webhookEndpoints.add')" @click="startNew" />
    </div>
    <PlanLock feature="eventWebhooks" inline />

    <div v-if="secret" class="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p class="text-[13px] font-medium text-highlighted">{{ $t('webhookEndpoints.copySecret') }}</p>
      <p class="text-xs text-muted">{{ $t('webhookEndpoints.copySecretHint') }}</p>
      <div class="flex gap-2">
        <UInput :model-value="secret" readonly class="min-w-0 flex-1 font-mono text-xs" :aria-label="$t('webhookEndpoints.secret')" />
        <UButton icon="i-lucide-clipboard" @click="copySecret">{{ copied ? $t('webhookEndpoints.copied') : $t('webhookEndpoints.copy') }}</UButton>
        <UButton color="neutral" variant="ghost" @click="secret = ''">{{ $t('webhookEndpoints.done') }}</UButton>
      </div>
    </div>

    <form v-if="editing" class="space-y-4 rounded-xl border border-default p-5" @submit.prevent="save">
      <UFormField :label="$t('webhookEndpoints.url')"><UInput v-model="form.url" type="url" required placeholder="https://api.example.com/helpbites/events" class="w-full" /></UFormField>
      <UFormField :label="$t('webhookEndpoints.description')"><UInput v-model="form.description" maxlength="120" class="w-full" /></UFormField>
      <div class="space-y-2">
        <p class="text-[13px] font-medium text-default">{{ $t('webhookEndpoints.events') }}</p>
        <UCheckbox v-model="form.all" :label="$t('webhookEndpoints.everything')" />
        <div v-if="!form.all" class="space-y-3">
          <div v-for="group in groups" :key="group.name" class="space-y-1">
            <UCheckbox :model-value="groupState(group.name)" :indeterminate="groupState(group.name) === 'indeterminate'" :label="group.label" @update:model-value="toggleGroup(group.name, $event)" />
            <div class="ml-6 grid gap-1 sm:grid-cols-2">
              <UCheckbox v-for="e in group.events" :key="e.type" :model-value="form.events.includes(e.type) || form.events.includes(`${group.name}.*`)" :disabled="form.events.includes(`${group.name}.*`)" :label="e.label" :description="e.type" @update:model-value="toggleEvent(e.type, $event)" />
            </div>
          </div>
        </div>
      </div>
      <UCheckbox v-model="form.enabled" :label="$t('webhookEndpoints.enabled')" />
      <div class="flex items-center gap-3">
        <UButton type="submit" size="sm" :loading="saving">{{ $t('webhookEndpoints.save') }}</UButton>
        <UButton type="button" size="sm" color="neutral" variant="ghost" @click="editing = false">{{ $t('common.cancel') }}</UButton>
        <span v-if="error" class="text-[13px] text-error">{{ error }}</span>
      </div>
    </form>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-14 rounded-xl" /></div>
    <p v-else-if="!endpoints.length && !editing" class="rounded-xl border border-dashed border-default px-4 py-6 text-center text-[13px] text-muted">{{ $t('webhookEndpoints.empty') }}</p>
    <ul v-else-if="endpoints.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
      <li v-for="endpoint in endpoints" :key="endpoint.id" class="space-y-1.5 px-4 py-3">
        <div class="flex items-center gap-2">
          <span class="size-2 shrink-0 rounded-full" :class="statusDot(endpoint)" :title="statusText(endpoint)" />
          <code class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ endpoint.url }}</code>
          <UTooltip :text="$t('webhookEndpoints.test')"><UButton icon="i-lucide-send" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('webhookEndpoints.test')" :loading="busy === `test:${endpoint.id}`" @click="test(endpoint)" /></UTooltip>
          <UTooltip :text="$t('webhookEndpoints.rotate')"><UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('webhookEndpoints.rotate')" :loading="busy === `rotate:${endpoint.id}`" @click="rotate(endpoint)" /></UTooltip>
          <UTooltip :text="$t('webhookEndpoints.edit')"><UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('webhookEndpoints.edit')" @click="startEdit(endpoint)" /></UTooltip>
          <UTooltip :text="$t('webhookEndpoints.delete')"><UButton icon="i-lucide-trash-2" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('webhookEndpoints.delete')" @click="remove(endpoint)" /></UTooltip>
        </div>
        <p v-if="endpoint.description" class="text-xs text-muted">{{ endpoint.description }}</p>
        <div class="flex flex-wrap items-center gap-1">
          <UBadge v-for="filter in endpoint.events" :key="filter" color="neutral" variant="subtle" size="sm" class="font-mono text-[11px]">{{ filter === '*' ? $t('webhookEndpoints.everything') : filter }}</UBadge>
          <span class="ml-1 text-xs text-muted">{{ statusText(endpoint) }}</span>
        </div>
      </li>
    </ul>

    <details v-if="deliveries.length" class="rounded-xl border border-default px-4 py-2 text-[13px]">
      <summary class="cursor-pointer text-muted">{{ $t('webhookEndpoints.recent') }}</summary>
      <ul class="mt-2 divide-y divide-default">
        <li v-for="d in deliveries" :key="d.id" class="flex items-center gap-2 py-1.5">
          <span class="size-2 shrink-0 rounded-full" :class="d.status === 'delivered' ? 'bg-success' : d.status === 'failed' ? 'bg-error' : 'bg-warning'" />
          <code class="font-mono text-xs">{{ d.type }}</code>
          <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ d.lastError }}</span>
          <span class="shrink-0 text-xs text-dimmed">{{ d.createdAt ? new Date(d.createdAt).toLocaleString() : '' }}</span>
        </li>
      </ul>
    </details>
  </section>
</template>

<script setup lang="ts">
import { DOMAIN_EVENTS, type WebhookDeliveryDto, type WebhookEndpointDto } from '#shared/domainEvents'

const props = defineProps<{ projectId: string }>()
const { api } = useAgent()
const { t } = useI18n()

const endpoints = ref<WebhookEndpointDto[]>([])
const deliveries = ref<WebhookDeliveryDto[]>([])
const loading = ref(true)
const editing = ref(false)
const editingId = ref('')
const saving = ref(false)
const error = ref('')
const busy = ref('')
const secret = ref('')
const copied = ref(false)
const form = reactive({ url: '', description: '', all: true, events: [] as string[], enabled: true })

const GROUP_LABELS: Record<string, string> = { contact: 'Contacts', conversation: 'Conversations', feedback: 'Feedback', board: 'Board', changelog: 'Changelog', errors: 'Errors', github: 'GitHub', email: 'Email', cms: 'Pages', blog: 'Blog', onboarding: 'Onboarding' }
const groups = computed(() => [...new Set(DOMAIN_EVENTS.map(e => e.group))].map(name => ({ name, label: GROUP_LABELS[name] || name, events: DOMAIN_EVENTS.filter(e => e.group === name) })))

const base = () => `/admin/projects/${props.projectId}/webhooks`

async function load() {
  loading.value = true
  try {
    endpoints.value = (await api<{ endpoints: WebhookEndpointDto[] }>(base())).endpoints
    deliveries.value = (await api<{ deliveries: WebhookDeliveryDto[] }>(`${base()}/deliveries`, { query: { limit: 15 } })).deliveries
  } catch (e: any) {
    error.value = e?.message || t('webhookEndpoints.loadFailed')
  } finally {
    loading.value = false
  }
}

function startNew() {
  Object.assign(form, { url: '', description: '', all: true, events: [], enabled: true })
  editingId.value = ''
  error.value = ''
  editing.value = true
}

function startEdit(endpoint: WebhookEndpointDto) {
  const all = endpoint.events.includes('*')
  Object.assign(form, { url: endpoint.url, description: endpoint.description, all, events: all ? [] : [...endpoint.events], enabled: endpoint.enabled })
  editingId.value = endpoint.id
  error.value = ''
  editing.value = true
}

function groupState(name: string): boolean | 'indeterminate' {
  if (form.events.includes(`${name}.*`)) return true
  const members = DOMAIN_EVENTS.filter(e => e.group === name).map(e => e.type)
  const on = members.filter(type => form.events.includes(type)).length
  return on === members.length ? true : on ? 'indeterminate' : false
}

function toggleGroup(name: string, on: boolean | 'indeterminate') {
  const members = DOMAIN_EVENTS.filter(e => e.group === name).map(e => e.type)
  const rest = form.events.filter(f => f !== `${name}.*` && !members.includes(f))
  form.events = on === true ? [...rest, `${name}.*`] : rest
}

function toggleEvent(type: string, on: boolean | 'indeterminate') {
  form.events = on === true ? [...new Set([...form.events, type])] : form.events.filter(f => f !== type)
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const body = { url: form.url, description: form.description, events: form.all ? ['*'] : form.events, enabled: form.enabled }
    if (!form.all && !form.events.length) throw new Error(t('webhookEndpoints.pickEvents'))
    const result = await api<{ endpoint: WebhookEndpointDto }>(editingId.value ? `${base()}/${editingId.value}` : base(), { method: editingId.value ? 'PATCH' : 'POST', body })
    if (result.endpoint.secret) { secret.value = result.endpoint.secret; copied.value = false }
    editing.value = false
    await load()
  } catch (e: any) {
    error.value = e?.message || t('webhookEndpoints.saveFailed')
  } finally {
    saving.value = false
  }
}

async function test(endpoint: WebhookEndpointDto) {
  busy.value = `test:${endpoint.id}`
  try {
    await api(`${base()}/${endpoint.id}/test`, { method: 'POST' })
    setTimeout(load, 3000)
  } catch (e: any) {
    error.value = e?.message || t('webhookEndpoints.saveFailed')
  } finally {
    busy.value = ''
  }
}

async function rotate(endpoint: WebhookEndpointDto) {
  if (!confirm(t('webhookEndpoints.rotateConfirm'))) return
  busy.value = `rotate:${endpoint.id}`
  try {
    const result = await api<{ endpoint: WebhookEndpointDto }>(`${base()}/${endpoint.id}`, { method: 'PATCH', body: { rotateSecret: true } })
    secret.value = result.endpoint.secret || ''
    copied.value = false
  } catch (e: any) {
    error.value = e?.message || t('webhookEndpoints.saveFailed')
  } finally {
    busy.value = ''
  }
}

async function remove(endpoint: WebhookEndpointDto) {
  if (!confirm(t('webhookEndpoints.deleteConfirm', { url: endpoint.url }))) return
  try {
    await api(`${base()}/${endpoint.id}`, { method: 'DELETE' })
    endpoints.value = endpoints.value.filter(e => e.id !== endpoint.id)
  } catch (e: any) {
    error.value = e?.message || t('webhookEndpoints.saveFailed')
  }
}

async function copySecret() {
  await navigator.clipboard.writeText(secret.value)
  copied.value = true
}

const statusDot = (e: WebhookEndpointDto) => (!e.enabled ? 'bg-(--ui-text-dimmed)' : e.lastStatus === 'failed' ? 'bg-error' : e.lastStatus === 'delivered' ? 'bg-success' : 'bg-warning')
const statusText = (e: WebhookEndpointDto) => (!e.enabled ? t('webhookEndpoints.off') : e.lastStatus === 'failed' ? t('webhookEndpoints.failing') : e.lastStatus === 'delivered' ? t('webhookEndpoints.working') : t('webhookEndpoints.noDeliveries'))

onMounted(load)
</script>
