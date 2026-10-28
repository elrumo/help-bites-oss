<template>
  <a :href="CHANGELOG_URL" target="_blank" rel="noopener" :title="$t('common.releaseNotes')" :aria-label="`${$t('common.version', { version })}${RELEASE_STAGE ? ` (${$t('common.beta')})` : ''}`" class="inline-flex items-center gap-1.5 whitespace-nowrap text-muted transition-colors hover:text-highlighted">
    <span class="tabular-nums">v{{ version }}</span>
    <span v-if="RELEASE_STAGE" class="rounded-full border border-default px-1.5 text-[10px] font-medium uppercase leading-4 tracking-wide text-toned">{{ $t('common.beta') }}</span>
  </a>
</template>

<script setup lang="ts">
import { CHANGELOG_URL, RELEASE_STAGE } from '#shared/version'

// The release this build is: baked in at build time (runtimeConfig.public.version, from package.json),
// so the prerendered landing page and docs carry it too. Links to the release notes.
const { version } = useRuntimeConfig().public
</script>
