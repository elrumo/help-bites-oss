<template>
  <pre class="snippet" :class="`shj-lang-${lang}`"><span v-if="html" v-html="html" /><template v-else>{{ code }}</template></pre>
</template>

<script setup lang="ts">
import { highlightText } from '@speed-highlight/core'

// Highlighting is client-side and non-blocking: the plain code renders first
// (SSR, no-JS, slow import) and is swapped for the tokenised markup after.
const props = withDefaults(defineProps<{ code: string, lang?: 'js' | 'html' | 'bash' | 'json' }>(), { lang: 'js' })
const html = ref('')

watchEffect(async () => {
  html.value = await highlightText(props.code, props.lang, false)
})
</script>

<style scoped>
@reference "~/assets/css/main.css";
.snippet { @apply font-mono text-[12px] leading-relaxed bg-stone-100 dark:bg-stone-900 rounded-lg p-3 overflow-x-auto whitespace-pre; }
</style>
