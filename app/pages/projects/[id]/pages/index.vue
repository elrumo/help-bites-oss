<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.pages')">
      <template #actions>
        <UButton icon="i-lucide-book-open" :label="$t('projectTools.pages.guide')" to="/docs/pages" target="_blank" size="sm" color="neutral" variant="ghost" />
        <UButton v-if="tab === 'entries'" icon="i-lucide-plus" :label="$t('projectTools.pages.newPage')" size="sm" @click="newOpen = true" />
        <UButton v-else-if="tab === 'components'" icon="i-lucide-plus" :label="$t('projectTools.pages.newComponent')" size="sm" :to="`/projects/${id}/pages/components/new`" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div class="flex flex-wrap items-end gap-4">
          <div class="mr-auto max-w-xl">
            <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectTools.pages.title') }}</h2>
            <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.pages.intro') }}</p>
          </div>
          <div class="inline-flex shrink-0 rounded-lg bg-elevated p-0.5" role="tablist" :aria-label="$t('projectTools.pages.title')">
            <button
              v-for="item in tabs"
              :key="item.value"
              type="button"
              role="tab"
              :aria-selected="tab === item.value"
              class="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors"
              :class="tab === item.value ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'"
              @click="tab = item.value"
            >
              <UIcon :name="item.icon" class="size-3.5" />{{ item.label }}
            </button>
          </div>
        </div>

        <CmsEntries v-if="tab === 'entries'" :project-id="id" @new="newOpen = true" />
        <CmsComponents v-else-if="tab === 'components'" :project-id="id" />
        <CmsAssets v-else-if="tab === 'assets'" :project-id="id" />
        <CmsSettings v-else :project-id="id" />
      </div>
    </div>

    <CmsNewPage v-model:open="newOpen" :project-id="id" />
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'agent' })

type Tab = 'entries' | 'components' | 'assets' | 'settings'
const TABS: Tab[] = ['entries', 'components', 'assets', 'settings']

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const newOpen = ref(route.query.new === '1')

const tabs = computed(() => [
  { value: 'entries' as Tab, label: t('projectTools.pages.tabs.entries'), icon: 'i-lucide-files' },
  { value: 'components' as Tab, label: t('projectTools.pages.tabs.components'), icon: 'i-lucide-boxes' },
  { value: 'assets' as Tab, label: t('projectTools.pages.tabs.assets'), icon: 'i-lucide-images' },
  { value: 'settings' as Tab, label: t('projectTools.pages.tabs.settings'), icon: 'i-lucide-settings-2' }
])
// The tab is in the URL, so the editor can link straight to the components.
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? route.query.tab as Tab : 'entries'),
  set: value => router.replace({ query: { ...route.query, tab: value === 'entries' ? undefined : value } })
})
</script>
