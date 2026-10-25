<template>
  <article :id="`entry-${entry.number ?? entry.id}`" class="scroll-mt-4">
    <div class="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
      <span class="rounded-full px-1.5 py-px text-[10px] font-semibold" :class="CHANGELOG_TAG_CLASS[entry.tag]">{{ $t(`feedback.changelogTags.${entry.tag}`) }}</span>
      <time v-if="showDate && entry.publishedAt" :datetime="entry.publishedAt">{{ shortDate(entry.publishedAt) }}</time>
    </div>
    <h3 class="mt-1 text-[15px] font-semibold leading-snug">{{ entry.title }}</h3>
    <MarkdownBlock v-if="entry.body" :text="entry.body" :html="entry.bodyFormat === 'html' ? entry.bodyHtml : undefined" class="mt-1" />
    <ul v-if="entry.images.length" class="mt-3 flex flex-wrap gap-2">
      <li v-for="image in entry.images" :key="image.url" :style="{ width: `${CHANGELOG_IMAGE_WIDTH_PERCENT[imageWidth]}%` }">
        <a :href="image.url" target="_blank" rel="noopener" class="block overflow-hidden" :style="{ borderRadius: 'var(--hb-radius)', border: '1px solid var(--hb-border)' }">
          <img :src="image.url" :alt="image.name" loading="lazy" class="block h-auto w-full">
        </a>
      </li>
    </ul>
  </article>
</template>

<script setup lang="ts">
import { CHANGELOG_IMAGE_WIDTH_PERCENT, type ChangelogImageWidth, type PublicChangelogEntry } from '#shared/changelog'

// One published entry, as the public changelog shows it: a tag, a title, its text (Markdown, or the sanitised HTML of an entry
// written as HTML) and its images, in order. Used inside a release and, with its own date, on its own.
// `imageWidth` is the project's setting (full, medium or small): how much of the column each image takes.
withDefaults(defineProps<{ entry: PublicChangelogEntry, showDate?: boolean, imageWidth?: ChangelogImageWidth }>(), { imageWidth: 'full' })
</script>
