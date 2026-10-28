<template>
  <div class="min-h-screen bg-default text-[15px] leading-relaxed text-default">
    <header class="sticky top-0 z-30 border-b border-default/70 bg-default/80 backdrop-blur-xl">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 md:px-8">
        <NuxtLink to="/" class="flex items-center gap-2 text-[14px] font-semibold text-highlighted">
          <span class="grid size-6 place-items-center rounded-md bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3.5" /></span>
          HelpBites
        </NuxtLink>
        <AppVersion class="-ml-3 text-[12px]" />
        <NuxtLink to="/docs" class="-ml-3 hidden text-[14px] text-muted transition-colors hover:text-highlighted sm:block"><span class="mr-2 text-dimmed">/</span>{{ $t('docs.home') }}</NuxtLink>
        <div class="ml-auto flex items-center gap-2">
          <UButton to="/login" :label="$t('login.signIn')" color="neutral" variant="ghost" size="sm" />
          <UButton to="/demo" :label="$t('docs.tryDemo')" size="sm" />
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-6xl px-5 md:grid md:grid-cols-[190px_minmax(0,1fr)] md:gap-10 md:px-8">
      <aside class="hidden md:block">
        <div class="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-10 pr-2"><DocsNav /></div>
      </aside>

      <div class="min-w-0">
        <!-- Phones: the same list, folded away until asked for. -->
        <div class="border-b border-default py-3 md:hidden">
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-menu" :aria-expanded="menuOpen" aria-controls="docs-menu" class="-ml-2.5" @click="menuOpen = !menuOpen">{{ $t('docs.menu') }}</UButton>
          <div v-if="menuOpen" id="docs-menu" class="pb-2 pt-3"><DocsNav /></div>
        </div>
        <slot />
      </div>
    </div>

    <footer class="border-t border-default">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-[13px] md:px-8">
        <p class="mr-auto flex items-center gap-2 font-semibold text-highlighted">
          <span class="grid size-5 place-items-center rounded-[5px] bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3" /></span>
          HelpBites
          <AppVersion class="text-[12px] font-normal" />
        </p>
        <a :href="REPO_URL" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">{{ $t('docs.source') }}</a>
        <a :href="README_URL" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">{{ $t('common.readme') }}</a>
        <a :href="DOCKER_HUB_URL" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">{{ $t('common.dockerHub') }}</a>
        <a :href="CHANGELOG_URL" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">{{ $t('common.changelog') }}</a>
        <a href="/_docs/scalar" target="_blank" class="text-muted transition-colors hover:text-highlighted">{{ $t('docs.apiReference') }}</a>
        <NuxtLink to="/demo" class="text-muted transition-colors hover:text-highlighted">{{ $t('docs.demo') }}</NuxtLink>
        <NuxtLink to="/login" class="text-muted transition-colors hover:text-highlighted">{{ $t('login.signIn') }}</NuxtLink>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { DOCKER_HUB_URL, README_URL, REPO_URL } from '#shared/docs'
import { CHANGELOG_URL } from '#shared/version'

const menuOpen = ref(false)
const route = useRoute()
watch(() => route.fullPath, () => { menuOpen.value = false })
</script>
