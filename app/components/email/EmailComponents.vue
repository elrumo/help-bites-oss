<script setup lang="ts">
/**
 * The component library: custom HTML saved once and reused across emails,
 * with fields each email fills in (copy and links as content, colours and
 * sizes as style). On the masters page it is the shared library; on a
 * project's page, the project's own components plus the shared ones. The AI
 * designer saves here too. Editing one changes new insertions; emails that
 * already use it keep their copy until they update from the library.
 */
import { DEFAULT_SETTINGS, type EmailDocument } from '#shared/email/blocks'
import { componentInstance, type EmailComponentDef } from '#shared/email/components'
import type { AdminProject } from '~~/server/utils/projects'
import EmailSetupStrip from '~/components/email/EmailSetupStrip.vue'
import EmailTabs from '~/components/email/EmailTabs.vue'
import EmailCardPreview from '~/components/email/EmailCardPreview.vue'
import EmailComponentDialog from '~/components/email/EmailComponentDialog.vue'

const props = defineProps<{ project?: AdminProject | null }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const components = ref<EmailComponentDef[]>([])
const loading = ref(true)
const search = ref('')

async function load() {
  try {
    const res = await api<{ components: EmailComponentDef[] }>('/admin/email-components', { query: { project: props.project?.id || undefined } })
    components.value = res.components
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailEditor.loadComponentsError'), color: 'error' })
  } finally {
    loading.value = false
  }
}
onMounted(load)

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? components.value.filter(c => `${c.name} ${c.description}`.toLowerCase().includes(q)) : components.value
})

const preview = (c: EmailComponentDef): EmailDocument => ({
  settings: { ...DEFAULT_SETTINGS, title: c.name },
  blocks: [{ id: c.id, ...componentInstance(c) }]
})

const dialog = reactive<{ open: boolean, component: EmailComponentDef | null }>({ open: false, component: null })

function edit(component: EmailComponentDef | null) {
  dialog.component = component
  dialog.open = true
}

function onSaved(saved: EmailComponentDef) {
  components.value = [...components.value.filter(c => c.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name))
}

async function remove(component: EmailComponentDef) {
  if (!window.confirm(t('emailEditor.deleteComponentConfirm', { name: component.name }))) return
  try {
    await api(`/admin/email-components/${component.id}`, { method: 'DELETE' })
    components.value = components.value.filter(c => c.id !== component.id)
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailEditor.deleteComponentError'), color: 'error' })
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project?.id" :title="$t('sections.email')">
      <template #title><EmailTabs current="components" :masters="!project" /></template>
      <template #actions>
        <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('common.search')" size="sm" class="hidden w-44 sm:block" :aria-label="$t('emailEditor.searchComponents')" />
        <UButton icon="i-lucide-plus" :label="$t('emailEditor.newComponent')" size="sm" @click="edit(null)" />
      </template>
    </PageHeader>
    <EmailSetupStrip v-if="project" :project-id="project.id" />
    <p class="shrink-0 border-b border-default px-6 py-2.5 text-[13px] text-muted">
      {{ project ? $t('emailEditor.projectComponentsNote') : $t('emailEditor.sharedComponentsNote') }}
      {{ $t('emailEditor.componentsHelp') }}
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3"><USkeleton v-for="i in 3" :key="i" class="h-56" /></div>
      <EmptyState
        v-else-if="!shown.length"
        icon="i-lucide-puzzle"
        :title="search ? $t('emailEditor.nothingMatches') : $t('emailEditor.noComponents')"
        :description="search ? $t('emailEditor.tryAnotherSearch') : $t('emailEditor.noComponentsHint')"
      />
      <div v-else class="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3">
        <article v-for="c in shown" :key="c.id" class="group flex flex-col overflow-hidden rounded-xl border border-default bg-default">
          <button type="button" class="h-40 overflow-hidden border-b border-default bg-elevated/40 text-left" :aria-label="$t('emailEditor.editNamed', { name: c.name })" @click="edit(c)">
            <div class="pointer-events-none origin-top-left scale-[0.6]" style="width: 166%">
              <EmailCardPreview :document="preview(c)" />
            </div>
          </button>
          <div class="flex items-start gap-2 p-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">{{ c.name }}</p>
              <p class="line-clamp-2 text-xs text-muted">{{ c.description || $t('emailEditor.noDescription') }}</p>
              <div class="mt-2 flex flex-wrap gap-1">
                <UBadge :label="c.projectId ? $t('emailEditor.thisProject') : $t('emailEditor.shared')" color="neutral" variant="subtle" size="sm" />
                <UBadge :label="$t('emailEditor.fieldCount', c.fields.length)" color="neutral" variant="outline" size="sm" />
              </div>
            </div>
            <UDropdownMenu :items="[[{ label: $t('emailEditor.edit'), icon: 'i-lucide-pencil', onSelect: () => edit(c) }], [{ label: $t('emailEditor.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(c) }]]">
              <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" :aria-label="$t('emailEditor.componentActions', { name: c.name })" />
            </UDropdownMenu>
          </div>
        </article>
      </div>
    </div>

    <EmailComponentDialog v-model:open="dialog.open" :component="dialog.component" :project-id="project?.id ?? null" @saved="onSaved" />
  </div>
</template>
