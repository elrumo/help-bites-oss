<template>
  <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
    <div class="min-w-0 space-y-5">
      <section class="rounded-xl border border-default p-4">
        <USwitch :model-value="savedPublic" :label="$t('projectTools.brand.page.public')" :description="$t('projectTools.brand.page.publicHint')" @update:model-value="emit('togglePublic', $event)" />
        <div v-if="savedPublic" class="mt-3 flex items-center gap-1 rounded-lg bg-elevated px-3 py-1.5">
          <code class="min-w-0 flex-1 truncate font-mono text-xs text-default">{{ publicUrl }}</code>
          <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.brand.page.copyLink')" @click="copy(publicUrl)" />
          <UButton icon="i-lucide-external-link" size="xs" color="neutral" variant="ghost" square :to="publicUrl" target="_blank" :aria-label="$t('projectTools.brand.viewPage')" />
        </div>
      </section>

      <section class="rounded-xl border border-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.page.template') }}</h3>
          <StyleProjectActions :project-id="projectId" :from="styleOffer" />
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" :aria-label="$t('projectTools.brand.page.template')">
          <button
            v-for="template in BRAND_TEMPLATES"
            :key="template"
            type="button"
            role="radio"
            :aria-checked="page.template === template"
            class="rounded-lg border p-2 text-left transition-colors"
            :class="page.template === template ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-accented'"
            @click="page.template = template"
          >
            <!-- A sketch of the layout, in the kit's accent. -->
            <div class="flex aspect-[4/3] overflow-hidden rounded-md bg-muted" :class="template === 'split' ? 'flex-row' : 'flex-col items-stretch p-1.5'" aria-hidden="true">
              <template v-if="template === 'split'">
                <div class="flex w-2/5 flex-col justify-between p-1.5" :style="{ background: accent }"><span class="h-1.5 w-3/4 rounded-full bg-white/70" /><span class="h-1 w-1/2 rounded-full bg-white/50" /></div>
                <div class="flex flex-1 flex-col gap-1 p-1.5"><span class="h-1 w-2/3 rounded-full bg-stone-400/60" /><span class="grid flex-1 grid-cols-3 gap-0.5"><span v-for="n in 3" :key="n" class="rounded-sm bg-stone-400/30" /></span><span class="h-1 w-1/2 rounded-full bg-stone-400/40" /></div>
              </template>
              <template v-else-if="template === 'editorial'">
                <span class="mx-auto mt-0.5 h-2 w-1/2 rounded-full bg-stone-500/70" />
                <span class="mx-auto mt-1 aspect-square w-2/5 rounded-sm" :style="{ background: accent }" />
                <span class="mx-auto mt-1 flex gap-0.5"><span v-for="n in 4" :key="n" class="size-1.5 rounded-full bg-stone-400/60" /></span>
              </template>
              <template v-else>
                <span class="flex items-end justify-between"><span class="h-2 w-1/2 rounded-full bg-stone-500/70" /><span class="h-1 w-1/4 rounded-full bg-stone-400/50" /></span>
                <span class="mt-1 h-2/5 rounded-sm" :style="{ background: accent }" />
                <span class="mt-1 grid flex-1 grid-cols-4 gap-0.5"><span v-for="n in 4" :key="n" class="rounded-sm bg-stone-400/30" /></span>
              </template>
            </div>
            <p class="mt-2 text-[13px] font-medium text-highlighted">{{ $t(`projectTools.brand.templates.${template}.label`) }}</p>
            <p class="text-xs leading-snug text-muted">{{ $t(`projectTools.brand.templates.${template}.description`) }}</p>
          </button>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <UFormField :label="$t('projectTools.brand.page.theme')"><USelect v-model="page.theme" :items="themeItems" class="w-full" /></UFormField>
          <UFormField :label="$t('projectTools.brand.page.radius')"><USelect v-model="page.radius" :items="radiusItems" class="w-full" /></UFormField>
          <UFormField :label="$t('projectTools.brand.page.accent')" :help="page.accent ? undefined : $t('projectTools.brand.page.accentHint')">
            <div class="flex items-center gap-1.5">
              <input type="color" :value="accent" class="h-8 w-9 shrink-0 cursor-pointer rounded border border-default bg-transparent" :aria-label="$t('projectTools.brand.page.accent')" @input="page.accent = ($event.target as HTMLInputElement).value">
              <UInput v-model="page.accent" :placeholder="accent" class="w-full font-mono" />
            </div>
          </UFormField>
        </div>
      </section>

      <section class="space-y-4 rounded-xl border border-default p-4">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.page.words') }}</h3>
        <UFormField :label="$t('projectTools.brand.page.headline')" :hint="$t('projectTools.brand.page.headlineHint')"><UInput v-model="page.headline" :maxlength="BRAND_LIMITS.headline" :placeholder="projectName" class="w-full" /></UFormField>
        <UFormField :label="$t('projectTools.brand.page.intro')" :hint="$t('projectTools.brand.page.introHint')"><UTextarea v-model="page.intro" :maxlength="BRAND_LIMITS.intro" autoresize :rows="2" :placeholder="config.tagline" class="w-full" /></UFormField>
      </section>

      <section class="rounded-xl border border-default p-4">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.page.sections') }}</h3>
        <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.brand.page.sectionsHint') }}</p>
        <ul class="mt-3 divide-y divide-default rounded-lg border border-default">
          <li v-for="(section, i) in orderedSections" :key="section" class="flex items-center gap-2 px-3 py-1.5">
            <UCheckbox :model-value="page.sections.includes(section)" :label="$t(`projectTools.brand.sections.${section}`)" class="flex-1" @update:model-value="toggle(section, !!$event)" />
            <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0 || !page.sections.includes(section)" :aria-label="$t('projectTools.brand.moveUp')" @click="moveSection(section, -1)" />
            <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="!page.sections.includes(section) || page.sections.indexOf(section) === page.sections.length - 1" :aria-label="$t('projectTools.brand.moveDown')" @click="moveSection(section, 1)" />
          </li>
        </ul>
      </section>

      <section class="rounded-xl border border-default p-4">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.page.embed') }}</h3>
        <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.brand.page.embedHint') }}</p>
        <CodeBlock :code="embed" lang="html" class="mt-3" />
        <div class="mt-2 flex flex-wrap gap-2">
          <UButton icon="i-lucide-copy" :label="$t('projectTools.brand.page.copyEmbed')" size="xs" color="neutral" variant="soft" @click="copy(embed)" />
          <UButton icon="i-lucide-book-open" :label="$t('projectTools.brand.page.guide')" size="xs" color="neutral" variant="ghost" to="/docs/brand" target="_blank" />
        </div>
      </section>
    </div>

    <aside class="min-w-0 space-y-3 lg:sticky lg:top-6 lg:self-start">
      <div class="flex items-center gap-1">
        <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.page.preview') }}</h3>
        <UIcon v-if="previewing" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-dimmed" />
        <UButton icon="i-lucide-monitor" size="xs" :color="width === 'desktop' ? 'primary' : 'neutral'" variant="ghost" square :aria-label="$t('projectTools.brand.page.desktop')" @click="width = 'desktop'" />
        <UButton icon="i-lucide-smartphone" size="xs" :color="width === 'mobile' ? 'primary' : 'neutral'" variant="ghost" square :aria-label="$t('projectTools.brand.page.mobile')" @click="width = 'mobile'" />
      </div>
      <div class="overflow-hidden rounded-xl border border-default bg-muted">
        <!-- Rendered at a real width and scaled down, so the preview keeps the page's own breakpoints.
             No allow-scripts, so nothing in it runs; same-origin only because the panel's
             frame-ancestors 'self' would otherwise refuse an opaque-origin frame. -->
        <div ref="frameBox" class="relative mx-auto h-[640px] overflow-hidden" :style="{ width: width === 'mobile' ? '375px' : '100%', maxWidth: '100%' }">
          <iframe :srcdoc="html" sandbox="allow-same-origin":title="$t('projectTools.brand.page.preview')" class="absolute left-0 top-0 origin-top-left border-0 bg-white" :style="{ width: `${frameWidth}px`, height: `${640 / scale}px`, transform: `scale(${scale})` }" />
        </div>
      </div>
      <p v-if="previewError" class="text-xs text-error">{{ previewError }}</p>
      <p v-else class="text-xs text-dimmed">{{ $t('projectTools.brand.page.previewHint') }}</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { styleFrom } from '#shared/projectStyle'
