<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.pricing')">
      <template #actions>
        <UButton icon="i-lucide-book-open" :label="$t('projectTools.pricing.guide')" to="/docs/pricing" target="_blank" size="sm" color="neutral" variant="ghost" />
        <UButton icon="i-lucide-plus" :label="$t('projectTools.pricing.newTable')" size="sm" :disabled="tables.length >= PRICING_LIMITS.tables" @click="openCreate" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectTools.pricing.title') }}</h2>
          <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.pricing.intro') }}</p>
        </div>

        <div v-if="!loading && !stripe.connected" class="flex flex-wrap items-center gap-3 rounded-xl border border-default bg-elevated/40 px-4 py-3">
          <UIcon name="i-lucide-circle-dollar-sign" class="size-5 text-muted" />
          <p class="min-w-0 flex-1 text-[13px] text-muted">{{ $t('projectTools.pricing.stripeNotConnected') }}</p>
          <UButton :label="$t('projectTools.pricing.connectStripe')" size="xs" color="neutral" variant="soft" :to="`/projects/${id}/revenue`" />
        </div>

        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
        <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 3" :key="n" class="h-14 w-full" /></div>

        <EmptyState v-else-if="!tables.length && !error" icon="i-lucide-tags" :title="$t('projectTools.pricing.emptyTitle')" :description="$t('projectTools.pricing.emptyDescription')" class="rounded-xl border border-dashed border-default">
          <UButton icon="i-lucide-plus" :label="$t('projectTools.pricing.newTable')" @click="openCreate" />
        </EmptyState>

        <ul v-else-if="tables.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="table in tables" :key="table.id">
            <NuxtLink :to="`/projects/${id}/pricing/${table.id}`" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-elevated/60">
              <div class="min-w-0 flex-1 basis-60">
                <p class="truncate text-[13px] font-medium text-highlighted">{{ table.name }}</p>
                <p class="truncate font-mono text-xs text-muted">{{ table.key }}</p>
              </div>
              <span class="text-xs text-dimmed">{{ $t(`projectTools.pricing.templates.${table.template}.label`) }} · {{ $t('projectTools.pricing.planCount', table.plans.length) }}</span>
              <UBadge v-if="table.warnings.length" icon="i-lucide-triangle-alert" :label="String(table.warnings.length)" color="warning" variant="soft" size="sm" :title="table.warnings.join('\n')" />
              <UBadge v-if="table.changed" :label="$t('projectTools.pricing.unpublishedChanges')" color="warning" variant="soft" size="sm" />
              <UBadge :label="table.status === 'published' ? $t('projectTools.pricing.publishedVersion', { version: table.version }) : $t('projectTools.pricing.draft')" :color="table.status === 'published' ? 'success' : 'neutral'" variant="soft" size="sm" />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>

    <UModal v-model:open="createOpen" :title="$t('projectTools.pricing.newTable')" :description="$t('projectTools.pricing.newTableDescription')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('projectTools.pricing.template')">
            <PricingTemplatePicker v-model="form.template" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.pricing.name')">
              <UInput v-model="form.name" :maxlength="PRICING_LIMITS.name" :placeholder="$t('projectTools.pricing.namePlaceholder')" class="w-full" required autofocus />
            </UFormField>
            <UFormField :label="$t('projectTools.pricing.key')" :hint="$t('projectTools.pricing.keyHint')">
              <UInput v-model="form.key" :placeholder="pricingKeyFrom(form.name || 'pricing')" class="w-full font-mono" />
            </UFormField>
          </div>
          <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="createOpen = false" />
            <UButton type="submit" :label="$t('projectTools.pricing.create')" :loading="creating" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { PRICING_LIMITS, pricingKeyFrom, type PricingTemplate } from '#shared/pricing'

definePageMeta({ middleware: 'agent' })

type Row = { id: string, key: string, name: string, template: PricingTemplate, status: 'draft' | 'published', version: number, plans: unknown[], changed: boolean, warnings: string[] }

const { api } = useAgent()
const { t } = useI18n()
const id = String(useRoute().params.id)
const tables = ref<Row[]>([])
const stripe = ref({ connected: true, error: '' })
const loading = ref(true)
const error = ref('')

const createOpen = ref(false)
const creating = ref(false)
const createError = ref('')
const form = reactive<{ name: string, key: string, template: PricingTemplate }>({ name: '', key: '', template: 'tiers' })

function openCreate() {
  form.name = tables.value.length ? '' : t('projectTools.pricing.defaultName')
  form.key = ''
  form.template = 'tiers'
  createError.value = ''
  createOpen.value = true
}

async function create() {
  creating.value = true
  createError.value = ''
  try {
    const { table } = await api<{ table: { id: string } }>('/admin/pricing-tables', { method: 'POST', body: { project: id, name: form.name.trim(), template: form.template, ...(form.key.trim() ? { key: form.key.trim() } : {}) } })
    createOpen.value = false
    await navigateTo(`/projects/${id}/pricing/${table.id}`)
  } catch (e: any) {
    createError.value = e?.message || t('projectTools.pricing.createError')
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  try {
    const answer = await api<{ tables: Row[], stripe: { connected: boolean, error: string } }>('/admin/pricing-tables', { query: { project: id } })
    tables.value = answer.tables
    stripe.value = answer.stripe
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.loadError')
  } finally {
    loading.value = false
  }
})
</script>
