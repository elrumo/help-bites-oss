<template>
  <div v-if="page" class="grid gap-10 py-10 md:py-14 xl:grid-cols-[minmax(0,1fr)_170px]">
    <article class="min-w-0">
      <p class="text-[13px] text-muted">
        <NuxtLink to="/docs" class="transition-colors hover:text-highlighted">{{ $t('docs.home') }}</NuxtLink>
        <span class="mx-1.5 text-dimmed">/</span>{{ doc.group }}
      </p>
      <div class="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <h1 class="text-[clamp(1.9rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em] text-highlighted">{{ doc.title }}</h1>
        <DocsCopyMarkdown :path="markdownPath" class="sm:mt-1.5" />
      </div>

      <div class="docs-prose mt-8" @click="onProseClick" v-html="page.html" />

      <div class="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-5 text-[13px]">
        <a :href="docEditUrl(doc)" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-highlighted">
          <UIcon name="i-lucide-pencil" class="size-3.5" />{{ $t('docs.editOnGithub') }}
        </a>
      </div>

      <nav v-if="previous || next" class="mt-6 grid gap-3 sm:grid-cols-2" :aria-label="$t('docs.moreGuides')">
        <NuxtLink v-if="previous" :to="docPath(previous)" class="pager">
          <span class="text-xs text-muted">{{ $t('docs.previous') }}</span>
          <span class="font-medium text-highlighted">{{ previous.title }}</span>
        </NuxtLink>
        <NuxtLink v-if="next" :to="docPath(next)" class="pager sm:col-start-2 sm:text-right">
          <span class="text-xs text-muted">{{ $t('docs.next') }}</span>
          <span class="font-medium text-highlighted">{{ next.title }}</span>
        </NuxtLink>
      </nav>
    </article>

    <aside v-if="page.headings.length" class="hidden xl:block">
      <nav class="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 text-[13px]" :aria-label="$t('docs.onThisPage')">
        <p class="mb-2 text-xs font-medium text-muted">{{ $t('docs.onThisPage') }}</p>
        <ul class="border-l border-default">
          <li v-for="heading in page.headings" :key="heading.id">
            <a
              :href="`#${heading.id}`"
              class="-ml-px block border-l py-1 leading-snug transition-colors"
              :class="[heading.level === 3 ? 'pl-6' : 'pl-3', active === heading.id ? 'border-primary-500 text-highlighted' : 'border-transparent text-muted hover:text-highlighted']"
            >{{ heading.text }}</a>
          </li>
        </ul>
      </nav>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { DOCS, docBySlug, docEditUrl, docMarkdownPath, docPath } from '#shared/docs'
import type { RenderedDoc } from '~~/server/utils/docsRender'

definePageMeta({ layout: 'docs' })

const route = useRoute()
const { t } = useI18n()
const doc = docBySlug(String(route.params.slug))
// `fatal` makes a client-side navigation show the error page; on the server it
// would also log a stack trace for every address a crawler guesses.
const notFound = () => createError({ statusCode: 404, statusMessage: t('docs.notFound'), fatal: import.meta.client })
if (!doc) throw notFound()

// Prerendered, so a visitor gets finished HTML and the data below arrives in
// the page's payload; the request itself only happens in development.
const { data: page } = await useFetch<RenderedDoc>(`/docs-data/${doc.slug}`, { key: `doc-${doc.slug}` })
if (!page.value) throw notFound()

useSeoMeta({
  title: t('docs.pageTitle', { title: doc.title }),
  description: doc.description,
  ogTitle: t('docs.pageTitle', { title: doc.title }),
  ogDescription: doc.description,
  ogType: 'article'
})

// Points assistants and crawlers at the Markdown of this page.
const markdownPath = docMarkdownPath(doc)
useHead({ link: [{ rel: 'alternate', type: 'text/markdown', href: markdownPath }] })

const at = DOCS.indexOf(doc)
const previous = DOCS[at - 1]
const next = DOCS[at + 1]

/* ------------------------------------------------------- "On this page" */

// The heading nearest the top of the reading area is the one the list marks.
const active = ref('')
let observer: IntersectionObserver | undefined

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) active.value = entry.target.id
  }, { rootMargin: '-72px 0px -70% 0px' })
  document.querySelectorAll('.docs-prose :is(h2, h3)[id]').forEach(heading => observer!.observe(heading))
})
onBeforeUnmount(() => observer?.disconnect())

/* ----------------------------------------------------------- copy button */

// The code blocks come in as HTML, so one listener on the page handles every
// Copy button.
async function onProseClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]')
  const code = button?.parentElement?.querySelector('pre')
  if (!button || !code) return
  try {
    await navigator.clipboard.writeText(code.textContent ?? '')
    button.textContent = t('docs.copied')
    setTimeout(() => { button.textContent = t('docs.copy') }, 1500)
  } catch {
    // No clipboard on a plain-http page: select the code so Ctrl/⌘-C finishes it.
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(code)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
}
</script>

