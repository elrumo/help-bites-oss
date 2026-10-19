<template>
  <div class="sb-markdown text-sm text-stone-700 dark:text-stone-300" v-html="html" />
</template>

<script setup lang="ts">
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// FAQ answers are canonical Markdown. We render on the client and sanitize the
// result, so uploaded content can never inject scripts or unsafe HTML.
// `html` is HTML a server already rendered and sanitised (a changelog entry written as HTML); it is cleaned again here.
// End users write some of this (feedback posts and comments), and marked passes
// raw HTML through, so DOMPurify's defaults are not enough: a <form>, a <style>
// or a `fixed inset-0` class would let them lay a fake sign-in over the panel.
// Only what Markdown itself produces survives (the server's changelog allowlist).
const PURIFY = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
    'strong', 'em', 'b', 'i', 'del', 's', 'mark', 'sup', 'sub',
    'code', 'pre', 'kbd', 'ul', 'ol', 'li', 'blockquote',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'loading', 'colspan', 'rowspan']
}

const props = defineProps<{ text?: string, html?: string }>()
const html = ref('')

function render() {
  if (!import.meta.client) { html.value = ''; return }
  const raw = props.html ?? marked.parse(props.text || '', { async: false, breaks: true }) as string
  html.value = DOMPurify.sanitize(raw, PURIFY)
}

watch(() => [props.text, props.html], render, { immediate: true })
onMounted(render)
</script>

<style scoped>
@reference "~/assets/css/main.css";
.sb-markdown :where(h1, h2, h3, h4) { @apply font-semibold text-stone-900 dark:text-stone-100 mt-3 mb-1; }
.sb-markdown :where(p) { @apply my-2; }
.sb-markdown :where(ul) { @apply list-disc pl-5 my-2; }
.sb-markdown :where(ol) { @apply list-decimal pl-5 my-2; }
.sb-markdown :where(a) { @apply text-primary-600 dark:text-primary-400 underline; }
.sb-markdown :where(code) { @apply font-mono text-[0.85em] bg-stone-200/70 dark:bg-stone-800 px-1 py-0.5 rounded; }
.sb-markdown :where(pre) { @apply bg-stone-200/70 dark:bg-stone-800 p-3 rounded-lg overflow-x-auto my-2; }
.sb-markdown :where(pre code) { @apply bg-transparent p-0; }
.sb-markdown :where(blockquote) { @apply border-l-2 border-stone-300 dark:border-stone-700 pl-3 text-stone-500; }
.sb-markdown :where(table) { @apply border-collapse my-2; }
.sb-markdown :where(th, td) { @apply border border-stone-200 dark:border-stone-800 px-2 py-1 text-left; }
</style>
