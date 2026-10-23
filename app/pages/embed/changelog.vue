<template>
  <div ref="rootRef" class="sb-board" :class="inline ? 'min-h-[200px]' : 'min-h-full'" :style="rootStyle">
    <header v-if="showHeader" :style="{ borderBottom: '1px solid var(--hb-border)' }" :class="inline ? '' : 'backdrop-blur-xl'">
      <div class="mx-auto flex max-w-3xl items-start gap-3 px-4 py-4">
        <img v-if="logoUrl" :src="logoUrl" alt="" class="size-9 shrink-0 object-contain" :style="{ borderRadius: 'var(--hb-radius)' }">
        <span v-else class="grid size-9 shrink-0 place-items-center text-sm font-semibold" :style="{ borderRadius: 'var(--hb-radius)', background: 'var(--hb-accent)', color: 'var(--hb-accent-text)' }" aria-hidden="true">{{ initials }}</span>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-[17px] font-semibold leading-tight">{{ title }}</h1>
          <p class="line-clamp-2 text-[13px]" style="color: var(--hb-muted)">{{ $t('embed.changelog.description') }}</p>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-4 py-4">
      <p v-if="error" class="py-12 text-center text-sm" style="color: var(--hb-muted)">{{ error }}</p>
      <div v-else-if="loading" class="py-12 text-center text-sm" style="color: var(--hb-muted)">{{ $t('embed.loading') }}</div>
      <EmptyState v-else-if="!items.length" icon="i-lucide-sparkles" :title="$t('embed.changelog.empty')" :description="$t('embed.changelog.emptyDescription')" />
      <ol v-else class="relative space-y-4 pl-5" :style="{ borderLeft: '1px solid var(--hb-border)' }">
        <li v-for="item in items" :key="item.kind === 'release' ? `r-${item.release.id}` : `e-${item.entry.id}`" class="relative p-4" :style="cardStyle">
          <span class="absolute -left-[27px] top-5 grid size-3.5 place-items-center rounded-full" :style="{ background: 'var(--hb-accent)', boxShadow: '0 0 0 4px var(--hb-bg)' }" aria-hidden="true" />
          <template v-if="item.kind === 'release'">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 :id="`release-${item.release.version}`" class="scroll-mt-4 text-base font-semibold leading-snug">{{ item.release.version }}<template v-if="item.release.title"> · {{ item.release.title }}</template></h2>
              <time v-if="item.date" class="text-xs" style="color: var(--hb-muted)" :datetime="item.date">{{ shortDate(item.date) }}</time>
            </div>
            <MarkdownBlock v-if="item.release.summary" :text="item.release.summary" class="mt-1" />
            <div class="mt-3 space-y-4">
              <FeedbackChangelogEntryItem v-for="entry in item.release.entries" :key="entry.id" :entry="entry" />
            </div>
          </template>
          <FeedbackChangelogEntryItem v-else :entry="item.entry" show-date />
        </li>
      </ol>
    </main>

    <p v-if="projectInfo?.poweredBy" class="py-3 text-center text-[11px] leading-tight">
      <a :href="projectInfo.poweredBy.url" target="_blank" rel="noopener" class="transition-opacity hover:opacity-80" style="color: var(--hb-muted)">{{ $t('embed.poweredBy') }}</a>
    </p>
  </div>
</template>

<script setup lang="ts">
import { changelogTimeline, type PublicChangelog } from '#shared/changelog'

// The plug-and-play changelog (see public/changelog.js), also the page at
// /changelog/<public key>. Read-only and independent of the feedback board: it
// needs only the project's public key and its public changelog switched on.
// Your own UI can read the same data from GET /v1/changelog.
//
// It wears the changelog's style (the project's, with the changelog's own
// choices over it; `style` in GET /v1/changelog), in light or dark. The URL can
// override a few things for one embed: ?theme, ?accent=%23rrggbb, ?radius=0-32
// and ?shadow=none|soft|medium|strong.

definePageMeta({ layout: 'bare' })

