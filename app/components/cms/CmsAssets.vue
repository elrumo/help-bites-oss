<script setup lang="ts">
/**
 * The project's files for Pages: upload (button or drop), rename, alt text,
 * copy the URL, delete. With `pick`, a click hands the file to the caller
 * instead (the asset picker).
 */
import { CMS_LIMITS, type CmsAssetRef } from '#shared/cms/content'
import { formatBytes } from '#shared/entitlements'
import { useClipboard } from '@vueuse/core'

type Asset = CmsAssetRef & { name: string, size: number, createdAt: string | null }

const props = defineProps<{ projectId: string, pick?: boolean }>()
const emit = defineEmits<{ (e: 'pick', asset: CmsAssetRef): void }>()

const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()
const { copy } = useClipboard()

const assets = ref<Asset[]>([])
const loading = ref(true)
const uploading = ref(0)
const error = ref('')
const query = ref('')
const editing = ref<Asset | null>(null)
const over = ref(false)
const input = ref<HTMLInputElement | null>(null)

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? assets.value.filter(a => a.name.toLowerCase().includes(q) || a.alt.toLowerCase().includes(q)) : assets.value
})

async function load() {
  try {
    assets.value = (await api<{ assets: Asset[] }>('/admin/cms/assets', { query: { project: props.projectId } })).assets
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.assetsLoadError')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function upload(files: FileList | File[] | null) {
  for (const file of [...(files || [])]) {
    if (file.size > CMS_LIMITS.assetBytes) {
      toast.add({ title: t('projectTools.pages.tooLarge', { name: file.name }), color: 'error' })
      continue
    }
    uploading.value++
    try {
      const body = new FormData()
      body.append('project', props.projectId)
      body.append('file', file)
      const { asset } = await api<{ asset: Asset }>('/admin/cms/assets', { method: 'POST', body })
      assets.value = [asset, ...assets.value]
      if (props.pick && files && [...files].length === 1) emit('pick', ref_(asset))
    } catch (e: any) {
      toast.add({ title: t('projectTools.pages.uploadError'), description: e?.data?.statusMessage || e?.message, color: 'error' })
    } finally {
      uploading.value--
    }
  }
  if (input.value) input.value.value = ''
}

/** What an asset field stores. */
const ref_ = (a: Asset): CmsAssetRef => ({ id: a.id, url: a.url, alt: a.alt, mime: a.mime, ...(a.width ? { width: a.width, height: a.height } : {}) })

async function saveEdit() {
  const a = editing.value
  if (!a) return
  try {
    const { asset } = await api<{ asset: Asset }>(`/admin/cms/assets/${a.id}`, { method: 'PATCH', body: { name: a.name, alt: a.alt } })
    assets.value = assets.value.map(x => x.id === asset.id ? asset : x)
    editing.value = null
  } catch (e: any) {
    toast.add({ title: t('projectTools.pages.saveError'), description: e?.message, color: 'error' })
  }
}

async function remove(a: Asset) {
  if (!confirm(t('projectTools.pages.deleteFileConfirm', { name: a.name }))) return
  try {
    await api(`/admin/cms/assets/${a.id}`, { method: 'DELETE' })
    assets.value = assets.value.filter(x => x.id !== a.id)
  } catch (e: any) {
    toast.add({ title: t('projectTools.pages.deleteError'), description: e?.message, color: 'error' })
  }
}

function onDrop(e: DragEvent) {
  over.value = false
  upload(e.dataTransfer?.files || null)
}

function copyUrl(a: Asset) {
  copy(a.url)
  toast.add({ title: t('projectTools.pages.urlCopied'), icon: 'i-lucide-check', color: 'success' })
}
</script>

<template>
  <div class="space-y-4" @dragover.prevent="over = true" @dragleave.self="over = false" @drop.prevent="onDrop">
    <div class="flex flex-wrap items-center gap-2">
      <UInput v-model="query" icon="i-lucide-search" :placeholder="$t('projectTools.pages.searchFiles')" size="sm" class="min-w-0 flex-1 basis-48" />
      <UButton icon="i-lucide-upload" :label="$t('projectTools.pages.upload')" size="sm" :loading="uploading > 0" @click="input?.click()" />
      <input ref="input" type="file" multiple accept="image/*,video/mp4,video/webm,application/pdf" class="hidden" @change="upload(($event.target as HTMLInputElement).files)">
    </div>

    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <div v-if="loading" class="grid grid-cols-3 gap-3 sm:grid-cols-4"><USkeleton v-for="n in 8" :key="n" class="aspect-square w-full" /></div>

    <button
      v-else-if="!assets.length"
      type="button"
      class="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center transition-colors"
      :class="over ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/50'"
      @click="input?.click()"
    >
      <UIcon name="i-lucide-images" class="size-6 text-dimmed" />
      <span class="text-[13px] font-medium text-highlighted">{{ $t('projectTools.pages.noFiles') }}</span>
      <span class="text-xs text-muted">{{ $t('projectTools.pages.noFilesHint') }}</span>
    </button>

    <ul v-else class="grid grid-cols-3 gap-3 sm:grid-cols-4" :class="pick ? 'lg:grid-cols-5' : 'lg:grid-cols-6'">
      <li v-for="a in shown" :key="a.id" class="group relative">
        <button
          type="button"
          class="grid aspect-square w-full place-items-center overflow-hidden rounded-lg border bg-muted p-1.5 transition-colors"
          :class="over ? 'border-primary' : 'border-default hover:border-accented'"
          :title="a.name"
          @click="pick ? emit('pick', ref_(a)) : (editing = { ...a })"
        >
          <img v-if="a.mime.startsWith('image/')" :src="a.url" :alt="a.alt" class="max-h-full object-contain" loading="lazy">
          <video v-else-if="a.mime.startsWith('video/')" :src="a.url" muted class="max-h-full" />
          <UIcon v-else name="i-lucide-file-text" class="size-6 text-dimmed" />
        </button>
        <p class="mt-1 truncate text-[11px] text-muted">{{ a.name }}</p>
        <div v-if="!pick" class="absolute end-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <UButton icon="i-lucide-link" size="xs" color="neutral" variant="solid" square :aria-label="$t('projectTools.pages.copyUrl')" @click="copyUrl(a)" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="solid" square :aria-label="$t('projectTools.pages.delete')" @click="remove(a)" />
        </div>
      </li>
    </ul>

    <UModal :open="!!editing" :title="$t('projectTools.pages.editFile')" @update:open="!$event && (editing = null)">
      <template #body>
        <form v-if="editing" class="space-y-4" @submit.prevent="saveEdit">
          <img v-if="editing.mime.startsWith('image/')" :src="editing.url" :alt="editing.alt" class="mx-auto max-h-48 rounded-lg border border-default object-contain">
          <UFormField :label="$t('projectTools.pages.fileName')">
            <UInput v-model="editing.name" :maxlength="CMS_LIMITS.assetName" class="w-full" />
          </UFormField>
          <UFormField :label="$t('projectTools.pages.alt')" :help="$t('projectTools.pages.altHelp')">
            <UInput v-model="editing.alt" :maxlength="CMS_LIMITS.alt" class="w-full" />
          </UFormField>
          <p class="font-mono text-[11px] text-dimmed">{{ editing.mime }} · {{ formatBytes(editing.size) }}<template v-if="editing.width"> · {{ editing.width }} × {{ editing.height }}</template></p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="editing = null" />
            <UButton type="submit" :label="$t('projectTools.shared.save')" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
