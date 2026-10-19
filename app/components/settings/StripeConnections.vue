<template>
  <div class="space-y-4">
    <p class="text-[13px] text-muted">Connect a Stripe account to each project that sells something. HelpBites only reads: revenue shows up under the project's Revenue tab, and each person's payments appear on their contact.</p>
    <p v-if="!ready" class="text-[13px] text-error">Set HELPBITES_SECRET on the server first: Stripe keys are stored sealed with it.</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!projects.length" icon="i-lucide-circle-dollar-sign" title="No projects yet" description="Stripe connects to a project." class="rounded-xl border border-dashed border-default" />
    <ul v-else class="space-y-2">
      <li v-for="p in projects" :key="p.id" class="rounded-xl border border-default px-4 py-2">
        <div class="flex min-h-8 items-center gap-3">
          <ProjectDot tile :project-id="p.id" :accent="p.theme?.accent" :name="p.name" :icon-url="p.iconUrl" class="!size-6 !rounded-md !text-xs" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-highlighted">{{ p.name }}</span>
            <span class="block truncate text-xs text-muted">
              <template v-if="state[p.id]?.connected">
                {{ state[p.id]!.accountName || 'Stripe' }} · {{ state[p.id]!.livemode ? 'Live' : 'Test mode' }}<template v-if="state[p.id]!.lastError"> · <span class="text-error">last sync failed</span></template><template v-else-if="state[p.id]!.lastRunAt"> · synced {{ logTime(state[p.id]!.lastRunAt) }}</template>
              </template>
              <template v-else>Not connected</template>
            </span>
          </span>
          <template v-if="state[p.id]?.connected">
            <UButton :to="`/projects/${p.id}/revenue`" size="sm" color="neutral" variant="ghost" label="Revenue" @click="$emit('navigate')" />
            <UTooltip text="Disconnect"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-unplug" class="text-muted" aria-label="Disconnect Stripe" @click="disconnect(p.id, p.name)" /></UTooltip>
          </template>
          <UButton v-else-if="adding !== p.id" icon="i-lucide-plus" label="Connect" size="sm" color="neutral" variant="outline" :disabled="!ready" @click="adding = p.id; key = ''" />
        </div>
        <form v-if="adding === p.id" class="mt-2 space-y-2 border-t border-default pt-3" @submit.prevent="connect(p.id)">
          <UFormField label="Restricted API key" help="Stripe → Developers → API keys → Create restricted key, with read access to Charges, Customers, Subscriptions and Products.">
            <UInput v-model="key" type="password" placeholder="rk_live_…" autocomplete="off" class="w-full" autofocus />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="sm" @click="adding = ''">Cancel</UButton>
            <UButton type="submit" size="sm" :loading="saving" :disabled="!key.trim()">Connect Stripe</UButton>
          </div>
        </form>
      </li>
    </ul>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import type { StripeConnection } from '#shared/stripe'
import { logTime } from '~/utils/emailStatus'

defineEmits<{ navigate: [] }>()
const { api, projects } = useAgent()
const state = reactive<Record<string, StripeConnection | undefined>>({})
const ready = ref(true)
const loading = ref(true)
const adding = ref('')
const key = ref('')
const saving = ref(false)
const error = ref('')

async function refresh(id: string) {
  const res = await api<{ connection: StripeConnection, ready: boolean }>('/admin/stripe', { query: { project: id } })
  state[id] = res.connection
  ready.value = res.ready
}

async function connect(id: string) {
  saving.value = true
  error.value = ''
  try {
    state[id] = (await api<{ connection: StripeConnection }>('/admin/stripe/connect', { method: 'POST', body: { project: id, apiKey: key.value } })).connection
    adding.value = ''
    key.value = ''
  } catch (cause: any) { error.value = cause.message || 'Could not connect Stripe' } finally { saving.value = false }
}

async function disconnect(id: string, name: string) {
  if (!confirm(`Disconnect Stripe from ${name}? The key and the payments synced from Stripe are forgotten. Contacts keep their Stripe attributes.`)) return
  error.value = ''
  try {
    await api('/admin/stripe', { method: 'DELETE', query: { project: id } })
    await refresh(id)
  } catch (cause: any) { error.value = cause.message || 'Could not disconnect' }
}

onMounted(async () => {
  // A role that may not see revenue gets a 403 for a project: it just shows as not connected.
  await Promise.all(projects.value.map(p => refresh(p.id).catch(() => {})))
  loading.value = false
})
</script>
