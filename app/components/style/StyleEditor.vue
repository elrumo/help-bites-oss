<template>
  <div class="space-y-5 text-[13px]">
    <div class="grid gap-3 sm:grid-cols-3">
      <UFormField :label="$t('style.scheme')">
        <USelect v-model="schemeModel" :items="schemeItems" class="w-full" />
      </UFormField>
      <UFormField :label="$t('style.shadow')">
        <USelect v-model="shadowModel" :items="shadowItems" class="w-full" />
      </UFormField>
      <UFormField :label="$t('style.font')">
        <USelect v-model="fontModel" :items="fontItems" class="w-full" />
      </UFormField>
    </div>

    <UFormField :label="$t('style.radius')" :hint="style.radius === null ? $t(layered ? 'style.inherited' : 'style.fromKit', { value: `${inherited.radius}px` }) : `${style.radius}px`">
      <div class="flex items-center gap-2">
        <input v-model.number="radiusValue" type="range" min="0" :max="STYLE_RADIUS_MAX" step="1" class="w-full accent-primary-600" :aria-label="$t('style.radius')">
        <UButton v-if="style.radius !== null" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('style.reset')" @click="style.radius = null" />
      </div>
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <section v-for="mode in MODES" :key="mode" class="space-y-2 rounded-xl border border-default p-3">
        <h4 class="flex items-center gap-1.5 text-xs font-semibold text-highlighted">
          <UIcon :name="mode === 'light' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-3.5" />{{ $t(`style.${mode}`) }}
        </h4>
        <div v-for="key in STYLE_PALETTE_KEYS" :key="key" class="flex items-center gap-2">
          <input type="color" :value="style[mode][key] || inherited[mode][key]" class="size-7 shrink-0 cursor-pointer rounded border border-default bg-transparent" :aria-label="`${$t(`style.${mode}`)}: ${$t(`style.colors.${key}`)}`" @input="style[mode][key] = ($event.target as HTMLInputElement).value">
          <span class="w-20 shrink-0 text-xs text-muted">{{ $t(`style.colors.${key}`) }}</span>
          <UInput v-model="style[mode][key]" :placeholder="inherited[mode][key]" size="sm" class="min-w-0 flex-1 font-mono" :color="validHex(style[mode][key]) ? undefined : 'error'" />
          <UButton v-if="style[mode][key]" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('style.reset')" @click="style[mode][key] = ''" />
        </div>
      </section>
    </div>

    <div class="space-y-2">
      <UFormField v-for="key in LOGO_KEYS" :key="key" :label="$t(`style.${key}`)" :description="$t(`style.${key}Hint`)">
        <div class="flex items-center gap-2">
          <img v-if="style[key] || inherited[key]" :src="style[key] || inherited[key]" alt="" class="size-8 shrink-0 rounded-md border border-default bg-elevated object-contain p-0.5">
          <UInput v-model="style[key]" :placeholder="inherited[key] || 'https://…'" class="min-w-0 flex-1" />
        </div>
      </UFormField>
    </div>

    <!-- The result, in both schemes, so the dark side is never a surprise. -->
    <StylePreview :style="resolved" />
  </div>
</template>

<script setup lang="ts">
import { resolveStyle, DEFAULT_PROJECT_STYLE, STYLE_FONTS, STYLE_PALETTE_KEYS, STYLE_RADIUS_MAX, STYLE_SCHEMES, STYLE_SHADOWS, type ProjectStyle, type StyleBase } from '#shared/projectStyle'

// Edits one style layer (`ProjectStyle`): the project's own, or a feature's
// choices over it. Whatever a field leaves empty shows, as its placeholder, the
// value that layer would inherit from `under` (the layers below) and `kit`.
const style = defineModel<ProjectStyle>({ required: true })
const props = defineProps<{
  /** What the Brand kit alone gives (`look.kit`). */
  kit: StyleBase
  /** The layers this one sits on, lowest first: nothing for the project's style, its style for a feature's. */
  under?: ProjectStyle[]
  /** What an empty scheme means here: "Follow the visitor" for the project, "Same as the project" for a feature. */
  emptyScheme?: string
}>()
const { t } = useI18n()

const MODES = ['light', 'dark'] as const
const LOGO_KEYS = ['logoUrl', 'logoDarkUrl', 'iconUrl'] as const

const inherited = computed(() => resolveStyle(props.kit, ...(props.under?.length ? props.under : [DEFAULT_PROJECT_STYLE])))
const resolved = computed(() => resolveStyle(props.kit, ...(props.under || []), style.value))

// A feature's style sits on the project's; the project's own sits on the Brand kit.
const layered = computed(() => Boolean(props.under?.length))
const inheritLabel = computed(() => props.emptyScheme || t('style.inheritProject'))
// The project's own style has no layer below it, so an empty scheme already means "auto".
const schemeItems = computed(() => [{ value: INHERIT, label: inheritLabel.value }, ...STYLE_SCHEMES.filter(value => layered.value || value !== 'auto').map(value => ({ value, label: t(`style.schemes.${value}`) }))])
const shadowItems = computed(() => [{ value: INHERIT, label: t(layered.value ? 'style.inheritShadow' : 'style.defaultShadow', { value: t(`style.shadows.${inherited.value.shadow}`) }) }, ...STYLE_SHADOWS.map(value => ({ value, label: t(`style.shadows.${value}`) }))])
const fontItems = computed(() => [{ value: INHERIT, label: t(layered.value ? 'style.inheritFont' : 'style.kitFont') }, ...STYLE_FONTS.map(value => ({ value, label: t(`style.fonts.${value}`) }))])

// A select cannot hold '' (it means "no selection"), so "not set here" travels as INHERIT.
const INHERIT = 'inherit'
const inheritModel = <K extends 'scheme' | 'shadow' | 'font'>(key: K) => computed({
  get: () => style.value[key] || INHERIT,
  set: (value: string) => { (style.value as Record<K, string>)[key] = value === INHERIT ? '' : value }
})
const schemeModel = inheritModel('scheme')
const shadowModel = inheritModel('shadow')
const fontModel = inheritModel('font')

const radiusValue = computed({
  get: () => style.value.radius ?? inherited.value.radius,
  set: (value: number) => { style.value.radius = value }
})
const validHex = (value: string) => !value || /^#[0-9a-f]{6}$/i.test(value)
</script>