<style scoped>
@reference "~/assets/css/main.css";
.pager { @apply flex flex-col gap-0.5 rounded-xl border border-default p-4 text-[14px] transition-colors hover:border-accented hover:bg-muted; }

/* The guide's HTML is rendered on the server (server/utils/docsRender.ts), so
   its elements carry no classes of ours: style them from here. */
.docs-prose { font-size: 15px; line-height: 1.7; }
.docs-prose > :deep(:first-child) { margin-top: 0; }
.docs-prose :deep(p), .docs-prose :deep(ul), .docs-prose :deep(ol) { @apply my-4; }
.docs-prose :deep(ul) { @apply list-disc pl-6; }
.docs-prose :deep(ol) { @apply list-decimal pl-6; }
.docs-prose :deep(li) { @apply my-1; }
.docs-prose :deep(li > ul), .docs-prose :deep(li > ol) { @apply my-1; }
.docs-prose :deep(strong) { @apply font-semibold text-highlighted; }
.docs-prose :deep(img) { @apply my-5 h-auto max-w-full rounded-lg border border-default; }
.docs-prose :deep(a) { @apply text-primary-600 underline decoration-primary-600/30 underline-offset-2 transition-colors hover:decoration-primary-600 dark:text-primary-400 dark:decoration-primary-400/30 dark:hover:decoration-primary-400; }

.docs-prose :deep(h2), .docs-prose :deep(h3) { @apply scroll-mt-20 font-semibold text-highlighted; }
.docs-prose :deep(h2) { @apply mb-4 mt-12 text-[1.5rem] leading-snug tracking-[-0.025em]; }
.docs-prose :deep(h3) { @apply mb-3 mt-9 text-[1.1rem] leading-snug tracking-[-0.01em]; }
.docs-prose :deep(hr + h2) { @apply mt-10; }
.docs-prose :deep(hr) { @apply mb-0 mt-12 border-0 border-t border-default; }
.docs-prose :deep(.heading-anchor) { @apply ml-2 text-dimmed no-underline opacity-0 transition-opacity hover:text-muted focus-visible:opacity-100; }
.docs-prose :deep(:is(h2, h3):hover .heading-anchor) { @apply opacity-100; }

.docs-prose :deep(code) { @apply rounded border border-default bg-elevated px-1 py-px font-mono text-[0.85em] [overflow-wrap:break-word]; }

.docs-prose :deep(.code-block) { @apply relative my-5; }
.docs-prose :deep(pre) { @apply overflow-x-auto rounded-lg border border-default bg-elevated p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre; }
.docs-prose :deep(pre code) { @apply border-0 bg-transparent p-0 text-[inherit] [overflow-wrap:normal]; }
.docs-prose :deep(.copy-btn) { @apply absolute right-2 top-2 rounded-md border border-default bg-default px-2 py-1 text-xs text-muted opacity-0 transition-opacity hover:text-highlighted focus-visible:opacity-100; }
.docs-prose :deep(.code-block:hover .copy-btn) { @apply opacity-100; }
@media (hover: none) {
  .docs-prose :deep(.copy-btn) { opacity: 1; }
}

.docs-prose :deep(.table-wrap) { @apply my-5 overflow-x-auto rounded-lg border border-default; }
.docs-prose :deep(table) { @apply w-full min-w-[32rem] border-collapse text-[13px] leading-normal; }
.docs-prose :deep(th) { @apply bg-muted px-2.5 py-2 text-left font-semibold text-highlighted; }
.docs-prose :deep(td) { @apply border-t border-default px-2.5 py-2 align-top; }
.docs-prose :deep(td:first-child code) { @apply whitespace-nowrap; }

.docs-prose :deep(blockquote) { @apply my-5 rounded-r-lg border-l-[3px] border-primary-400 bg-muted px-4 py-3 text-toned; }
.docs-prose :deep(blockquote > :first-child) { @apply mt-0; }
.docs-prose :deep(blockquote > :last-child) { @apply mb-0; }

/* "- [ ] item": the checklist at the foot of the self-hosting guide. */
.docs-prose :deep(ul:has(> .task-item)) { @apply list-none pl-0; }
.docs-prose :deep(.task-item) { @apply relative my-2 pl-7; }
.docs-prose :deep(.task-item::before) { content: ''; @apply absolute left-0 top-[0.35rem] size-4 rounded border-[1.5px] border-accented; }
.docs-prose :deep(.task-done::before) { @apply border-primary-500 bg-primary-500; }
</style>
