<script setup lang="ts">
/**
 * One field of a block, by its type. `blocks` fields are edited in Layers, so
 * they show here only as a count with an add menu (from the inspector).
 */
import { normalizeAsset, type CmsAssetRef, type CmsField } from '#shared/cms/content'
import { CMS_ICON_NAMES } from '#shared/cms/icons'
import EmailColorField from '~/components/email/EmailColorField.vue'

const props = defineProps<{ field: CmsField, modelValue: unknown, projectId: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>()

const value = computed(() => props.modelValue === undefined ? props.field.default : props.modelValue)
const text = computed(() => typeof value.value === 'string' || typeof value.value === 'number' ? String(value.value) : '')
const asset = computed<CmsAssetRef | null>(() => normalizeAsset(value.value))
const picking = ref(false)

const set = (v: unknown) => emit('update:modelValue', v)
const icons = computed(() => (props.field.options?.length ? props.field.options : CMS_ICON_NAMES).map(name => ({ label: name, value: name, icon: `i-lucide-${name}` })))
</script>

<template>
  <UFormField :label="field.label" :hint="field.required ? $t('projectTools.pages.required') : undefined" :help="field.description">
    <UInput v-if="field.type === 'text'" :model-value="text" class="w-full" @update:model-value="set" />
    <UTextarea v-else-if="field.type === 'textarea'" :model-value="text" autoresize :rows="2" :maxrows="10" class="w-full" @update:model-value="set" />
    <div v-else-if="field.type === 'markdown'">
      <UTextarea :model-value="text" autoresize :rows="3" :maxrows="14" class="w-full font-mono text-[12.5px]" @update:model-value="set" />
      <p class="mt-1 text-[11px] text-dimmed">{{ $t('projectTools.pages.markdownHint') }}</p>
    </div>
    <UInputNumber v-else-if="field.type === 'number'" :model-value="typeof value === 'number' ? value : undefined" class="w-full" @update:model-value="set" />
    <USwitch v-else-if="field.type === 'boolean'" :model-value="value === true" @update:model-value="set" />
    <EmailColorField v-else-if="field.type === 'color'" :model-value="text || undefined" clearable @update:model-value="set($event ?? '')" />
    <UInput v-else-if="field.type === 'url'" :model-value="text" placeholder="https://" class="w-full font-mono" @update:model-value="set" />
    <UInput v-else-if="field.type === 'date'" type="date" :model-value="text.slice(0, 10)" class="w-full" @update:model-value="set" />
    <USelect v-else-if="field.type === 'select'" :model-value="text" :items="field.options || []" class="w-full" @update:model-value="set" />
    <USelectMenu v-else-if="field.type === 'icon'" :model-value="text || undefined" :items="icons" value-key="value" :icon="text ? `i-lucide-${text}` : undefined" :placeholder="$t('projectTools.pages.noIcon')" class="w-full" @update:model-value="set($event ?? '')" />
    <div v-else-if="field.type === 'asset'" class="space-y-2">
      <div class="flex items-center gap-3">
        <button type="button" class="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-default bg-muted hover:border-accented" :aria-label="$t('projectTools.pages.chooseFile')" @click="picking = true">
          <img v-if="asset?.mime.startsWith('image/') || (asset && !asset.mime)" :src="asset.url" alt="" class="size-full object-contain">
          <UIcon v-else-if="asset" :name="asset.mime.startsWith('video/') ? 'i-lucide-film' : 'i-lucide-file'" class="size-5 text-dimmed" />
          <UIcon v-else name="i-lucide-image-plus" class="size-5 text-dimmed" />
        </button>
        <div class="flex flex-wrap gap-1.5">
          <UButton :label="asset ? $t('projectTools.pages.replace') : $t('projectTools.pages.chooseFile')" size="xs" color="neutral" variant="soft" @click="picking = true" />
          <UButton v-if="asset" icon="i-lucide-x" :label="$t('projectTools.pages.remove')" size="xs" color="neutral" variant="ghost" @click="set(null)" />
        </div>
      </div>
      <UInput v-if="asset" :model-value="asset.alt" :placeholder="$t('projectTools.pages.altPlaceholder')" size="sm" class="w-full" :aria-label="$t('projectTools.pages.alt')" @update:model-value="set({ ...asset, alt: String($event) })" />
      <CmsAssetPicker v-model:open="picking" :project-id="projectId" @pick="set($event); picking = false" />
    </div>
  </UFormField>
</template>
