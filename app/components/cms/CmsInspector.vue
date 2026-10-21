<script setup lang="ts">
/**
 * The right pane. With a block selected: its fields, its animation, and the
 * moves (up, down, duplicate, delete, select its parent). With the page (or
 * nothing) selected: the entry's name and slug, the root's own fields (title,
 * description, link preview image) and the page style.
 */
import {
  CMS_ANIM_EASINGS, CMS_ANIM_EFFECTS, CMS_ANIM_TRIGGERS, CMS_SLUG, CMS_WIDTHS, DEFAULT_ANIMATION, duplicateBlock, findBlock, moveBlock, removeBlock, updateBlock,
  type CmsAnimation, type CmsBlock, type CmsLibrary, type CmsStyle
} from '#shared/cms/content'
import { BRAND_RADII, BRAND_THEMES } from '#shared/brand'
import EmailColorField from '~/components/email/EmailColorField.vue'

const props = defineProps<{
  content: CmsBlock
  library: CmsLibrary
  selectedId?: string | null
  pageStyle: CmsStyle
  name: string
  slug: string
  projectId: string
  projectAccent: string
  pagePath: string
}>()
const emit = defineEmits<{
  (e: 'update:content', value: CmsBlock): void
  (e: 'update:pageStyle', value: CmsStyle): void
  (e: 'update:name', value: string): void
  (e: 'update:slug', value: string): void
  (e: 'select', id: string | null): void
}>()

const { t } = useI18n()
const at = computed(() => props.selectedId ? findBlock(props.content, props.selectedId, props.library) : null)
const block = computed(() => at.value?.block ?? props.content)
const def = computed(() => props.library.get(block.value.component))
const isRoot = computed(() => !at.value?.parent)
const ownFields = computed(() => (def.value?.fields || []).filter(f => f.type !== 'blocks'))
const childCounts = computed(() => (def.value?.fields || []).filter(f => f.type === 'blocks').map(f => ({ label: f.label, n: Array.isArray(block.value[f.key]) ? (block.value[f.key] as unknown[]).length : 0 })))
const siblings = computed(() => at.value?.parent ? (at.value.parent[at.value.field] as CmsBlock[]).length : 0)

function setValue(key: string, value: unknown) {
  const res = updateBlock(props.content, props.library, block.value._uid, { [key]: value })
  if (res.ok) emit('update:content', res.content)
}

function nudge(by: number) {
  const a = at.value
  if (!a?.parent) return
  const res = moveBlock(props.content, props.library, a.block._uid, a.parent._uid, a.field, a.index + by + (by > 0 ? 1 : 0))
  if (res.ok) emit('update:content', res.content)
}

function duplicate() {
  const res = duplicateBlock(props.content, props.library, block.value._uid)
  if (!res.ok) return
  emit('update:content', res.content)
  const copy = findBlock(res.content, block.value._uid, props.library)
  const list = copy?.parent?.[copy.field] as CmsBlock[] | undefined
  if (copy && list) emit('select', list[copy.index + 1]!._uid)
}

function remove() {
  const res = removeBlock(props.content, props.library, block.value._uid)
  if (!res.ok) return
  emit('update:content', res.content)
  emit('select', null)
}

// ---- animation -------------------------------------------------------------------
const anim = computed(() => block.value._anim as CmsAnimation | undefined)
function setAnim(patch: Partial<CmsAnimation> | null) {
  setValue('_anim', patch === null ? null : { ...DEFAULT_ANIMATION, ...anim.value, ...patch })
}
const effectItems = computed(() => [{ label: t('projectTools.pages.anim.none'), value: 'none' }, ...CMS_ANIM_EFFECTS.map(e => ({ label: t(`projectTools.pages.anim.effects.${e}`), value: e }))])
const triggerItems = computed(() => CMS_ANIM_TRIGGERS.map(v => ({ label: t(`projectTools.pages.anim.triggers.${v}`), value: v })))
const easingItems = computed(() => CMS_ANIM_EASINGS.map(v => ({ label: t(`projectTools.pages.anim.easings.${v}`), value: v })))