import { BRAND_LIMITS, BRAND_RADII, BRAND_SECTIONS, BRAND_TEMPLATES, BRAND_THEMES, brandAccent, type BrandConfig, type BrandSection } from '#shared/brand'
import { useElementSize, watchDebounced } from '@vueuse/core'

const props = defineProps<{ projectId: string, publicUrl: string, savedPublic: boolean }>()
const emit = defineEmits<{ togglePublic: [value: boolean] }>()
const config = defineModel<BrandConfig>({ required: true })
const { api, projects } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()

const page = computed(() => config.value.page)
const project = computed(() => projects.value.find(p => p.id === props.projectId) || null)
const projectName = computed(() => project.value?.name || '')
const accent = computed(() => config.value.page.accent || project.value?.style.light.accent || brandAccent(config.value, project.value?.theme?.accent || ''))
// What the page can offer the project style: its accent, corners and scheme.
const styleOffer = computed(() => styleFrom({ accent: config.value.page.accent, radius: { sharp: 2, soft: 8, round: 16 }[config.value.page.radius], scheme: config.value.page.theme }))
const themeItems = computed(() => BRAND_THEMES.map(value => ({ value, label: t(`projectTools.brand.themes.${value}`) })))
const radiusItems = computed(() => BRAND_RADII.map(value => ({ value, label: t(`projectTools.brand.radii.${value}`) })))