const route = useRoute()
// ?header=0 (data-header="false") leaves out the logo, title and description, for a page that already shows them.
const showHeader = computed(() => !['0', 'false', 'off'].includes(String(route.query.header || '').toLowerCase()))
const pk = String(route.query.pk || '')
const inline = route.query.inline === '1'
const inFrame = import.meta.client && window.parent !== window

const colorMode = useColorMode()
const themeParam = String(route.query.theme || '')
if (['light', 'dark', 'system'].includes(themeParam)) colorMode.preference = themeParam

type ProjectInfo = { name: string, theme: { accent?: string }, brandLogoUrl: string, poweredBy?: { url: string } | null }

const { t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const projectInfo = ref<ProjectInfo | null>(null)
const changelog = ref<PublicChangelog>({ releases: [], entries: [] })
const loading = ref(true)
const error = ref('')

const items = computed(() => changelogTimeline(changelog.value))
const title = computed(() => (projectInfo.value?.name ? t('embed.changelog.namedTitle', { name: projectInfo.value.name }) : t('embed.changelog.title')))
const style = computed(() => embedStyle(changelog.value.style, route.query))
const mode = computed<'light' | 'dark'>(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
const logoUrl = computed(() => (mode.value === 'dark' ? style.value.logoDarkUrl : style.value.logoUrl) || style.value.iconUrl || projectInfo.value?.brandLogoUrl || '')
const rootStyle = computed(() => styleRootStyle(style.value, mode.value))
const cardStyle = { background: 'var(--hb-surface)', border: '1px solid var(--hb-border)', borderRadius: 'var(--hb-radius)', boxShadow: 'var(--hb-shadow)' }

// A style that fixes the scheme applies it, unless the embed's own ?theme asked for one.
watch(() => style.value.scheme, (scheme) => {
  if (!themeParam && scheme !== 'auto') colorMode.preference = scheme
}, { immediate: true })

const initials = computed(() => (projectInfo.value?.name || 'C').trim().slice(0, 1).toUpperCase())

// Nuxt UI's theme is `inline`: derive the shades from the project accent.
useHead({ title, htmlAttrs: { style: computed(() => accentStyle(style.value[mode.value].accent)) } })

let resizeObserver: ResizeObserver | null = null
let lastHeight = 0
function reportHeight() {
  const height = Math.ceil(rootRef.value?.getBoundingClientRect().height || 0)
  if (inFrame && height && Math.abs(height - lastHeight) > 1) {
    lastHeight = height
    window.parent.postMessage({ source: 'help-bites-changelog', type: 'resize', height }, '*')
  }
}

onMounted(async () => {
  if (inline) {
    // The frame is sized to us, so the document must not stretch to the frame.
    document.documentElement.style.height = 'auto'
    document.body.style.height = 'auto'
    const nuxtRoot = document.getElementById('__nuxt')
    if (nuxtRoot) nuxtRoot.style.height = 'auto'
    resizeObserver = new ResizeObserver(reportHeight)
    if (rootRef.value) resizeObserver.observe(rootRef.value)
  }
  if (!pk) {
    error.value = t('embed.changelog.missingKey')
    loading.value = false
    return
  }
  try {
    const [info, list] = await Promise.all([
      $fetch<ProjectInfo>(`/v1/projects/${encodeURIComponent(pk)}/public`),
      $fetch<PublicChangelog>('/v1/changelog', { query: { pk } })
    ])
    projectInfo.value = info
    changelog.value = list
    await nextTick()
    // An RSS item links to #entry-<number>; the page only has it now.
    const anchor = decodeURIComponent(location.hash.slice(1))
    if (anchor) document.getElementById(anchor)?.scrollIntoView()
  } catch (e: any) {
    error.value = e?.statusCode === 404 ? t('embed.changelog.none') : t('embed.changelog.loadFailed')
  } finally {
    loading.value = false
    // changelog.js keeps its skeleton (or the server's snapshot) until this.
    await nextTick()
    reportHeight()
    if (inFrame) window.parent.postMessage({ source: 'help-bites-changelog', type: 'ready' }, '*')
  }
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>
