<template>
  <CmsEditor
    v-if="entry && library"
    ref="editor"
    :entry="entry"
    :library="library"
    :project-id="id"
    :pk="project?.publicKey || ''"
    :project-accent="project?.theme?.accent || ''"
    :preview-url="settings?.previewUrl || ''"
    @library="loadLibrary"
  >
    <template #assistant="{ content, selectedId }">
      <CmsChat
        :project-id="id"
        :entry-id="entry.id"
        :content="content"
        :selected-id="selectedId"
        :library="library"
        :first-prompt="firstPrompt"
        @content="editor?.replaceContent($event, { history: false })"
        @page="editor?.applyPage($event)"
        @checkpoint="editor?.pushHistory()"
        @restore="editor?.replaceContent($event)"
        @component="loadLibrary"
      />
    </template>
  </CmsEditor>
  <div v-else class="grid h-full place-items-center text-sm text-muted">
    <UIcon v-if="!loadError" name="i-lucide-loader-circle" class="size-5 animate-spin" />
    <span v-else>{{ loadError }}</span>
  </div>
</template>

<script setup lang="ts">
import type { CmsComponentDef, CmsLibrary, CmsSettings } from '#shared/cms/content'
import { libraryOf } from '#shared/cms/library'
import type { CmsEntryView } from '~~/server/utils/cms'
import type CmsEditor from '~/components/cms/CmsEditor.vue'

definePageMeta({ layout: 'bare', middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const entryId = String(route.params.entryId)
const { api, projects, loadProjects } = useAgent()
const { t } = useI18n()

const entry = ref<CmsEntryView | null>(null)
const library = shallowRef<CmsLibrary | null>(null)
const settings = ref<CmsSettings | null>(null)
const loadError = ref('')
const editor = ref<InstanceType<typeof CmsEditor> | null>(null)
const project = computed(() => projects.value.find(p => p.id === id))
// The wizard hands its first message over, once.
const handed = useState<string>('cmsFirstPrompt')
const firstPrompt = handed.value || ''
handed.value = ''

async function loadLibrary() {
  const custom = (await api<{ components: CmsComponentDef[] }>('/admin/cms/components', { query: { project: id } })).components.filter(c => !c.builtin)
  library.value = libraryOf(custom)
}

onMounted(async () => {
  try {
    const [res] = await Promise.all([
      api<{ entry: CmsEntryView }>(`/admin/cms/entries/${entryId}`),
      loadLibrary(),
      api<{ settings: CmsSettings }>('/admin/cms/settings', { query: { project: id } }).then(r => (settings.value = r.settings)),
      projects.value.length ? null : loadProjects()
    ])
    entry.value = res.entry
  } catch (e: any) {
    loadError.value = e?.message || t('projectTools.pages.loadError')
  }
})
</script>
