<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.brand')">
      <template #actions>
        <UButton v-if="saved?.page.public" icon="i-lucide-external-link" :label="$t('projectTools.brand.viewPage')" :to="publicUrl" target="_blank" size="sm" color="neutral" variant="ghost" />
        <UButton v-if="dirty" :label="$t('projectTools.shared.save')" size="sm" :loading="saving" @click="save" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div class="flex flex-wrap items-end gap-4">
          <div class="mr-auto max-w-xl">
            <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectTools.brand.title') }}</h2>
            <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.brand.intro') }}</p>
          </div>
          <div class="inline-flex shrink-0 rounded-lg bg-elevated p-0.5" role="tablist" :aria-label="$t('projectTools.brand.title')">
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

        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
        <div v-if="loading" class="grid gap-3 sm:grid-cols-3"><USkeleton v-for="n in 6" :key="n" class="aspect-[4/3] w-full" /></div>

        <template v-else-if="config">
          <BrandFiles v-if="tab === 'files'" v-model:assets="assets" :project-id="id" />
          <BrandStyle v-else-if="tab === 'style'" v-model="config" />
          <BrandGuidelines v-else-if="tab === 'guidelines'" v-model="config.guidelines" />
          <BrandPage v-else v-model="config" :project-id="id" :public-url="publicUrl" :saved-public="!!saved?.page.public" @toggle-public="setPublic" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BrandConfig } from '#shared/brand'

definePageMeta({ middleware: 'agent' })

type Tab = 'files' | 'style' | 'guidelines' | 'page'

const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()
const route = useRoute()
const router = useRouter()
const id = String(route.params.id)

const config = ref<BrandConfig | null>(null)
const saved = ref<BrandConfig | null>(null)
const assets = ref<any[]>([])
const path = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')

const publicUrl = computed(() => `${appUrl.value}${path.value}`)
const dirty = computed(() => !!config.value && JSON.stringify(config.value) !== JSON.stringify(saved.value))

const tabs = computed(() => [
  { value: 'files' as Tab, label: t('projectTools.brand.tabs.files'), icon: 'i-lucide-images' },
  { value: 'style' as Tab, label: t('projectTools.brand.tabs.style'), icon: 'i-lucide-palette' },
  { value: 'guidelines' as Tab, label: t('projectTools.brand.tabs.guidelines'), icon: 'i-lucide-list-checks' },
  { value: 'page' as Tab, label: t('projectTools.brand.tabs.page'), icon: 'i-lucide-app-window' }
])
// The tab is in the URL, so a link can open the page settings directly.
const tab = computed<Tab>({
  get: () => (['files', 'style', 'guidelines', 'page'].includes(String(route.query.tab)) ? route.query.tab as Tab : 'files'),
  set: value => router.replace({ query: { ...route.query, tab: value === 'files' ? undefined : value } })
})

function fill(brand: BrandConfig) {
  saved.value = JSON.parse(JSON.stringify(brand))
  config.value = JSON.parse(JSON.stringify(brand))
}

async function save() {
  if (!config.value) return
  saving.value = true
  error.value = ''
  try {
    fill((await api<{ brand: BrandConfig }>('/admin/brand', { method: 'PATCH', query: { project: id }, body: config.value })).brand)
    toast.add({ title: t('projectTools.brand.saved'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    error.value = e?.message || t('projectTools.brand.saveError')
  } finally {
    saving.value = false
  }
}

// The public switch saves on its own, like the board's: it is a decision, not an edit.
async function setPublic(value: boolean) {
  error.value = ''
  try {
    const { brand } = await api<{ brand: BrandConfig }>('/admin/brand', { method: 'PATCH', query: { project: id }, body: { page: { public: value } } })
    saved.value = JSON.parse(JSON.stringify(brand))
    if (config.value) config.value.page.public = brand.page.public
    toast.add({ title: value ? t('projectTools.brand.pageOn') : t('projectTools.brand.pageOff'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    error.value = e?.message || t('projectTools.brand.saveError')
  }
}

onMounted(async () => {
  try {
    const result = await api<{ brand: BrandConfig, assets: any[], url: string }>('/admin/brand', { query: { project: id } })
    fill(result.brand)
    assets.value = result.assets
    path.value = result.url
  } catch (e: any) {
    error.value = e?.message || t('projectTools.brand.loadError')
  } finally {
    loading.value = false
  }
})
</script>
