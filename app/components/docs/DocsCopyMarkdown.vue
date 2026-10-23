<template>
  <div class="flex shrink-0 gap-2">
    <UButton color="neutral" variant="outline" size="xs" :icon="copied === 'md' ? 'i-lucide-check' : 'i-lucide-file-text'" :label="copied === 'md' ? $t('docs.copied') : $t('docs.copyMd')" @click="copyMarkdown" />
    <UButton color="neutral" variant="outline" size="xs" :icon="copied === 'link' ? 'i-lucide-check' : 'i-lucide-link'" :label="copied === 'link' ? $t('docs.copied') : $t('docs.copyMdLink')" @click="copyMarkdownLink" />
  </div>
</template>

<script setup lang="ts">
// Copy MD and Copy MD link for a docs page; `path` is where its Markdown lives (/docs/<slug>.md, /docs.md).
const props = defineProps<{ path: string }>()

const origin = useAppUrl()
const copied = ref<'md' | 'link' | ''>('')

async function copy(kind: 'md' | 'link', text: string | Promise<string>) {
  try {
    // Safari only allows the write inside the click if the text is handed over as a promise.
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': Promise.resolve(text).then(value => new Blob([value], { type: 'text/plain' })) })])
  } catch {
    try {
      await navigator.clipboard.writeText(await text)
    } catch {
      // No clipboard on a plain-http page: open the Markdown so it can be copied by hand.
      window.open(props.path, '_blank')
      return
    }
  }
  copied.value = kind
  setTimeout(() => { copied.value = '' }, 1500)
}

// The Markdown links to the other guides by path; pasted elsewhere they need the site's address.
const copyMarkdown = () => copy('md', $fetch<string>(props.path, { responseType: 'text' }).then(md => md.replaceAll('](/', `](${origin.value}/`)))
const copyMarkdownLink = () => copy('link', origin.value + props.path)
</script>
