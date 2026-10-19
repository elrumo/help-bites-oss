<template>
  <article :id="`entry-${entry.number ?? entry.id}`" class="scroll-mt-4">
    <div class="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
      <span class="rounded-full px-1.5 py-px text-[10px] font-semibold" :class="CHANGELOG_TAG_CLASS[entry.tag]">{{ $t(`feedback.changelogTags.${entry.tag}`) }}</span>
      <time v-if="showDate && entry.publishedAt" :datetime="entry.publishedAt">{{ shortDate(entry.publishedAt) }}</time>
    </div>
    <h3 class="mt-1 text-[15px] font-semibold leading-snug">{{ entry.title }}</h3>
    <MarkdownBlock v-if="entry.body" :text="entry.body" :html="entry.bodyFormat === 'html' ? entry.bodyHtml : undefined" class="mt-1" />
  </article>
</template>

<script setup lang="ts">
import type { PublicChangelogEntry } from '#shared/changelog'

// One published entry, as the public changelog shows it: a tag, a title and
// its text (Markdown, or the sanitised HTML of an entry written as HTML). Used inside a release and, with its own date, on its own.
defineProps<{ entry: PublicChangelogEntry, showDate?: boolean }>()
</script>
