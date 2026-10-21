<script setup lang="ts">
/**
 * Pages settings: the messaging brief the assistant writes and reads, the
 * developer's own site for live editing, and how to read the content from code.
 */
import { EMPTY_BRIEF, validPreviewUrl, type CmsSettings } from '#shared/cms/content'

const props = defineProps<{ projectId: string }>()
const { api, projects } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()

const settings = ref<CmsSettings | null>(null)
const saved = ref('')
const saving = ref(false)
const error = ref('')
const pillars = ref('')

const pk = computed(() => projects.value.find(p => p.id === props.projectId)?.publicKey || 'pk_…')
const dirty = computed(() => !!settings.value && JSON.stringify({ ...settings.value, brief: { ...settings.value.brief, pillars: pillarList() } }) !== saved.value)
const urlOk = computed(() => validPreviewUrl(settings.value?.previewUrl ?? ''))
const pillarList = () => pillars.value.split('\n').map(p => p.trim()).filter(Boolean)

function fill(next: CmsSettings) {
  settings.value = JSON.parse(JSON.stringify(next))
  pillars.value = next.brief.pillars.join('\n')
  saved.value = JSON.stringify(next)
}

async function save() {
  if (!settings.value || !urlOk.value) return
  saving.value = true
  try {
    fill((await api<{ settings: CmsSettings }>('/admin/cms/settings', { method: 'PATCH', body: { project: props.projectId, previewUrl: settings.value.previewUrl, brief: { ...settings.value.brief, pillars: pillarList() } } })).settings)
    toast.add({ title: t('projectTools.pages.settingsSaved'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: t('projectTools.pages.saveError'), description: e?.data?.statusMessage || e?.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    fill((await api<{ settings: CmsSettings }>('/admin/cms/settings', { query: { project: props.projectId } })).settings)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.loadError')
  }
})

const briefFields = ['audience', 'problem', 'valueProposition', 'proof', 'tone', 'callToAction'] as const
const snippet = computed(() => `import { createClient } from '${appUrl.value}/cms.mjs'

const cms = createClient({ host: '${appUrl.value}', pk: '${pk.value}' })
const { entry } = await cms.getEntry('home')`)
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <USkeleton v-if="!settings && !error" class="h-64 w-full" />
    <template v-else-if="settings">
      <section class="space-y-4 rounded-xl border border-default p-5">
        <div>
          <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pages.brief.title') }}</h3>
          <p class="mt-1 text-xs text-muted">{{ $t('projectTools.pages.brief.intro') }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField v-for="key in briefFields" :key="key" :label="$t(`projectTools.pages.brief.${key}`)" :class="key === 'valueProposition' || key === 'problem' ? 'sm:col-span-2' : ''">
            <UTextarea v-if="key !== 'tone' && key !== 'callToAction'" v-model="settings.brief[key]" autoresize :rows="2" :maxrows="6" class="w-full" />
            <UInput v-else v-model="settings.brief[key]" class="w-full" />
          </UFormField>
          <UFormField :label="$t('projectTools.pages.brief.pillars')" :help="$t('projectTools.pages.brief.pillarsHelp')" class="sm:col-span-2">
            <UTextarea v-model="pillars" autoresize :rows="3" :maxrows="8" class="w-full" />
          </UFormField>
        </div>
        <UButton v-if="JSON.stringify(settings.brief) !== JSON.stringify(EMPTY_BRIEF) || pillars" icon="i-lucide-eraser" :label="$t('projectTools.pages.brief.clear')" size="xs" color="neutral" variant="ghost" @click="settings.brief = { ...EMPTY_BRIEF }; pillars = ''" />
      </section>

      <section class="space-y-4 rounded-xl border border-default p-5">
        <div>
          <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pages.yourSite.title') }}</h3>
          <p class="mt-1 text-xs text-muted">{{ $t('projectTools.pages.yourSite.intro') }}</p>
        </div>
        <UFormField :label="$t('projectTools.pages.yourSite.url')" :error="urlOk ? undefined : $t('projectTools.pages.yourSite.urlError')" :help="$t('projectTools.pages.yourSite.urlHelp')">
          <UInput v-model="settings.previewUrl" placeholder="http://localhost:5173/{slug}" class="w-full font-mono" />
        </UFormField>
      </section>

      <section class="space-y-3 rounded-xl border border-default p-5">
        <div>
          <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pages.code.title') }}</h3>
          <p class="mt-1 text-xs text-muted">{{ $t('projectTools.pages.code.intro') }}</p>
        </div>
        <pre class="overflow-x-auto rounded-lg bg-elevated p-3 font-mono text-xs text-default">{{ snippet }}</pre>
        <UButton icon="i-lucide-book-open" :label="$t('projectTools.pages.code.docs')" to="/docs/pages" target="_blank" size="xs" color="neutral" variant="soft" />
      </section>

      <div class="flex justify-end">
        <UButton :label="$t('projectTools.shared.save')" :disabled="!dirty || !urlOk" :loading="saving" @click="save" />
      </div>
    </template>
  </div>
</template>
