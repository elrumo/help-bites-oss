<script setup lang="ts">
/**
 * A new entry: a page from a template (each shown as a live, scaled render) or
 * blank, the assistant's wizard, or an entry of one of the project's own types.
 */
import { normalizeContent, normalizeStyle, type CmsComponentDef } from '#shared/cms/content'
import { CMS_TEMPLATES, libraryOf, templateContent } from '#shared/cms/library'
import { renderPage } from '#shared/cms/render'

const props = defineProps<{ projectId: string }>()
const open = defineModel<boolean>('open', { default: false })

const { api, projects } = useAgent()
const { t } = useI18n()

const project = computed(() => projects.value.find(p => p.id === props.projectId))
const types = ref<CmsComponentDef[]>([])
const type = ref('page')
const template = ref('saas')
const name = ref('')
const creating = ref(false)
const error = ref('')
const wizard = ref(false)

watch(open, async (value) => {
  if (!value) return
  error.value = ''
  wizard.value = false
  try {
    types.value = (await api<{ components: CmsComponentDef[] }>('/admin/cms/components', { query: { project: props.projectId } })).components.filter(c => c.root)
  } catch {}
})

const library = libraryOf()
// Thumbnails render once: the templates do not change while the panel runs.
const thumbs = computed(() => Object.fromEntries(CMS_TEMPLATES.map((tpl) => {
  const start = templateContent(tpl.id, project.value?.name || 'Acme')!
  const html = renderPage({ name: tpl.name, content: normalizeContent(start.content, library, 'page').content, style: normalizeStyle(start.style), projectAccent: project.value?.theme?.accent || '#4f46e5' }, { library, pk: '', host: '' })
  return [tpl.id, html]
})))

async function create() {
  creating.value = true
  error.value = ''
  try {
    const body = { project: props.projectId, type: type.value, ...(name.value.trim() ? { name: name.value.trim() } : {}), ...(type.value === 'page' && template.value !== 'blank' ? { template: template.value } : {}) }
    const { entry } = await api<{ entry: { id: string } }>('/admin/cms/entries', { method: 'POST', body })
    open.value = false
    await navigateTo(`/projects/${props.projectId}/pages/${entry.id}`)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('projectTools.pages.createError')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('projectTools.pages.newPage')" :description="wizard ? $t('projectTools.pages.wizard.description') : $t('projectTools.pages.newPageDescription')" :ui="{ content: 'sm:max-w-4xl' }">
    <template #body>
      <CmsWizard v-if="wizard" :project-id="projectId" @back="wizard = false" @done="open = false" />
      <form v-else class="space-y-5" @submit.prevent="create">
        <button type="button" class="flex w-full items-center gap-3 rounded-xl border border-default bg-gradient-to-r from-primary/10 to-transparent p-4 text-left transition-colors hover:border-primary/50" @click="wizard = true">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><UIcon name="i-lucide-sparkles" class="size-4.5" /></span>
          <span class="min-w-0 flex-1">
            <span class="block text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pages.wizard.title') }}</span>
            <span class="block text-xs text-muted">{{ $t('projectTools.pages.wizard.teaser') }}</span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed" />
        </button>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField v-if="types.length > 1" :label="$t('projectTools.pages.type')">
            <USelect v-model="type" :items="types.map(c => ({ label: c.name, value: c.key }))" class="w-full" />
          </UFormField>
          <UFormField :label="$t('projectTools.pages.name')">
            <UInput v-model="name" :placeholder="$t('projectTools.pages.namePlaceholder')" class="w-full" />
          </UFormField>
        </div>

        <div v-if="type === 'page'">
          <p class="mb-2 text-xs font-medium text-muted">{{ $t('projectTools.pages.startFrom') }}</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <button
              v-for="tpl in CMS_TEMPLATES"
              :key="tpl.id"
              type="button"
              class="overflow-hidden rounded-xl border text-left transition-colors"
              :class="template === tpl.id ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-accented'"
              @click="template = tpl.id"
            >
              <div class="pointer-events-none relative h-36 overflow-hidden bg-white">
                <iframe v-if="tpl.id !== 'blank'" :srcdoc="thumbs[tpl.id]" sandbox="" tabindex="-1" aria-hidden="true" class="absolute left-0 top-0 h-[576px] w-[1280px] origin-top-left scale-[0.21] border-0" />
                <div v-else class="grid h-full place-items-center text-dimmed"><UIcon name="i-lucide-file" class="size-6" /></div>
              </div>
              <div class="border-t border-default px-3 py-2">
                <p class="text-[13px] font-medium text-highlighted">{{ tpl.name }}</p>
                <p class="line-clamp-2 text-xs text-muted">{{ tpl.description }}</p>
              </div>
            </button>
          </div>
        </div>

        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="open = false" />
          <UButton type="submit" :label="$t('projectTools.pages.create')" :loading="creating" />
        </div>
      </form>
    </template>
  </UModal>
</template>
