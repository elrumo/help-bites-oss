<script setup lang="ts">
/** Pick a file for an asset field: the project's Pages files (upload here too) or the brand kit. */
import type { CmsAssetRef } from '#shared/cms/content'

const props = defineProps<{ projectId: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'pick', asset: CmsAssetRef): void }>()

const { api } = useAgent()
const tab = ref<'files' | 'brand'>('files')
const kit = ref<{ id: string, name: string, url: string, mime: string, width?: number, height?: number }[] | null>(null)

watch(tab, async (value) => {
  if (value !== 'brand' || kit.value) return
  try {
    kit.value = (await api<{ assets: NonNullable<typeof kit.value> }>('/admin/brand', { query: { project: props.projectId } })).assets.filter(a => a.mime.startsWith('image/'))
  } catch {
    kit.value = []
  }
})
</script>

<template>
  <UModal v-model:open="open" :title="$t('projectTools.pages.chooseFile')" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <UTabs v-model="tab" :items="[{ label: $t('projectTools.pages.tabs.assets'), value: 'files', icon: 'i-lucide-images' }, { label: $t('projectTools.pages.brandKit'), value: 'brand', icon: 'i-lucide-swatch-book' }]" :content="false" color="neutral" size="xs" class="mb-4" />
      <CmsAssets v-if="tab === 'files'" :project-id="projectId" pick @pick="emit('pick', $event)" />
      <div v-else>
        <USkeleton v-if="!kit" class="h-32 w-full" />
        <p v-else-if="!kit.length" class="py-8 text-center text-[13px] text-muted">{{ $t('projectTools.pages.brandKitEmpty') }}</p>
        <ul v-else class="grid grid-cols-3 gap-3 sm:grid-cols-5">
          <li v-for="a in kit" :key="a.id">
            <button type="button" class="grid aspect-square w-full place-items-center overflow-hidden rounded-lg border border-default bg-muted p-1.5 hover:border-accented" :title="a.name" @click="emit('pick', { id: a.id, url: a.url, alt: a.name, mime: a.mime, ...(a.width ? { width: a.width, height: a.height } : {}) })">
              <img :src="a.url" :alt="a.name" class="max-h-full object-contain">
            </button>
            <p class="mt-1 truncate text-[11px] text-muted">{{ a.name }}</p>
          </li>
        </ul>
      </div>
    </template>
  </UModal>
</template>
