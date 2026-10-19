<template>
  <main class="py-10 md:py-14">
    <h1 class="text-[clamp(1.9rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em] text-highlighted">{{ $t('docs.title') }}</h1>
    <p class="mt-3 max-w-[56ch] text-muted">
      {{ $t('docs.lead') }}
    </p>

    <NuxtLink :to="docPath(selfHost)" class="card mt-10 flex items-start gap-4 p-5!">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-server" class="size-5" /></span>
      <span class="min-w-0">
        <span class="flex items-center gap-1.5 text-[15px] font-semibold text-highlighted">{{ $t('docs.selfHostTitle') }}<UIcon name="i-lucide-arrow-right" class="size-4 text-muted" /></span>
        <span class="mt-1 block text-[14px] text-muted">{{ selfHost.description }}</span>
      </span>
    </NuxtLink>

    <section v-for="group in groups" :key="group.title" class="mt-12">
      <h2 class="text-xs font-medium text-muted">{{ group.title }}</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <NuxtLink v-for="doc in group.docs" :key="doc.slug" :to="docPath(doc)" class="card block">
          <span class="text-[14px] font-semibold text-highlighted">{{ doc.title }}</span>
          <span class="mt-1 block text-[13.5px] text-muted">{{ doc.description }}</span>
        </NuxtLink>
      </div>
    </section>

    <section class="mt-12">
      <h2 class="text-xs font-medium text-muted">{{ $t('docs.reference') }}</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <a href="/_docs/scalar" target="_blank" class="card block">
          <span class="flex items-center gap-1.5 text-[14px] font-semibold text-highlighted">{{ $t('docs.apiReference') }}<UIcon name="i-lucide-arrow-up-right" class="size-3.5 text-muted" /></span>
          <span class="mt-1 block text-[13.5px] text-muted">{{ $t('docs.apiReferenceBefore') }} <code class="font-mono text-[0.9em]">/_docs/scalar</code>{{ $t('docs.apiReferenceAfter') }}</span>
        </a>
        <a :href="REPO_URL" target="_blank" rel="noopener" class="card block">
          <span class="flex items-center gap-1.5 text-[14px] font-semibold text-highlighted">{{ $t('common.sourceCode') }}<UIcon name="i-lucide-arrow-up-right" class="size-3.5 text-muted" /></span>
          <span class="mt-1 block text-[13.5px] text-muted">{{ $t('docs.sourceDescription') }}</span>
        </a>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { DOCS, DOC_GROUPS, REPO_URL, docBySlug, docPath } from '#shared/docs'

definePageMeta({ layout: 'docs' })

const { t } = useI18n()

useSeoMeta({
  title: () => t('docs.seoTitle'),
  description: () => t('docs.seoDescription'),
  ogTitle: () => t('docs.seoOgTitle'),
  ogDescription: () => t('docs.seoOgDescription'),
  ogType: 'website'
})

const selfHost = docBySlug('self-host')!
// The self-hosting guide has the big card above; the grid holds the others.
const groups = DOC_GROUPS
  .map(title => ({ title, docs: DOCS.filter(doc => doc.group === title && doc !== selfHost) }))
  .filter(group => group.docs.length)
</script>

<style scoped>
@reference "~/assets/css/main.css";
.card { @apply rounded-xl border border-default p-4 transition-colors hover:border-accented hover:bg-muted; }
</style>
