<template>
  <div class="space-y-8">
    <label
      class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center transition-colors"
      :class="dragging ? 'border-primary bg-primary/5' : 'border-default hover:border-accented'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="drop"
    >
      <UIcon name="i-lucide-upload" class="size-5 text-muted" />
      <span class="text-[13px] font-medium text-highlighted">{{ $t('projectTools.brand.files.drop') }}</span>
      <span class="text-xs text-muted">{{ $t('projectTools.brand.files.types') }}</span>
      <input type="file" multiple :accept="ACCEPT" class="sr-only" @change="choose">
    </label>

    <ul v-if="queue.length" class="space-y-1 text-[13px]">
      <li v-for="item in queue" :key="item.id" class="flex items-center gap-2" :class="item.error ? 'text-error' : 'text-muted'">
        <UIcon :name="item.error ? 'i-lucide-circle-alert' : 'i-lucide-loader-circle'" class="size-4 shrink-0" :class="item.error ? '' : 'animate-spin'" />
        <span class="truncate">{{ item.name }}</span>
        <span v-if="item.error" class="truncate">{{ item.error }}</span>
        <UButton v-if="item.error" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="ml-auto" :aria-label="$t('projectTools.brand.files.dismiss')" @click="queue = queue.filter(q => q !== item)" />
      </li>
    </ul>

    <EmptyState v-if="!assets.length && !queue.length" icon="i-lucide-swatch-book" :title="$t('projectTools.brand.files.emptyTitle')" :description="$t('projectTools.brand.files.emptyDescription')" />

    <section v-for="group in groups" :key="group.key">
      <div class="mb-3 flex items-baseline gap-2">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t(`projectTools.brand.sections.${group.key}`) }}</h3>
        <span class="text-xs tabular-nums text-dimmed">{{ group.items.length }}</span>
      </div>
      <ul class="grid gap-4" :class="group.key === 'screenshots' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'">
        <li v-for="asset in group.items" :key="asset.id" class="group min-w-0">
          <div class="relative overflow-hidden rounded-xl border border-default" :class="[group.key === 'screenshots' ? 'aspect-[9/16]' : 'aspect-[4/3]', tileBackground(asset.background)]">
            <!-- Absolutely positioned so the image has a definite box to fit and centre in. -->
            <div class="absolute flex items-center justify-center" :class="group.key === 'screenshots' ? 'inset-2' : 'inset-[12%]'">
              <img v-if="asset.mime.startsWith('image/')" :src="asset.url" :alt="asset.name" class="max-h-full max-w-full object-contain" loading="lazy">
              <span v-else class="text-xs font-semibold text-muted">{{ fileType(asset.mime) }}</span>
            </div>
            <UBadge v-if="!asset.public" :label="$t('projectTools.brand.files.private')" color="neutral" variant="solid" size="sm" class="absolute left-2 top-2" />
            <UDropdownMenu :items="menuFor(asset)" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="solid" square class="absolute right-2 top-2 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" :aria-label="$t('projectTools.brand.files.actionsFor', { name: asset.name })" />
            </UDropdownMenu>
          </div>
          <button type="button" class="mt-2 block w-full min-w-0 text-left" @click="edit(asset)">
            <span class="block truncate text-[13px] font-medium text-highlighted">{{ asset.name }}</span>
            <span class="block truncate text-xs text-muted">{{ facts(asset) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <UModal v-model:open="editOpen" :title="$t('projectTools.brand.files.editTitle')">
      <template #body>
        <form v-if="editing" class="space-y-4" @submit.prevent="saveEdit">
          <UFormField :label="$t('projectTools.brand.files.name')" :hint="$t('projectTools.brand.files.nameHint')"><UInput v-model="editing.name" :maxlength="BRAND_LIMITS.assetName" class="w-full" required /></UFormField>
          <UFormField :label="$t('projectTools.brand.files.description')"><UInput v-model="editing.description" maxlength="300" class="w-full" /></UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.brand.files.kind')"><USelect v-model="editing.kind" :items="kindItems" class="w-full" /></UFormField>
            <UFormField :label="$t('projectTools.brand.files.background')" :hint="$t('projectTools.brand.files.backgroundHint')"><USelect v-model="editing.background" :items="backgroundItems" class="w-full" /></UFormField>
          </div>
          <USwitch v-model="editing.public" :label="$t('projectTools.brand.files.public')" :description="$t('projectTools.brand.files.publicHint')" />
          <p v-if="editError" class="text-sm text-error">{{ editError }}</p>
          <div class="flex items-center gap-2 pt-2">
            <UButton icon="i-lucide-trash-2" :label="$t('projectTools.brand.files.delete')" color="error" variant="ghost" @click="remove(editing)" />
            <UButton class="ml-auto" color="neutral" variant="ghost" :label="$t('common.cancel')" @click="editOpen = false" />
            <UButton type="submit" :label="$t('projectTools.shared.save')" :loading="editSaving" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { BRAND_ASSET_BACKGROUNDS, BRAND_ASSET_KINDS, BRAND_LIMITS, brandSectionOf, type BrandAssetBackground } from '#shared/brand'
import { formatBytes } from '#shared/entitlements'
import type { AdminProject } from '~~/server/utils/projects'
import type { BrandAssetView } from '~~/server/utils/brand'

const props = defineProps<{ projectId: string }>()
const assets = defineModel<BrandAssetView[]>('assets', { required: true })
const { api, projects } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico,application/pdf'
const TYPES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'image/svg+xml': 'SVG', 'image/x-icon': 'ICO', 'application/pdf': 'PDF' }
const fileType = (mime: string) => TYPES[mime] || 'File'
const facts = (a: BrandAssetView) => [fileType(a.mime), a.width && a.height ? `${a.width} × ${a.height}` : '', formatBytes(a.size)].filter(Boolean).join(', ')
const tileBackground = (bg: BrandAssetBackground) => bg === 'dark' ? 'bg-stone-900' : bg === 'light' ? 'bg-stone-50' : 'tile-checker'

const groups = computed(() => (['logos', 'screenshots', 'assets'] as const)
  .map(key => ({ key, items: assets.value.filter(a => brandSectionOf(a.kind) === key) }))
  .filter(g => g.items.length))

const kindItems = computed(() => BRAND_ASSET_KINDS.map(value => ({ value, label: t(`projectTools.brand.kinds.${value}`) })))
const backgroundItems = computed(() => BRAND_ASSET_BACKGROUNDS.map(value => ({ value, label: t(`projectTools.brand.backgrounds.${value}`) })))

// ---- upload ----
const dragging = ref(false)
const queue = ref<{ id: number, name: string, error: string }[]>([])
let next = 0

function choose(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadAll([...(input.files || [])])
  input.value = ''
}

function drop(event: DragEvent) {
  dragging.value = false
  void uploadAll([...(event.dataTransfer?.files || [])])
}

async function uploadAll(files: File[]) {
  // One at a time, so the storage limit stops at the file that does not fit.
  for (const file of files) {
    const item = reactive({ id: ++next, name: file.name, error: '' })
    queue.value.push(item)
    try {
      const body = new FormData()
      body.append('project', props.projectId)
      body.append('file', file)
      const { asset } = await api<{ asset: BrandAssetView }>('/admin/brand/assets', { method: 'POST', body })
      assets.value = [...assets.value, asset]
      queue.value = queue.value.filter(q => q.id !== item.id)
    } catch (e: any) {
      item.error = e?.message || t('projectTools.brand.files.uploadError')
    }
  }
}

// ---- edit ----
const editOpen = ref(false)
const editing = ref<BrandAssetView | null>(null)
const editSaving = ref(false)
const editError = ref('')

function edit(asset: BrandAssetView) {
  editing.value = { ...asset }
  editError.value = ''
  editOpen.value = true
}

async function patch(asset: BrandAssetView, body: Record<string, unknown>) {
  const { asset: updated } = await api<{ asset: BrandAssetView }>(`/admin/brand/assets/${asset.id}`, { method: 'PATCH', body })
  assets.value = assets.value.map(a => (a.id === updated.id ? updated : a))
}

async function saveEdit() {
  if (!editing.value) return
  editSaving.value = true
  editError.value = ''
  try {
    const { name, description, kind, background, public: isPublic } = editing.value
    await patch(editing.value, { name, description, kind, background, public: isPublic })
    editOpen.value = false
  } catch (e: any) {
    editError.value = e?.message || t('projectTools.brand.saveError')
  } finally {
    editSaving.value = false
  }
}

async function remove(asset: BrandAssetView) {
  if (!confirm(t('projectTools.brand.files.deleteConfirm', { name: asset.name }))) return
  try {
    await api(`/admin/brand/assets/${asset.id}`, { method: 'DELETE' })
    assets.value = assets.value.filter(a => a.id !== asset.id)
    editOpen.value = false
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.brand.saveError'), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function useFor(asset: BrandAssetView, field: 'brandLogoUrl' | 'iconUrl') {
  try {
    const { project } = await api<{ project: AdminProject }>(`/admin/projects/${props.projectId}`, { method: 'PATCH', body: { [field]: asset.url } })
    projects.value = projects.value.map(p => (p.id === project.id ? project : p))
    toast.add({ title: field === 'iconUrl' ? t('projectTools.brand.files.iconSet') : t('projectTools.brand.files.logoSet'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.brand.saveError'), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function copyLink(asset: BrandAssetView) {
  try {
    await navigator.clipboard.writeText(asset.url)
    toast.add({ title: t('projectTools.brand.files.linkCopied'), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {}
}

function menuFor(asset: BrandAssetView) {
  const image = asset.mime.startsWith('image/') && asset.mime !== 'image/x-icon'
  return [[
    { label: t('projectTools.brand.files.edit'), icon: 'i-lucide-pencil', onSelect: () => edit(asset) },
    { label: t('projectTools.brand.files.copyLink'), icon: 'i-lucide-link', onSelect: () => copyLink(asset) },
    { label: t('projectTools.brand.files.download'), icon: 'i-lucide-download', onSelect: () => window.open(asset.public ? `${appUrl.value}${asset.downloadUrl}` : asset.url, '_blank') },
    { label: asset.public ? t('projectTools.brand.files.makePrivate') : t('projectTools.brand.files.makePublic'), icon: asset.public ? 'i-lucide-eye-off' : 'i-lucide-eye', onSelect: () => patch(asset, { public: !asset.public }).catch(() => {}) }
  ], ...(image
    ? [[
        { label: t('projectTools.brand.files.useAsLogo'), icon: 'i-lucide-image', onSelect: () => useFor(asset, 'brandLogoUrl') },
        { label: t('projectTools.brand.files.useAsIcon'), icon: 'i-lucide-app-window', onSelect: () => useFor(asset, 'iconUrl') }
      ]]
    : []), [
    { label: t('projectTools.brand.files.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => remove(asset) }
  ]]
}
</script>

<style scoped>
.tile-checker {
  background-color: var(--ui-bg-muted);
  background-image: linear-gradient(45deg, var(--ui-bg-accented) 25%, transparent 25%, transparent 75%, var(--ui-bg-accented) 75%), linear-gradient(45deg, var(--ui-bg-accented) 25%, transparent 25%, transparent 75%, var(--ui-bg-accented) 75%);
  background-size: 14px 14px;
  background-position: 0 0, 7px 7px;
}
</style>