// ---- page --------------------------------------------------------------------
const slugDraft = ref(props.slug)
watch(() => props.slug, v => (slugDraft.value = v))
const slugOk = computed(() => CMS_SLUG.test(slugDraft.value))
function commitSlug() {
  if (slugOk.value && slugDraft.value !== props.slug) emit('update:slug', slugDraft.value)
  else slugDraft.value = props.slug
}
const setStyle = (patch: Partial<CmsStyle>) => emit('update:pageStyle', { ...props.pageStyle, ...patch })
const FONTS = ['Inter', 'Geist', 'DM Sans', 'Manrope', 'Plus Jakarta Sans', 'Space Grotesk', 'Outfit', 'Sora', 'IBM Plex Sans', 'Fraunces', 'Playfair Display', 'Instrument Serif', 'JetBrains Mono']
</script>

<template>
  <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
    <template v-if="!isRoot && def">
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-highlighted">{{ def.name }}</p>
          <p class="truncate font-mono text-[11px] text-dimmed">{{ def.key }} · {{ block._uid }}</p>
        </div>
        <UButton icon="i-lucide-corner-left-up" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pages.selectParent')" @click="emit('select', at?.parent?._uid === content._uid ? null : at?.parent?._uid ?? null)" />
        <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="!at || at.index === 0" :aria-label="$t('projectTools.pages.moveUp')" @click="nudge(-1)" />
        <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="!at || at.index >= siblings - 1" :aria-label="$t('projectTools.pages.moveDown')" @click="nudge(1)" />
        <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pages.duplicate')" @click="duplicate" />
        <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pages.delete')" @click="remove" />
      </div>
      <p v-if="def.description" class="-mt-3 text-xs text-muted">{{ def.description }}</p>

      <CmsFieldInput v-for="f in ownFields" :key="`${block._uid}-${f.key}`" :field="f" :model-value="block[f.key]" :project-id="projectId" @update:model-value="setValue(f.key, $event)" />
      <p v-for="c in childCounts" :key="c.label" class="text-xs text-muted">
        <UIcon name="i-lucide-layers" class="me-1 inline size-3.5 align-[-2px]" />{{ $t('projectTools.pages.childCount', { field: c.label, n: c.n }) }}
      </p>

      <section class="space-y-3 border-t border-default pt-4">
        <h3 class="text-xs font-semibold text-highlighted">{{ $t('projectTools.pages.anim.title') }}</h3>
        <UFormField :label="$t('projectTools.pages.anim.effect')">
          <USelect :model-value="anim?.effect || 'none'" :items="effectItems" class="w-full" @update:model-value="$event === 'none' ? setAnim(null) : setAnim({ effect: $event as CmsAnimation['effect'] })" />
        </UFormField>
        <template v-if="anim">
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="$t('projectTools.pages.anim.trigger')">
              <USelect :model-value="anim.trigger" :items="triggerItems" :disabled="anim.effect === 'parallax'" class="w-full" @update:model-value="setAnim({ trigger: $event as CmsAnimation['trigger'] })" />
            </UFormField>
            <UFormField :label="$t('projectTools.pages.anim.easing')">
              <USelect :model-value="anim.easing" :items="easingItems" class="w-full" @update:model-value="setAnim({ easing: $event as CmsAnimation['easing'] })" />
            </UFormField>
            <UFormField :label="$t('projectTools.pages.anim.duration')">
              <UInputNumber :model-value="anim.duration" :min="100" :max="4000" :step="50" class="w-full" @update:model-value="setAnim({ duration: Number($event) })" />
            </UFormField>
            <UFormField :label="$t('projectTools.pages.anim.delay')">
              <UInputNumber :model-value="anim.delay" :min="0" :max="4000" :step="50" class="w-full" @update:model-value="setAnim({ delay: Number($event) })" />
            </UFormField>
            <UFormField :label="$t('projectTools.pages.anim.distance')">
              <UInputNumber :model-value="anim.distance" :min="0" :max="400" :step="4" class="w-full" @update:model-value="setAnim({ distance: Number($event) })" />
            </UFormField>
            <UFormField :label="$t('projectTools.pages.anim.stagger')" :help="$t('projectTools.pages.anim.staggerHelp')">
              <UInputNumber :model-value="anim.stagger" :min="0" :max="1000" :step="20" class="w-full" @update:model-value="setAnim({ stagger: Number($event) })" />
            </UFormField>
          </div>
          <USwitch v-if="anim.trigger === 'in-view'" :model-value="anim.once" :label="$t('projectTools.pages.anim.once')" @update:model-value="setAnim({ once: $event })" />
        </template>
      </section>
    </template>

    <template v-else>
      <div>
        <p class="text-sm font-semibold text-highlighted">{{ def?.name || $t('projectTools.pages.page') }}</p>
        <p class="text-xs text-muted">{{ $t('projectTools.pages.pageHint') }}</p>
      </div>
      <UFormField :label="$t('projectTools.pages.name')">
        <UInput :model-value="name" class="w-full" @update:model-value="emit('update:name', String($event))" />
      </UFormField>
      <UFormField :label="$t('projectTools.pages.slug')" :error="slugOk ? undefined : $t('projectTools.pages.slugHint')" :help="slugOk ? pagePath : undefined">
        <UInput v-model="slugDraft" class="w-full font-mono" @blur="commitSlug" @keydown.enter="commitSlug" />
      </UFormField>
      <CmsFieldInput v-for="f in ownFields" :key="f.key" :field="f" :model-value="content[f.key]" :project-id="projectId" @update:model-value="setValue(f.key, $event)" />

      <section class="space-y-3 border-t border-default pt-4">
        <h3 class="text-xs font-semibold text-highlighted">{{ $t('projectTools.pages.style') }}</h3>
        <UFormField :label="$t('projectTools.pages.accent')" :help="pageStyle.accent ? undefined : $t('projectTools.pages.accentHelp')">
          <EmailColorField :model-value="pageStyle.accent || undefined" :placeholder="projectAccent || '#4f46e5'" clearable @update:model-value="setStyle({ accent: $event ?? '' })" />
        </UFormField>
        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="$t('projectTools.pages.mode')">
            <USelect :model-value="pageStyle.mode" :items="BRAND_THEMES.map(v => ({ label: $t(`projectTools.pages.modes.${v}`), value: v }))" class="w-full" @update:model-value="setStyle({ mode: $event as CmsStyle['mode'] })" />
          </UFormField>
          <UFormField :label="$t('projectTools.pages.radius')">
            <USelect :model-value="pageStyle.radius" :items="BRAND_RADII.map(v => ({ label: $t(`projectTools.pages.radii.${v}`), value: v }))" class="w-full" @update:model-value="setStyle({ radius: $event as CmsStyle['radius'] })" />
          </UFormField>
          <UFormField :label="$t('projectTools.pages.width')">
            <USelect :model-value="pageStyle.width" :items="CMS_WIDTHS.map(v => ({ label: $t(`projectTools.pages.widths.${v}`), value: v }))" class="w-full" @update:model-value="setStyle({ width: $event as CmsStyle['width'] })" />
          </UFormField>
        </div>
        <UFormField :label="$t('projectTools.pages.headingFont')" :help="$t('projectTools.pages.fontHelp')">
          <UInputMenu :model-value="pageStyle.headingFont" :items="FONTS" create-item :placeholder="$t('projectTools.pages.systemFont')" class="w-full" @update:model-value="setStyle({ headingFont: String($event || '') })" @create="setStyle({ headingFont: String($event) })" />
        </UFormField>
        <UFormField :label="$t('projectTools.pages.bodyFont')">
          <UInputMenu :model-value="pageStyle.bodyFont" :items="FONTS" create-item :placeholder="$t('projectTools.pages.systemFont')" class="w-full" @update:model-value="setStyle({ bodyFont: String($event || '') })" @create="setStyle({ bodyFont: String($event) })" />
        </UFormField>
      </section>
    </template>
  </div>
</template>
