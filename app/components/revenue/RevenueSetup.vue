<template>
  <div v-if="connection.source === 'revenuecat'" class="space-y-4 text-[13px]">
    <ol class="list-decimal space-y-3 pl-5">
      <li>{{ $t('projectTools.revenue.setupSheet.revenuecat.step1') }}</li>
      <li>
        {{ $t('projectTools.revenue.setupSheet.revenuecat.step2') }}
        <div class="mt-1.5 flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-md bg-elevated px-2 py-1.5 text-xs">{{ connection.webhook?.url }}</code>
          <UButton size="sm" color="neutral" variant="soft" :icon="copied === 'url' ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied === 'url' ? $t('projectTools.revenue.copied') : $t('projectTools.revenue.copy')" @click="copy('url', connection.webhook?.url || '')" />
        </div>
      </li>
      <li>
        {{ $t('projectTools.revenue.setupSheet.revenuecat.step3') }}
        <div v-if="connection.webhook?.token" class="mt-1.5 flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-md bg-elevated px-2 py-1.5 text-xs">{{ connection.webhook.token }}</code>
          <UButton size="sm" color="neutral" variant="soft" :icon="copied === 'token' ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied === 'token' ? $t('projectTools.revenue.copied') : $t('projectTools.revenue.copy')" @click="copy('token', connection.webhook.token)" />
        </div>
        <p v-else class="mt-1 text-xs text-muted">{{ $t('projectTools.revenue.setupSheet.revenuecat.tokenHidden') }}</p>
      </li>
      <li>{{ $t('projectTools.revenue.setupSheet.revenuecat.step4') }}</li>
    </ol>
    <p class="text-xs text-muted">{{ $t('projectTools.revenue.setupSheet.revenuecat.note') }}</p>
  </div>

  <div v-else class="space-y-3 text-[13px]">
    <p class="text-muted">{{ $t('projectTools.revenue.setupSheet.custom.intro') }}</p>
    <CodeBlock :code="curl" lang="bash" />
    <UButton size="sm" color="neutral" variant="soft" :icon="copied === 'curl' ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied === 'curl' ? $t('projectTools.revenue.copied') : $t('projectTools.revenue.copy')" @click="copy('curl', curl)" />
  </div>
</template>

<script setup lang="ts">
import type { RevenueConnection } from '#shared/revenue'

const props = defineProps<{ projectId: string, connection: RevenueConnection }>()
const origin = import.meta.client ? window.location.origin : ''
const copied = ref('')
const curl = computed(() => `curl -X POST ${origin}/v1/admin/revenue/payments \\
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project": "${props.projectId}",
    "payments": [
      { "id": "invoice-1042", "amount": 19.99, "currency": "usd", "paidAt": "2026-03-01T10:00:00Z", "email": "ada@example.com", "description": "Pro, yearly" }
    ],
    "subscriptions": [
      { "id": "member-7", "plan": "Pro", "amount": 4.99, "currency": "usd", "interval": "month", "status": "active", "email": "ada@example.com" }
    ]
  }'`)

async function copy(what: string, value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = what
  setTimeout(() => { if (copied.value === what) copied.value = '' }, 2000)
}
</script>