// Shown sections first, in their order, then the hidden ones.
const orderedSections = computed(() => [...page.value.sections, ...BRAND_SECTIONS.filter(s => !page.value.sections.includes(s))])

function toggle(section: BrandSection, on: boolean) {
  page.value.sections = on ? [...page.value.sections, section] : page.value.sections.filter(s => s !== section)
}

function moveSection(section: BrandSection, by: number) {
  const list = [...page.value.sections]
  const from = list.indexOf(section)
  const to = from + by
  if (from < 0 || to < 0 || to >= list.length) return
  list.splice(from, 1)
  list.splice(to, 0, section)
  page.value.sections = list
}

const embed = computed(() => `<div id="brand"></div>\n<script src="${appUrl.value}/brand.js" data-project="${project.value?.publicKey || 'pk_…'}" data-target="#brand" defer><\/script>`)

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('projectTools.brand.copied'), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {}
}

// ---- preview ----
const html = ref('')
const previewing = ref(false)
const previewError = ref('')
const width = ref<'desktop' | 'mobile'>('desktop')
const frameBox = ref<HTMLElement | null>(null)
const { width: boxWidth } = useElementSize(frameBox)
const frameWidth = computed(() => width.value === 'mobile' ? 375 : 1200)
const scale = computed(() => Math.min(1, (boxWidth.value || frameWidth.value) / frameWidth.value))

async function render() {
  previewing.value = true
  try {
    html.value = (await api<{ html: string }>('/admin/brand/preview', { method: 'POST', query: { project: props.projectId }, body: { brand: config.value } })).html
    previewError.value = ''
  } catch (e: any) {
    // Mid-edit values (a half-typed hex) are refused; the last good preview stays.
    previewError.value = e?.message || ''
  } finally {
    previewing.value = false
  }
}

watchDebounced(config, render, { deep: true, debounce: 400, immediate: true })
</script>
