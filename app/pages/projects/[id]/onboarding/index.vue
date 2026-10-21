<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.onboarding')">
      <template #actions>
        <UButton icon="i-lucide-book-open" :label="$t('projectTools.onboarding.guide')" to="/docs/onboarding" target="_blank" size="sm" color="neutral" variant="ghost" />
        <UButton icon="i-lucide-plus" :label="$t('projectTools.onboarding.newFlow')" size="sm" @click="openCreate" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectTools.onboarding.title') }}</h2>
          <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.onboarding.intro') }}</p>
        </div>

        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
        <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 3" :key="n" class="h-14 w-full" /></div>

        <EmptyState v-else-if="!flows.length && !error" icon="i-lucide-gallery-horizontal-end" :title="$t('projectTools.onboarding.emptyTitle')" :description="$t('projectTools.onboarding.emptyDescription')" class="rounded-xl border border-dashed border-default">
          <UButton icon="i-lucide-plus" :label="$t('projectTools.onboarding.newFlow')" @click="openCreate" />
        </EmptyState>

        <ul v-else-if="flows.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="flow in flows" :key="flow.id">
            <NuxtLink :to="`/projects/${id}/onboarding/${flow.id}`" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-elevated/60">
              <div class="min-w-0 flex-1 basis-60">
                <p class="truncate text-[13px] font-medium text-highlighted">{{ flow.name }}</p>
                <p class="truncate font-mono text-xs text-muted">{{ flow.key }}</p>
              </div>
              <span class="text-xs tabular-nums text-dimmed">{{ $t('projectTools.onboarding.stepCount', flow.steps.length) }}</span>
              <UBadge v-if="flow.changed" :label="$t('projectTools.onboarding.unpublishedChanges')" color="warning" variant="soft" size="sm" />
              <UBadge :label="flow.status === 'published' ? $t('projectTools.onboarding.publishedVersion', { version: flow.version }) : $t('projectTools.onboarding.draft')" :color="flow.status === 'published' ? 'success' : 'neutral'" variant="soft" size="sm" />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>

    <UModal v-model:open="createOpen" :title="$t('projectTools.onboarding.newFlow')" :description="$t('projectTools.onboarding.newFlowDescription')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('projectTools.onboarding.name')">
            <UInput v-model="form.name" :maxlength="ONBOARDING_LIMITS.name" :placeholder="$t('projectTools.onboarding.namePlaceholder')" class="w-full" required autofocus />
          </UFormField>
          <UFormField :label="$t('projectTools.onboarding.key')" :hint="$t('projectTools.onboarding.keyHint')">
            <UInput v-model="form.key" :placeholder="onboardingKeyFrom(form.name || 'welcome')" class="w-full font-mono" />
          </UFormField>
          <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="createOpen = false" />
            <UButton type="submit" :label="$t('projectTools.onboarding.create')" :loading="creating" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { ONBOARDING_LIMITS, onboardingKeyFrom } from '#shared/onboarding'

definePageMeta({ middleware: 'agent' })

const { api } = useAgent()
const { t } = useI18n()
const id = String(useRoute().params.id)
const flows = ref<any[]>([])
const loading = ref(true)
const error = ref('')

const createOpen = ref(false)
const creating = ref(false)
const createError = ref('')
const form = reactive({ name: '', key: '' })

function openCreate() {
  form.name = flows.value.length ? '' : t('projectTools.onboarding.defaultName')
  form.key = ''
  createError.value = ''
  createOpen.value = true
}

async function create() {
  creating.value = true
  createError.value = ''
  try {
    const { flow } = await api<{ flow: { id: string } }>('/admin/onboarding/flows', { method: 'POST', body: { project: id, name: form.name.trim(), ...(form.key.trim() ? { key: form.key.trim() } : {}) } })
    createOpen.value = false
    await navigateTo(`/projects/${id}/onboarding/${flow.id}`)
  } catch (e: any) {
    createError.value = e?.message || t('projectTools.onboarding.createError')
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  try {
    flows.value = (await api<{ flows: any[] }>('/admin/onboarding/flows', { query: { project: id } })).flows
  } catch (e: any) {
    error.value = e?.message || t('projectTools.onboarding.loadError')
  } finally {
    loading.value = false
  }
})
</script>
