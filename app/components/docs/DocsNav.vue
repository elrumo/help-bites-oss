<template>
  <nav :aria-label="$t('docs.title')" class="text-[13px]">
    <NuxtLink to="/docs" class="nav-link" exact-active-class="nav-active">{{ $t('docs.overview') }}</NuxtLink>

    <div v-for="group in groups" :key="group.title" class="mt-6">
      <p class="mb-1 px-2 text-xs font-medium text-muted">{{ group.title }}</p>
      <NuxtLink v-for="doc in group.docs" :key="doc.slug" :to="docPath(doc)" class="nav-link" active-class="nav-active">{{ doc.title }}</NuxtLink>
    </div>

    <div class="mt-6">
      <p class="mb-1 px-2 text-xs font-medium text-muted">{{ $t('docs.reference') }}</p>
      <a href="/_docs/scalar" target="_blank" class="nav-link">{{ $t('docs.apiReference') }}<UIcon name="i-lucide-arrow-up-right" class="ml-auto size-3.5 text-dimmed" /></a>
      <a :href="REPO_URL" target="_blank" rel="noopener" class="nav-link">{{ $t('common.sourceCode') }}<UIcon name="i-lucide-arrow-up-right" class="ml-auto size-3.5 text-dimmed" /></a>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { DOCS, DOC_GROUPS, REPO_URL, docPath } from '#shared/docs'

const groups = DOC_GROUPS.map(title => ({ title, docs: DOCS.filter(doc => doc.group === title) }))
</script>

<style scoped>
@reference "~/assets/css/main.css";
.nav-link { @apply flex items-center rounded-md px-2 py-1.5 text-muted transition-colors hover:bg-elevated hover:text-highlighted; }
.nav-active { @apply bg-accented font-medium text-highlighted; }
</style>
