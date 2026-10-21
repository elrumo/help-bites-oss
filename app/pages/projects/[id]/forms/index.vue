<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.forms')">
      <template #actions>
        <UButton icon="i-lucide-book-open" :label="$t('projectTools.forms.guide')" to="/docs/forms" target="_blank" size="sm" color="neutral" variant="ghost" />
        <UButton icon="i-lucide-plus" :label="$t('projectTools.forms.newForm')" size="sm" @click="openCreate" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectTools.forms.title') }}</h2>
          <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.forms.intro') }}</p>
        </div>

        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
        <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 3" :key="n" class="h-14 w-full" /></div>

        <EmptyState v-else-if="!forms.length && !error" icon="i-lucide-clipboard-list" :title="$t('projectTools.forms.emptyTitle')" :description="$t('projectTools.forms.emptyDescription')" class="rounded-xl border border-dashed border-default">
          <UButton icon="i-lucide-plus" :label="$t('projectTools.forms.newForm')" @click="openCreate" />
        </EmptyState>

        <ul v-else-if="forms.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="form in forms" :key="form.id">
            <NuxtLink :to="`/projects/${id}/forms/${form.id}`" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-elevated/60">
              <div class="min-w-0 flex-1 basis-60">
                <p class="truncate text-[13px] font-medium text-highlighted">{{ form.name }}</p>
                <p class="truncate font-mono text-xs text-muted">{{ form.key }}</p>
              </div>
              <span class="text-xs tabular-nums text-muted">{{ $t('projectTools.forms.leadCount', form.stats.leads) }}</span>
              <span v-if="form.settings.doubleOptIn" class="text-xs tabular-nums text-dimmed">{{ $t('projectTools.forms.confirmedCount', { count: form.stats.confirmed.toLocaleString() }) }}</span>
              <UBadge :label="form.active ? $t('projectTools.forms.live') : $t('projectTools.forms.closed')" :color="form.active ? 'success' : 'neutral'" variant="soft" size="sm" />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>

    <UModal v-model:open="createOpen" :title="$t('projectTools.forms.newForm')" :description="$t('projectTools.forms.newFormDescription')" :ui="{ content: 'max-w-xl' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" :aria-label="$t('projectTools.forms.startFrom')">
            <button
              v-for="preset in presets"
              :key="preset.value"
              type="button"
              role="radio"
              :aria-checked="draft.preset === preset.value"
              class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors"
              :class="draft.preset === preset.value ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/60'"
              @click="draft.preset = preset.value"
            >
              <UIcon :name="preset.icon" class="size-4 text-muted" />
              <span class="text-[13px] font-medium text-highlighted">{{ preset.label }}</span>
              <span class="text-xs text-muted">{{ preset.hint }}</span>
            </button>
          </div>
          <UFormField :label="$t('projectTools.forms.name')">
            <UInput v-model="draft.name" :maxlength="LEAD_FORM_LIMITS.name" :placeholder="$t('projectTools.forms.namePlaceholder')" class="w-full" required autofocus />
          </UFormField>
          <UFormField :label="$t('projectTools.forms.key')" :hint="$t('projectTools.forms.keyHint')">
            <UInput v-model="draft.key" :placeholder="leadFormKeyFrom(draft.name || 'waitlist')" class="w-full font-mono" />
          </UFormField>
          <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="createOpen = false" />
            <UButton type="submit" :label="$t('projectTools.forms.create')" :loading="creating" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { LEAD_FORM_LIMITS, leadFormKeyFrom, type LeadForm, type LeadFormPreset } from '#shared/leadForms'

definePageMeta({ middleware: 'agent' })

const { api } = useAgent()
const { t } = useI18n()
const id = String(useRoute().params.id)
const forms = ref<LeadForm[]>([])
const loading = ref(true)
const error = ref('')

const createOpen = ref(false)
const creating = ref(false)
const createError = ref('')
const draft = reactive<{ name: string, key: string, preset: LeadFormPreset }>({ name: '', key: '', preset: 'email' })
const presets = computed(() => [
  { value: 'email' as const, icon: 'i-lucide-mail', label: t('projectTools.forms.presets.email'), hint: t('projectTools.forms.presets.emailHint') },
  { value: 'waitlist' as const, icon: 'i-lucide-list-ordered', label: t('projectTools.forms.presets.waitlist'), hint: t('projectTools.forms.presets.waitlistHint') },
  { value: 'detailed' as const, icon: 'i-lucide-clipboard-list', label: t('projectTools.forms.presets.detailed'), hint: t('projectTools.forms.presets.detailedHint') }
])

function openCreate() {
  draft.name = forms.value.length ? '' : t('projectTools.forms.defaultName')
  draft.key = ''
  draft.preset = 'email'
  createError.value = ''
  createOpen.value = true
}

async function create() {
  creating.value = true
  createError.value = ''
  try {
    const { form } = await api<{ form: LeadForm }>('/admin/lead-forms', { method: 'POST', body: { project: id, name: draft.name.trim(), preset: draft.preset, ...(draft.key.trim() ? { key: draft.key.trim() } : {}) } })
    createOpen.value = false
    await navigateTo(`/projects/${id}/forms/${form.id}`)
  } catch (e: any) {
    createError.value = e?.message || t('projectTools.forms.createError')
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  try {
    forms.value = (await api<{ forms: LeadForm[] }>('/admin/lead-forms', { query: { project: id } })).forms
  } catch (e: any) {
    error.value = e?.message || t('projectTools.forms.loadError')
  } finally {
    loading.value = false
  }
})
</script>
